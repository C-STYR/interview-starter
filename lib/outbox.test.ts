import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  createTestDatabase,
  cleanupTestDatabase,
  seedTestData,
} from '@/lib/test-utils/test-db';
import {
  assertOutboxEventExists,
  countOutboxEvents,
} from '@/lib/test-utils/test-helpers';
import { createOutboxEvent, createUserWithEvent } from './outbox';

describe('createOutboxEvent', () => {
  let prisma: PrismaClient;
  let testData: any;

  beforeEach(async () => {
    prisma = await createTestDatabase();
    testData = await seedTestData(prisma);
  });

  afterEach(async () => {
    await cleanupTestDatabase(prisma);
  });

  it('should create an outbox event', async () => {
    const event = await createOutboxEvent(prisma, {
      aggregateId: 'test-aggregate-123',
      eventType: 'user.created',
      payload: {
        userId: 'test-user-123',
        email: 'test@example.com',
        name: 'Test User',
      },
    });

    expect(event).toBeTruthy();
    expect(event.aggregateId).toBe('test-aggregate-123');
    expect(event.eventType).toBe('user.created');
    expect(event.processed).toBe(false);
    expect(event.attempts).toBe(0);

    // Verify payload is stored as JSON
    const payload = JSON.parse(event.payload);
    expect(payload.userId).toBe('test-user-123');
    expect(payload.email).toBe('test@example.com');
    expect(payload.name).toBe('Test User');
  });

  it('should work within a transaction', async () => {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: 'transactional@example.com',
          name: 'Transactional User',
          orgId: testData.orgs.org1.id,
        },
      });

      const event = await createOutboxEvent(tx, {
        aggregateId: user.id,
        eventType: 'user.created',
        payload: {
          userId: user.id,
          email: user.email,
          name: user.name,
        },
      });

      return { user, event };
    });

    expect(result.user).toBeTruthy();
    expect(result.event).toBeTruthy();

    // Verify both were created atomically
    const user = await prisma.user.findUnique({
      where: { id: result.user.id },
    });

    const event = await prisma.outboxEvent.findUnique({
      where: { id: result.event.id },
    });

    expect(user).toBeTruthy();
    expect(event).toBeTruthy();
  });

  it('should support different event types', async () => {
    const eventTypes: Array<'user.created' | 'user.updated' | 'digest.weekly'> = [
      'user.created',
      'user.updated',
      'digest.weekly',
    ];

    for (const eventType of eventTypes) {
      await createOutboxEvent(prisma, {
        aggregateId: `aggregate-${eventType}`,
        eventType,
        payload: { test: 'data' },
      });
    }

    // Verify all events were created
    for (const eventType of eventTypes) {
      await assertOutboxEventExists(prisma, {
        aggregateId: `aggregate-${eventType}`,
        eventType,
      });
    }
  });

  it('should store complex payload objects', async () => {
    const complexPayload = {
      userId: 'user-123',
      metadata: {
        source: 'api',
        ip: '127.0.0.1',
        nested: {
          deep: {
            value: 42,
          },
        },
      },
      tags: ['tag1', 'tag2', 'tag3'],
      timestamp: new Date().toISOString(),
    };

    const event = await createOutboxEvent(prisma, {
      aggregateId: 'complex-aggregate',
      eventType: 'user.created',
      payload: complexPayload,
    });

    const storedPayload = JSON.parse(event.payload);

    expect(storedPayload).toEqual(complexPayload);
    expect(storedPayload.metadata.nested.deep.value).toBe(42);
    expect(storedPayload.tags).toHaveLength(3);
  });

  it('should rollback event if transaction fails', async () => {
    const countBefore = await countOutboxEvents(prisma, {});

    try {
      await prisma.$transaction(async (tx) => {
        await createOutboxEvent(tx, {
          aggregateId: 'rollback-test',
          eventType: 'user.created',
          payload: { test: 'data' },
        });

        // Simulate error
        throw new Error('Simulated transaction failure');
      });
    } catch (error) {
      // Expected to fail
    }

    const countAfter = await countOutboxEvents(prisma, {});

    // Event should not have been created due to rollback
    expect(countAfter).toBe(countBefore);

    // Verify event doesn't exist
    const event = await prisma.outboxEvent.findFirst({
      where: { aggregateId: 'rollback-test' },
    });

    expect(event).toBeNull();
  });
});

describe('createUserWithEvent', () => {
  let prisma: PrismaClient;
  let testData: any;

  beforeEach(async () => {
    prisma = await createTestDatabase();
    testData = await seedTestData(prisma);
  });

  afterEach(async () => {
    await cleanupTestDatabase(prisma);
  });

  it('should create user and event atomically', async () => {
    const user = await createUserWithEvent(prisma, {
      email: 'atomic@example.com',
      name: 'Atomic User',
      orgId: testData.orgs.org1.id,
    });

    expect(user).toBeTruthy();
    expect(user.email).toBe('atomic@example.com');

    // Verify outbox event was created
    await assertOutboxEventExists(prisma, {
      aggregateId: user.id,
      eventType: 'user.created',
      payloadContains: {
        userId: user.id,
        email: 'atomic@example.com',
        name: 'Atomic User',
      },
    });
  });

  it('should use default role if not provided', async () => {
    const user = await createUserWithEvent(prisma, {
      email: 'defaultrole@example.com',
      name: 'Default Role User',
      orgId: testData.orgs.org1.id,
    });

    // Prisma defaults to "member" based on schema
    expect(user.role).toBeDefined();
  });

  it('should accept custom role', async () => {
    const user = await createUserWithEvent(prisma, {
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      orgId: testData.orgs.org1.id,
    });

    expect(user.role).toBe('admin');
  });

  it('should rollback both user and event if error occurs', async () => {
    const userCountBefore = await prisma.user.count();
    const eventCountBefore = await countOutboxEvents(prisma, {});

    // Mock a failure by using an invalid email (duplicate)
    try {
      await createUserWithEvent(prisma, {
        email: testData.users.user1.email, // Duplicate email
        name: 'Duplicate User',
        orgId: testData.orgs.org1.id,
      });
    } catch (error) {
      // Expected to fail due to unique constraint
    }

    const userCountAfter = await prisma.user.count();
    const eventCountAfter = await countOutboxEvents(prisma, {});

    // Neither user nor event should have been created
    expect(userCountAfter).toBe(userCountBefore);
    expect(eventCountAfter).toBe(eventCountBefore);
  });

  it('should work without orgId', async () => {
    const user = await createUserWithEvent(prisma, {
      email: 'noorg@example.com',
      name: 'No Org User',
    });

    expect(user).toBeTruthy();
    expect(user.orgId).toBeNull();

    // Verify event was still created
    await assertOutboxEventExists(prisma, {
      aggregateId: user.id,
      eventType: 'user.created',
    });
  });
});
