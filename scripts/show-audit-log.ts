import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
  });

  if (logs.length === 0) {
    console.log('No audit log entries found.');
    return;
  }

  console.log(`\n${logs.length} audit log entries:\n`);
  console.log(
    'TIMESTAMP'.padEnd(24) +
    'ACTOR'.padEnd(16) +
    'ACTION'.padEnd(24) +
    'TARGET'.padEnd(20) +
    'METADATA'
  );
  console.log('-'.repeat(100));

  for (const log of logs) {
    const timestamp = log.createdAt.toISOString().replace('T', ' ').slice(0, 19);
    const actor = (log.actor.length > 14 ? log.actor.slice(0, 11) + '...' : log.actor).padEnd(16);
    const action = log.action.padEnd(24);
    const target = (log.targetId
      ? log.targetId.length > 18 ? log.targetId.slice(0, 15) + '...' : log.targetId
      : '-'
    ).padEnd(20);
    const metadata = log.metadata || '-';

    console.log(`${timestamp.padEnd(24)}${actor}${action}${target}${metadata}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
