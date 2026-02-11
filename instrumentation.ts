/**
 * Next.js Instrumentation Hook
 *
 * This file runs once when the Next.js server starts.
 * Use it to initialize background services like the outbox processor.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

let stopOutboxProcessor: (() => Promise<void>) | null = null;

export async function register() {
  // Only run in Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { prisma } = await import('./lib/prisma');
    const { startOutboxProcessor } = await import('./lib/outbox-processor');

    console.log('Initializing outbox processor on app startup...');
    stopOutboxProcessor = await startOutboxProcessor(prisma);

    // Handle graceful shutdown on process signals
    const shutdownHandler = async (signal: string) => {
      console.log(`\nReceived ${signal}, shutting down gracefully...`);
      if (stopOutboxProcessor) {
        await stopOutboxProcessor();
      }
      process.exit(0);
    };

    process.on('SIGINT', () => shutdownHandler('SIGINT'));
    process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
  }
}
