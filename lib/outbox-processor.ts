import { PrismaClient } from '@prisma/client';

/**
 * Outbox Event Processor
 *
 * This worker polls the OutboxEvent table and processes unprocessed events.
 * It implements the Transactional Outbox Pattern for reliable event delivery.
 *
 * I have set this up to run on app startup and poll every 5 seconds, 
 * but the prod implementation would be dependent on a number of unknown factors
 * surrounding expected volume and existing infra
 */

const MAX_RETRIES = 3;
const POLL_INTERVAL_MS = 5000; // Poll every 5 seconds
const BATCH_SIZE = 10;

type AuditLogData = {
  actor: string;
  action: string;
  targetId?: string;
  metadata?: Record<string, any>;
} | null;

type EventHandler = (payload: any) => Promise<AuditLogData>;

// Event handlers registry
const eventHandlers: Record<string, EventHandler> = {
  'user.created': async (payload) => {
    console.log('Processing user.created event:', payload);

    // in prod this might look like:
    // await sendWelcomeEmail(payload.email, payload.name);

    // but for this example, we'll simulate the sending
    console.log(`Sending welcome email to ${payload.email}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log(`Welcome email sent to ${payload.email}`);

    // Return audit log data (will be written transactionally)
    return {
      actor: 'system',
      action: 'welcome_email_sent',
      targetId: payload.userId,
      metadata: {
        email: payload.email,
        name: payload.name,
      },
    };
  },

  'digest.weekly': async (payload) => {
    console.log('Processing digest.weekly event:', payload);

    // in prod this might look like:
    // await sendWeeklyDigest(payload.email, payload.name, digestContent);

    // but for this example, we'll simulate the sending
    console.log(`Sending weekly digest to ${payload.email}`);
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log(`Weekly digest sent to ${payload.email}`);

    // Return audit log data (will be written transactionally)
    return {
      actor: 'system',
      action: 'digest_email_sent',
      targetId: payload.userId,
      metadata: {
        email: payload.email,
        name: payload.name,
      },
    };
  },

  // other example handlers which could be implemented using this pattern - anytime we need to dual write
  'user.updated': async (payload) => null,
  'user.deleted': async (payload) => null,
  'organization.created': async (payload) => null,
  // etc, etc
};

/**
 * Process a single outbox event
 */
async function processEvent(
  prisma: PrismaClient,
  event: {
    id: string;
    eventType: string;
    payload: string;
    attempts: number;
  }
) {
  const handler = eventHandlers[event.eventType];

  // short circuit if no handler
  if (!handler) {
    console.warn(`No handler registered for event type: ${event.eventType}`);
    // Mark as processed to avoid retrying forever
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        processed: true,
        processedAt: new Date(),
        lastError: `No handler registered for event type: ${event.eventType}`,
      },
    });
    return;
  }

  try {
    const payload = JSON.parse(event.payload);
    const auditLogData = await handler(payload);

    // Mark as successfully processed and write audit log in a single transaction
    await prisma.$transaction(async (tx) => {
      // Mark event as processed
      await tx.outboxEvent.update({
        where: { id: event.id },
        data: {
          processed: true,
          processedAt: new Date(),
          attempts: event.attempts + 1,
        },
      });

      // Write audit log if handler returned data
      if (auditLogData) {
        await tx.auditLog.create({
          data: {
            actor: auditLogData.actor,
            action: auditLogData.action,
            targetId: auditLogData.targetId || null,
            metadata: auditLogData.metadata ? JSON.stringify(auditLogData.metadata) : null,
          },
        });
      }
    });

    console.log(`Event ${event.id} (${event.eventType}) processed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const newAttempts = event.attempts + 1;

    console.error(`Error processing event ${event.id}:`, errorMessage);

    if (newAttempts >= MAX_RETRIES) {
      // Max retries reached, mark as processed with error
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          processed: true,
          processedAt: new Date(),
          attempts: newAttempts,
          lastError: `Max retries (${MAX_RETRIES}) exceeded: ${errorMessage}`,
        },
      });
      console.error(`Event ${event.id} failed after ${MAX_RETRIES} attempts`);
    } else {
      // Update attempts and error, will retry next poll
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          attempts: newAttempts,
          lastError: errorMessage,
        },
      });
      console.log(`Will retry event ${event.id} (attempt ${newAttempts}/${MAX_RETRIES})`);
    }
  }
}

/**
 * Poll and process outbox events
 */
async function pollAndProcess(prisma: PrismaClient) {
  try {
    // Fetch unprocessed events
    const events = await prisma.outboxEvent.findMany({
      where: {
        processed: false,
        attempts: {
          lt: MAX_RETRIES,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
      take: BATCH_SIZE,
    });

    if (events.length > 0) {
      console.log(`Processing ${events.length} outbox events...`);

      // Process events sequentially to avoid overwhelming external services
      for (const event of events) {
        await processEvent(prisma, event);
      }
    }
  } catch (error) {
    console.error('Error polling outbox events:', error);
  }
}

/**
 * Start the outbox processor
 *
 * @returns A cleanup function to stop the processor and disconnect Prisma
 */
export async function startOutboxProcessor(prisma: PrismaClient): Promise<() => Promise<void>> {
  console.log('Starting outbox processor...');
  console.log(`   Polling interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`   Batch size: ${BATCH_SIZE}`);
  console.log(`   Max retries: ${MAX_RETRIES}`);

  // Poll immediately
  await pollAndProcess(prisma);

  // Then poll at intervals
  const intervalId = setInterval(() => {
    pollAndProcess(prisma);
  }, POLL_INTERVAL_MS);

  // Return cleanup function
  return async () => {
    console.log('Stopping outbox processor...');
    clearInterval(intervalId);
    await prisma.$disconnect();
    console.log('Outbox processor stopped and Prisma disconnected');
  };
}
