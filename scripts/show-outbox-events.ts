import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const events = await prisma.outboxEvent.findMany({
    orderBy: { createdAt: 'desc' },
  });

  if (events.length === 0) {
    console.log('No outbox events found.');
    return;
  }

  console.log(`\n${events.length} outbox events:\n`);
  console.log(
    'TIMESTAMP'.padEnd(24) +
    'EVENT TYPE'.padEnd(24) +
    'AGGREGATE ID'.padEnd(20) +
    'PROCESSED'.padEnd(12) +
    'ATTEMPTS'.padEnd(10) +
    'LAST ERROR'
  );
  console.log('-'.repeat(110));

  for (const event of events) {
    const timestamp = event.createdAt.toISOString().replace('T', ' ').slice(0, 19);
    const eventType = event.eventType.padEnd(24);
    const aggregateId = (event.aggregateId.length > 18
      ? event.aggregateId.slice(0, 15) + '...'
      : event.aggregateId
    ).padEnd(20);
    const processed = (event.processed
      ? event.processedAt?.toISOString().replace('T', ' ').slice(0, 19) ?? 'yes'
      : '-'
    ).padEnd(12);
    const attempts = String(event.attempts).padEnd(10);
    const lastError = event.lastError
      ? event.lastError.length > 30 ? event.lastError.slice(0, 27) + '...' : event.lastError
      : '-';

    console.log(`${timestamp.padEnd(24)}${eventType}${aggregateId}${processed}${attempts}${lastError}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
