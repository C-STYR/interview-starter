import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    include: { org: true },
  });

  if (users.length === 0) {
    console.log('No users found.');
    return;
  }

  console.log(`\n${users.length} users:\n`);
  console.log(
    'TIMESTAMP'.padEnd(24) +
    'NAME'.padEnd(20) +
    'EMAIL'.padEnd(30) +
    'ROLE'.padEnd(10) +
    'ORG'.padEnd(20) +
    'DELETED'
  );
  console.log('-'.repeat(110));

  for (const user of users) {
    const timestamp = user.createdAt.toISOString().replace('T', ' ').slice(0, 19);
    const name = (user.name.length > 18 ? user.name.slice(0, 15) + '...' : user.name).padEnd(20);
    const email = (user.email.length > 28 ? user.email.slice(0, 25) + '...' : user.email).padEnd(30);
    const role = user.role.padEnd(10);
    const org = (user.org?.name
      ? user.org.name.length > 18 ? user.org.name.slice(0, 15) + '...' : user.org.name
      : '-'
    ).padEnd(20);
    const deleted = user.deletedAt
      ? user.deletedAt.toISOString().replace('T', ' ').slice(0, 19)
      : '-';

    console.log(`${timestamp.padEnd(24)}${name}${email}${role}${org}${deleted}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
