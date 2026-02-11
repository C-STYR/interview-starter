import { PrismaClient } from '@prisma/client';
import { expect } from 'vitest';

/**
 * Test Helper Utilities
 *
 * Common assertions and helper functions for testing.
 */

/**
 * Assert that an outbox event exists with the given properties
 */
export async function assertOutboxEventExists(
  prisma: PrismaClient,
  props: {
    aggregateId: string;
    eventType: string;
    payloadContains?: Record<string, any>;
  }
) {
  const event = await prisma.outboxEvent.findFirst({
    where: {
      aggregateId: props.aggregateId,
      eventType: props.eventType,
    },
  });

  expect(event).toBeTruthy();
  expect(event?.eventType).toBe(props.eventType);
  expect(event?.aggregateId).toBe(props.aggregateId);

  if (props.payloadContains) {
    const payload = JSON.parse(event!.payload);
    for (const [key, value] of Object.entries(props.payloadContains)) {
      expect(payload[key]).toBe(value);
    }
  }

  return event;
}

/**
 * Assert that an audit log entry exists with the given properties
 */
export async function assertAuditLogExists(
  prisma: PrismaClient,
  props: {
    actor: string;
    action: string;
    targetId?: string;
    metadataContains?: Record<string, any>;
  }
) {
  const auditLog = await prisma.auditLog.findFirst({
    where: {
      actor: props.actor,
      action: props.action,
      targetId: props.targetId || undefined,
    },
  });

  expect(auditLog).toBeTruthy();
  expect(auditLog?.actor).toBe(props.actor);
  expect(auditLog?.action).toBe(props.action);

  if (props.targetId) {
    expect(auditLog?.targetId).toBe(props.targetId);
  }

  if (props.metadataContains) {
    const metadata = JSON.parse(auditLog!.metadata || '{}');
    for (const [key, value] of Object.entries(props.metadataContains)) {
      expect(metadata[key]).toBe(value);
    }
  }

  return auditLog;
}

/**
 * Count outbox events matching criteria
 */
export async function countOutboxEvents(
  prisma: PrismaClient,
  where: {
    eventType?: string;
    aggregateId?: string;
    processed?: boolean;
  }
) {
  return await prisma.outboxEvent.count({ where });
}

/**
 * Count audit logs matching criteria
 */
export async function countAuditLogs(
  prisma: PrismaClient,
  where: {
    actor?: string;
    action?: string;
    targetId?: string;
  }
) {
  return await prisma.auditLog.count({ where });
}

/**
 * Wait for a condition to be true (polling helper)
 *
 * @param condition - Function that returns true when condition is met
 * @param timeout - Max time to wait in milliseconds
 * @param interval - Polling interval in milliseconds
 */
export async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`Condition not met within ${timeout}ms`);
}

/**
 * Get all outbox events for an aggregate
 */
export async function getOutboxEvents(
  prisma: PrismaClient,
  aggregateId: string
) {
  return await prisma.outboxEvent.findMany({
    where: { aggregateId },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Get all audit logs for a target
 */
export async function getAuditLogs(
  prisma: PrismaClient,
  targetId: string
) {
  return await prisma.auditLog.findMany({
    where: { targetId },
    orderBy: { createdAt: 'asc' },
  });
}
