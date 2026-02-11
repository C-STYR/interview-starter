import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  createTestDatabase,
  cleanupTestDatabase,
  seedTestData,
} from '@/lib/test-utils/test-db';
import {
  assertOutboxEventExists,
  countOutboxEvents,
} from '@/lib/test-utils/test-helpers';

// Store test prisma instance globally for mocking
let testPrisma: PrismaClient;

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));

describe('POST /api/cron/weekly-digest', () => {
  let testData: any;

  beforeEach(async () => {
    testPrisma = await createTestDatabase();
    testData = await seedTestData(testPrisma);
  });

  afterEach(async () => {
    await cleanupTestDatabase(testPrisma);
  });

  it('should create outbox events for all active users', async () => {
    const { default: handler } = await import('./weekly-digest');

    const req = {
      method: 'POST',
      headers: {},
    } as NextApiRequest;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Weekly digest events created successfully',
      userCount: 3, // All 3 test users
      idempotencyKey: undefined,
    });

    // Verify outbox events were created for all users
    const events = await testPrisma.outboxEvent.findMany({
      where: { eventType: 'digest.weekly' },
    });

    expect(events).toHaveLength(3);

    // Verify each user has an event
    await assertOutboxEventExists(testPrisma, {
      aggregateId: testData.users.user1.id,
      eventType: 'digest.weekly',
      payloadContains: {
        userId: testData.users.user1.id,
        email: testData.users.user1.email,
      },
    });

    await assertOutboxEventExists(testPrisma, {
      aggregateId: testData.users.user2.id,
      eventType: 'digest.weekly',
      payloadContains: {
        userId: testData.users.user2.id,
        email: testData.users.user2.email,
      },
    });

    await assertOutboxEventExists(testPrisma, {
      aggregateId: testData.users.user3.id,
      eventType: 'digest.weekly',
      payloadContains: {
        userId: testData.users.user3.id,
        email: testData.users.user3.email,
      },
    });
  });

  it('should exclude soft-deleted users', async () => {
    // Soft delete user2
    await testPrisma.user.update({
      where: { id: testData.users.user2.id },
      data: {
        deletedAt: new Date(),
        deletedBy: testData.users.user1.id,
      },
    });

    const { default: handler } = await import('./weekly-digest');

    const req = {
      method: 'POST',
      headers: {},
    } as NextApiRequest;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Weekly digest events created successfully',
      userCount: 2, // Only 2 active users (user1 and user3)
      idempotencyKey: undefined,
    });

    // Verify only 2 events were created
    const eventCount = await countOutboxEvents(testPrisma, {
      eventType: 'digest.weekly',
    });

    expect(eventCount).toBe(2);

    // Verify user2 did NOT get an event
    const user2Event = await testPrisma.outboxEvent.findFirst({
      where: {
        aggregateId: testData.users.user2.id,
        eventType: 'digest.weekly',
      },
    });

    expect(user2Event).toBeNull();
  });

  it('should respect idempotency key', async () => {
    const idempotencyKey = '2026-W07';

    const { default: handler } = await import('./weekly-digest');

    const req1 = {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
    } as unknown as NextApiRequest;

    const res1 = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    // First request
    await handler(req1, res1);

    expect(res1.status).toHaveBeenCalledWith(200);
    expect(res1.json).toHaveBeenCalledWith({
      message: 'Weekly digest events created successfully',
      userCount: 3,
      idempotencyKey,
    });

    // Second request with same idempotency key
    const req2 = {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
    } as unknown as NextApiRequest;

    const res2 = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await handler(req2, res2);

    expect(res2.status).toHaveBeenCalledWith(200);
    expect(res2.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Digest events already created for this idempotency key',
        userCount: 3,
        status: 'completed',
        idempotent: true,
      })
    );

    // Verify only 3 events total (not 6)
    const eventCount = await countOutboxEvents(testPrisma, {
      eventType: 'digest.weekly',
    });

    expect(eventCount).toBe(3);
  });

  it('should create DigestBatch record', async () => {
    const idempotencyKey = '2026-W08';

    const { default: handler } = await import('./weekly-digest');

    const req = {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
    } as unknown as NextApiRequest;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await handler(req, res);

    // Verify DigestBatch record was created
    const batch = await testPrisma.digestBatch.findUnique({
      where: { idempotencyKey },
    });

    expect(batch).toBeTruthy();
    expect(batch?.userCount).toBe(3);
    expect(batch?.status).toBe('completed');
  });

  it('should create events and batch atomically (transaction)', async () => {
    const idempotencyKey = '2026-W09';

    const { default: handler } = await import('./weekly-digest');

    const req = {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
    } as unknown as NextApiRequest;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await handler(req, res);

    // If transaction worked, we should have both events and batch
    const eventCount = await countOutboxEvents(testPrisma, {
      eventType: 'digest.weekly',
    });

    const batchCount = await testPrisma.digestBatch.count({
      where: { idempotencyKey },
    });

    expect(eventCount).toBe(3);
    expect(batchCount).toBe(1);
  });

  it('should return 200 when no active users exist', async () => {
    // Soft delete all users
    await testPrisma.user.updateMany({
      data: { deletedAt: new Date() },
    });

    const { default: handler } = await import('./weekly-digest');

    const req = {
      method: 'POST',
      headers: {},
    } as NextApiRequest;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'No active users to send digest to',
      userCount: 0,
    });

    // Verify no events were created
    const eventCount = await countOutboxEvents(testPrisma, {
      eventType: 'digest.weekly',
    });

    expect(eventCount).toBe(0);
  });

  it('should reject non-POST methods', async () => {
    const { default: handler } = await import('./weekly-digest');

    const req = {
      method: 'GET',
      headers: {},
    } as NextApiRequest;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({ error: 'Method GET not allowed' });
    expect(res.setHeader).toHaveBeenCalledWith('Allow', ['POST']);
  });

  it('should require CRON_SECRET when set', async () => {
    // Set CRON_SECRET and NODE_ENV via vi.stubEnv to avoid read-only TS error
    vi.stubEnv('CRON_SECRET', 'test-secret');
    vi.stubEnv('NODE_ENV', 'production');

    const { default: handler } = await import('./weekly-digest');

    const req = {
      method: 'POST',
      headers: {}, // Missing Authorization header
    } as unknown as NextApiRequest;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });

    vi.unstubAllEnvs();
  });

  it('should accept valid CRON_SECRET', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');

    const { default: handler } = await import('./weekly-digest');

    const req = {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-secret',
      },
    } as unknown as NextApiRequest;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);

    vi.unstubAllEnvs();
  });

  it('should work without CRON_SECRET in development', async () => {
    vi.stubEnv('CRON_SECRET', '');
    vi.stubEnv('NODE_ENV', 'development');

    const { default: handler } = await import('./weekly-digest');

    const req = {
      method: 'POST',
      headers: {}, // No auth header
    } as NextApiRequest;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);

    vi.unstubAllEnvs();
  });
});
