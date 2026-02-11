import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import { createOutboxEvent } from "../lib/outbox";

const prisma = new PrismaClient();

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
  // await prisma.outboxEvent.deleteMany(); // Will be available after migration

  // Hash the password once using Better Auth's hasher
  const hashedPassword = await hashPassword("password");
  console.log("Password hashed successfully");

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

  // Create Acme users with outbox events
  let acmeAdminId: string | null = null;

  for (const userData of acmeUsers) {
    const createdAt = randomDateInPast(30);
    const hasActivity = Math.random() > 0.3;
    const emailVerified = Math.random() > 0.2;
    const isFirstAdmin = userData.role === "admin" && acmeAdminId === null;

    // Use transaction to ensure user + outbox event are created atomically
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: userData.name,
          email: userData.email,
          role: userData.role,
          orgId: acmeOrg.id,
          emailVerified,
          createdAt,
          lastActivityAt: hasActivity ? randomDateInPast(7) : null,
          // First admin is system-created, others are created by admin
          createdBy: isFirstAdmin ? null : acmeAdminId,
          updatedBy: null,
          deletedBy: null,
          deletedAt: null,
        },
      });

      // Track first admin for audit trail
      if (isFirstAdmin) {
        acmeAdminId = user.id;
      }

      // Create outbox event for welcome email
      await createOutboxEvent(tx, {
        aggregateId: user.id,
        eventType: 'user.created',
        payload: {
          userId: user.id,
          email: user.email,
          name: user.name,
        },
      });

      // Create account for login-enabled users
      if (userData.canLogin) {
        await tx.account.create({
          data: {
            userId: user.id,
            accountId: user.id,
            providerId: "credential",
            password: hashedPassword,
          },
        });
        console.log(`Created login account for: ${userData.email}`);
      }
    });
  }

  // Create Globex users with outbox events
  let globexAdminId: string | null = null;

  for (const userData of globexUsers) {
    const createdAt = randomDateInPast(30);
    const hasActivity = Math.random() > 0.3;
    const emailVerified = Math.random() > 0.2;
    const isFirstAdmin = userData.role === "admin" && globexAdminId === null;

    // Use transaction to ensure user + outbox event are created atomically
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: userData.name,
          email: userData.email,
          role: userData.role,
          orgId: globexOrg.id,
          emailVerified,
          createdAt,
          lastActivityAt: hasActivity ? randomDateInPast(7) : null,
          // First admin is system-created, others are created by admin
          createdBy: isFirstAdmin ? null : globexAdminId,
          updatedBy: null,
          deletedBy: null,
          deletedAt: null,
        },
      });

      // Track first admin for audit trail
      if (isFirstAdmin) {
        globexAdminId = user.id;
      }

      // Create outbox event for welcome email
      await createOutboxEvent(tx, {
        aggregateId: user.id,
        eventType: 'user.created',
        payload: {
          userId: user.id,
          email: user.email,
          name: user.name,
        },
      });

      // Create account for login-enabled users
      if (userData.canLogin) {
        await tx.account.create({
          data: {
            userId: user.id,
            accountId: user.id,
            providerId: "credential",
            password: hashedPassword,
          },
        });
        console.log(`Created login account for: ${userData.email}`);
      }
    });
  }

  const totalUsers = await prisma.user.count();
  const totalOutboxEvents = await (prisma as any).outboxEvent?.count() ?? 0;
  console.log(`\nSeeding complete!`);
  console.log(`  Created ${totalUsers} users`);
  console.log(`  Created ${totalOutboxEvents} outbox events (for welcome emails)`);
  console.log("\nTest credentials:");
  console.log("  admin@acme.com / password");
  console.log("  admin@globex.com / password");
  console.log("\nRun the outbox processor to send welcome emails:");
  console.log("   npm run outbox:process");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
