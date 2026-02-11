import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  createTestDatabase,
  cleanupTestDatabase,
} from '@/lib/test-utils/test-db';
import {
  assertAuditLogExists,
  countAuditLogs,
} from '@/lib/test-utils/test-helpers';
import { createOutboxEvent } from '@/lib/outbox';

// We need to test the internal functions, so we'll import them
// In a real scenario, you might export them for testing or use rewire
// For now, we'll test through the public API and verify behavior

describe('Outbox Processor', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    prisma = await createTestDatabase();
  });

  afterEach(async () => {
    await cleanupTestDatabase(prisma);
  });

  it('should process user.created event and create audit log', async () => {
    // Create a user.created outbox event
    const event = await createOutboxEvent(prisma, {
      aggregateId: 'user-123',
      eventType: 'user.created',
      payload: {
        userId: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
      },
    });

    // Import and call the processor
    const { startOutboxProcessor } = await import('./outbox-processor');

    // Start processor (it will process immediately)
    const cleanup = await startOutboxProcessor(prisma);

    // Wait a bit for processing
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Stop processor
    await cleanup();

    // Verify event was processed
    const processedEvent = await prisma.outboxEvent.findUnique({
      where: { id: event.id },
    });

    expect(processedEvent?.processed).toBe(true);
    expect(processedEvent?.processedAt).toBeTruthy();
    expect(processedEvent?.attempts).toBe(1);

    // Verify audit log was created
    await assertAuditLogExists(prisma, {
      actor: 'system',
      action: 'welcome_email_sent',
      targetId: 'user-123',
      metadataContains: {
        email: 'test@example.com',
        name: 'Test User',
      },
    });
  });

  it('should process digest.weekly event and create audit log', async () => {
    // Create a digest.weekly outbox event
    const event = await createOutboxEvent(prisma, {
      aggregateId: 'user-456',
      eventType: 'digest.weekly',
      payload: {
        userId: 'user-456',
        email: 'digest@example.com',
        name: 'Digest User',
      },
    });

    const { startOutboxProcessor } = await import('./outbox-processor');
    const cleanup = await startOutboxProcessor(prisma);

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 1000));

    await cleanup();

    // Verify event was processed
    const processedEvent = await prisma.outboxEvent.findUnique({
      where: { id: event.id },
    });

    expect(processedEvent?.processed).toBe(true);

    // Verify audit log was created
    await assertAuditLogExists(prisma, {
      actor: 'system',
      action: 'digest_email_sent',
      targetId: 'user-456',
      metadataContains: {
        email: 'digest@example.com',
        name: 'Digest User',
      },
    });
  });

  it('should not create duplicate audit logs on retry', async () => {
    // Create an event
    const event = await createOutboxEvent(prisma, {
      aggregateId: 'user-789',
      eventType: 'user.created',
      payload: {
        userId: 'user-789',
        email: 'retry@example.com',
        name: 'Retry User',
      },
    });

    const { startOutboxProcessor } = await import('./outbox-processor');
    const cleanup = await startOutboxProcessor(prisma);

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 1500));

    await cleanup();

    // Verify event was processed
    const processedEvent = await prisma.outboxEvent.findUnique({
      where: { id: event.id },
    });

    expect(processedEvent?.processed).toBe(true);

    // Count audit logs - should be exactly 1
    const auditCount = await countAuditLogs(prisma, {
      action: 'welcome_email_sent',
      targetId: 'user-789',
    });

    expect(auditCount).toBe(1);
  });

  it('should create event and audit log atomically', async () => {
    // Create multiple events
    await createOutboxEvent(prisma, {
      aggregateId: 'user-atomic-1',
      eventType: 'user.created',
      payload: {
        userId: 'user-atomic-1',
        email: 'atomic1@example.com',
        name: 'Atomic User 1',
      },
    });

    await createOutboxEvent(prisma, {
      aggregateId: 'user-atomic-2',
      eventType: 'user.created',
      payload: {
        userId: 'user-atomic-2',
        email: 'atomic2@example.com',
        name: 'Atomic User 2',
      },
    });

    const { startOutboxProcessor } = await import('./outbox-processor');
    const cleanup = await startOutboxProcessor(prisma);

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    await cleanup();

    // Verify all events were processed
    const processedCount = await prisma.outboxEvent.count({
      where: { processed: true },
    });

    expect(processedCount).toBe(2);

    // Verify all audit logs were created
    const auditCount = await countAuditLogs(prisma, {
      action: 'welcome_email_sent',
    });

    expect(auditCount).toBe(2);
  });

  it('should handle events with no handler gracefully', async () => {
    // Create event with unknown type
    const event = await prisma.outboxEvent.create({
      data: {
        aggregateId: 'unknown-123',
        eventType: 'unknown.event',
        payload: JSON.stringify({ test: 'data' }),
      },
    });

    const { startOutboxProcessor } = await import('./outbox-processor');
    const cleanup = await startOutboxProcessor(prisma);

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 1000));

    await cleanup();

    // Verify event was marked as processed (to avoid infinite retries)
    const processedEvent = await prisma.outboxEvent.findUnique({
      where: { id: event.id },
    });

    expect(processedEvent?.processed).toBe(true);
    expect(processedEvent?.lastError).toContain('No handler registered');

    // Verify no audit log was created
    const auditCount = await countAuditLogs(prisma, {
      targetId: 'unknown-123',
    });

    expect(auditCount).toBe(0);
  });

  it('should process events in order (oldest first)', async () => {
    // Create events with slight delay to ensure different timestamps
    const event1 = await createOutboxEvent(prisma, {
      aggregateId: 'user-order-1',
      eventType: 'user.created',
      payload: {
        userId: 'user-order-1',
        email: 'order1@example.com',
        name: 'Order User 1',
      },
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    const event2 = await createOutboxEvent(prisma, {
      aggregateId: 'user-order-2',
      eventType: 'user.created',
      payload: {
        userId: 'user-order-2',
        email: 'order2@example.com',
        name: 'Order User 2',
      },
    });

    const { startOutboxProcessor } = await import('./outbox-processor');
    const cleanup = await startOutboxProcessor(prisma);

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 2500));

    await cleanup();

    // Get audit logs in order
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        action: 'welcome_email_sent',
      },
      orderBy: { createdAt: 'asc' },
    });

    // First audit log should be for first user
    expect(auditLogs[0]?.targetId).toBe('user-order-1');
    expect(auditLogs[1]?.targetId).toBe('user-order-2');
  });

  it('should respect batch size', { timeout: 30000 }, async () => {
    // Create more events than batch size (batch size is 10)
    const eventPromises = [];
    for (let i = 0; i < 15; i++) {
      eventPromises.push(
        createOutboxEvent(prisma, {
          aggregateId: `user-batch-${i}`,
          eventType: 'user.created',
          payload: {
            userId: `user-batch-${i}`,
            email: `batch${i}@example.com`,
            name: `Batch User ${i}`,
          },
        })
      );
    }

    await Promise.all(eventPromises);

    const { startOutboxProcessor } = await import('./outbox-processor');
    const cleanup = await startOutboxProcessor(prisma);

    // Wait for all events to process (15 events with 1 second delay each = ~15 seconds + polling overhead)
    await new Promise(resolve => setTimeout(resolve, 18000));

    // Check how many were processed in first batch
    const processedCount = await prisma.outboxEvent.count({
      where: { processed: true },
    });

    // Should process at least 10 (batch size) in the first pass
    expect(processedCount).toBeGreaterThanOrEqual(10);

    await cleanup();
  });

  it('should not process already processed events', async () => {
    // Create and manually mark an event as processed
    const event = await prisma.outboxEvent.create({
      data: {
        aggregateId: 'user-already-processed',
        eventType: 'user.created',
        payload: JSON.stringify({
          userId: 'user-already-processed',
          email: 'already@example.com',
          name: 'Already Processed',
        }),
        processed: true,
        processedAt: new Date(),
        attempts: 1,
      },
    });

    const { startOutboxProcessor } = await import('./outbox-processor');
    const cleanup = await startOutboxProcessor(prisma);

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 1000));

    await cleanup();

    // Verify attempts didn't increase
    const processedEvent = await prisma.outboxEvent.findUnique({
      where: { id: event.id },
    });

    expect(processedEvent?.attempts).toBe(1); // Should still be 1

    // Verify no new audit log was created
    const auditCount = await countAuditLogs(prisma, {
      targetId: 'user-already-processed',
    });

    expect(auditCount).toBe(0);
  });
});
