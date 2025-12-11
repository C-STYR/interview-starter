import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "crypto";

const prisma = new PrismaClient();

// Better Auth uses scrypt for password hashing
// Format: hash:salt (both hex encoded)
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${hash}:${salt}`;
}

// Helper to create dates spread over the past N days
function randomDateInPast(maxDaysAgo: number): Date {
  const now = new Date();
  const daysAgo = Math.floor(Math.random() * maxDaysAgo);
  const date = new Date(now);
  date.setDate(date.getDate() - daysAgo);
  return date;
}

async function main() {
  console.log("Seeding database...");

  // Clean up existing data
  await prisma.account.deleteMany();
  await prisma.session.deleteMany();
  await prisma.verification.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();

  // Create organizations with fixed UUIDs for consistency
  const acmeOrg = await prisma.organization.create({
    data: {
      id: "org-acme-corp-uuid",
      name: "Acme Corp",
    },
  });

  const globexOrg = await prisma.organization.create({
    data: {
      id: "org-globex-inc-uuid",
      name: "Globex Inc",
    },
  });

  console.log("Created organizations:", acmeOrg.name, globexOrg.name);

  // Acme Corp users (8-10 users)
  const acmeUsers = [
    { name: "Admin User", email: "admin@acme.com", role: "admin", canLogin: true },
    { name: "Alice Johnson", email: "alice@acme.com", role: "member", canLogin: false },
    { name: "Bob Smith", email: "bob@acme.com", role: "member", canLogin: false },
    { name: "Carol Williams", email: "carol@acme.com", role: "admin", canLogin: false },
    { name: "Dave Brown", email: "dave@acme.com", role: "member", canLogin: false },
    { name: "Eve Davis", email: "eve@acme.com", role: "member", canLogin: false },
    { name: "Frank Miller", email: "frank@acme.com", role: "member", canLogin: false },
    { name: "Grace Wilson", email: "grace@acme.com", role: "member", canLogin: false },
    { name: "Henry Taylor", email: "henry.t@acme.com", role: "member", canLogin: false },
  ];

  // Globex Inc users (5-6 users)
  const globexUsers = [
    { name: "Admin User", email: "admin@globex.com", role: "admin", canLogin: true },
    { name: "Henry Anderson", email: "henry@globex.com", role: "member", canLogin: false },
    { name: "Iris Martinez", email: "iris@globex.com", role: "admin", canLogin: false },
    { name: "Jack Thompson", email: "jack@globex.com", role: "member", canLogin: false },
    { name: "Kate Garcia", email: "kate@globex.com", role: "member", canLogin: false },
    { name: "Leo Robinson", email: "leo@globex.com", role: "member", canLogin: false },
  ];

  // Create Acme users
  for (const userData of acmeUsers) {
    const createdAt = randomDateInPast(30);
    const hasActivity = Math.random() > 0.3;
    const emailVerified = Math.random() > 0.2;

    const user = await prisma.user.create({
      data: {
        name: userData.name,
        email: userData.email,
        role: userData.role,
        orgId: acmeOrg.id,
        emailVerified,
        createdAt,
        lastActivityAt: hasActivity ? randomDateInPast(7) : null,
      },
    });

    // Create account for login-enabled users
    if (userData.canLogin) {
      await prisma.account.create({
        data: {
          userId: user.id,
          accountId: user.id,
          providerId: "credential",
          password: hashPassword("password"),
        },
      });
      console.log(`Created login account for: ${userData.email}`);
    }
  }

  // Create Globex users
  for (const userData of globexUsers) {
    const createdAt = randomDateInPast(30);
    const hasActivity = Math.random() > 0.3;
    const emailVerified = Math.random() > 0.2;

    const user = await prisma.user.create({
      data: {
        name: userData.name,
        email: userData.email,
        role: userData.role,
        orgId: globexOrg.id,
        emailVerified,
        createdAt,
        lastActivityAt: hasActivity ? randomDateInPast(7) : null,
      },
    });

    // Create account for login-enabled users
    if (userData.canLogin) {
      await prisma.account.create({
        data: {
          userId: user.id,
          accountId: user.id,
          providerId: "credential",
          password: hashPassword("password"),
        },
      });
      console.log(`Created login account for: ${userData.email}`);
    }
  }

  const totalUsers = await prisma.user.count();
  console.log(`Seeding complete! Created ${totalUsers} users.`);
  console.log("\nTest credentials:");
  console.log("  admin@acme.com / password");
  console.log("  admin@globex.com / password");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
