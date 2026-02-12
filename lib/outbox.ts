import { PrismaClient } from '@prisma/client';

// example types - only user.created and digest.weekly are implemented...
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
 * This function directly supports the Transactional Outbox 
 * Pattern by allowing you to create an event within the same transaction 
 * as your business logic, ensuring that the event is only 
 * created if the transaction commits successfully.
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
