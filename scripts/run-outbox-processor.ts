import { PrismaClient } from '@prisma/client';
import { startOutboxProcessor } from '../lib/outbox-processor';

/**
 * Outbox Processor Entry Point
 *
 * This script starts the outbox event processor which polls the database
 * for unprocessed events and handles them (e.g., sending welcome emails).
 *
 * Usage:
 *   npm run outbox:process
 *   or
 *   npx tsx scripts/run-outbox-processor.ts
 */

const prisma = new PrismaClient();

let stopProcessor: (() => Promise<void>) | null = null;

// Start the processor
startOutboxProcessor(prisma)
  .then((cleanup) => { // "cleanup" is the cleanup function returned by startOutboxProcessor
    stopProcessor = cleanup;
  })
  .catch((error) => {
    console.error('Failed to start outbox processor:', error);
    process.exit(1);
  });

// Graceful shutdown handler
const shutdownHandler = async (signal: string) => {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  if (stopProcessor) {
    await stopProcessor();
  }
  process.exit(0);
};

process.on('SIGINT', () => shutdownHandler('SIGINT'));
process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
