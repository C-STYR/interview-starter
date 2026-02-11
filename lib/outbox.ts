import { PrismaClient } from '@prisma/client';

/**
 * Outbox helper functions for the Transactional Outbox Pattern
 *
 * This ensures reliable event processing by storing events in the same
 * database transaction as your business logic.
 */

export type OutboxEventType =
  | 'user.created'
  | 'user.updated'
  | 'user.deleted'
  | 'organization.created'
  | 'organization.updated'
  | 'digest.weekly';

interface CreateOutboxEventParams {
  aggregateId: string;
  eventType: OutboxEventType;
  payload: Record<string, any>;
}

// Type for Prisma transaction client
type PrismaTransactionClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Creates an outbox event. Use this within a Prisma transaction.
 *
 * @example
 * ```typescript
 * await prisma.$transaction([
 *   prisma.user.create({ data: userData }),
 *   createOutboxEvent(prisma, {
 *     aggregateId: user.id,
 *     eventType: 'user.created',
 *     payload: { email: user.email, name: user.name }
 *   })
 * ]);
 * ```
 */
export function createOutboxEvent(
  prisma: PrismaClient | PrismaTransactionClient,
  params: CreateOutboxEventParams
) {
  return prisma.outboxEvent.create({
    data: {
      aggregateId: params.aggregateId,
      eventType: params.eventType,
      payload: JSON.stringify(params.payload),
    },
  });
}

/**
 * Helper to create a user with an outbox event in a single transaction
 */
export async function createUserWithEvent(
  prisma: PrismaClient,
  userData: {
    email: string;
    name: string;
    role?: string;
    orgId?: string;
  }
) {
  return await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: userData,
    });

    await createOutboxEvent(tx, {
      aggregateId: user.id,
      eventType: 'user.created',
      payload: {
        userId: user.id,
        email: user.email,
        name: user.name,
      },
    });

    return user;
  });
}
