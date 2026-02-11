import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { randomBytes } from 'crypto';
import { unlinkSync, existsSync } from 'fs';
import path from 'path';

/**
 * Test Database Utilities
 *
 * Provides isolated test databases for each test file to prevent test pollution.
 * Each test gets a fresh database with migrations applied.
 */

// Track created databases for cleanup
const createdDatabases: string[] = [];

/**
 * Create an isolated test database with migrations applied
 *
 * @returns Prisma client connected to the test database
 */
export async function createTestDatabase(): Promise<PrismaClient> {
  // Generate unique database name
  const dbName = `test-${randomBytes(8).toString('hex')}.db`;
  const dbPath = path.resolve(__dirname, '../../prisma', dbName);
  const dbUrl = `file:${dbPath}`;

  // Track for cleanup
  createdDatabases.push(dbPath);

  // Set DATABASE_URL for Prisma CLI
  process.env.DATABASE_URL = dbUrl;

  // Run migrations to create schema
  try {
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: 'ignore', // Suppress output
    });
  } catch (error) {
    console.error('Failed to run migrations:', error);
    throw error;
  }

  // Create Prisma client
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: dbUrl,
      },
    },
  });

  return prisma;
}

/**
 * Clean up test database
 *
 * @param prisma - Prisma client to disconnect and cleanup
 */
export async function cleanupTestDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Clean up all test databases (called after all tests)
 */
export function cleanupAllTestDatabases(): void {
  for (const dbPath of createdDatabases) {
    try {
      if (existsSync(dbPath)) {
        unlinkSync(dbPath);
      }
      // Also remove journal files if they exist
      const journalPath = `${dbPath}-journal`;
      if (existsSync(journalPath)) {
        unlinkSync(journalPath);
      }
    } catch (error) {
      console.error(`Failed to delete test database ${dbPath}:`, error);
    }
  }
  createdDatabases.length = 0;
}

/**
 * Seed test data - creates organizations and users for testing
 *
 * @param prisma - Prisma client
 * @returns Object containing created test data
 */
export async function seedTestData(prisma: PrismaClient) {
  // Create organizations
  const org1 = await prisma.organization.create({
    data: { name: 'Test Org 1' },
  });

  const org2 = await prisma.organization.create({
    data: { name: 'Test Org 2' },
  });

  // For testing, we'll use a simple hash instead of Better Auth's hashPassword
  // to avoid import issues. In real tests that need actual authentication,
  // you would use the proper hashPassword function.
  const testPasswordHash = 'test-hash-not-for-production';

  // Create users in org1
  const user1 = await prisma.user.create({
    data: {
      email: 'test1@testorg1.com',
      name: 'Test User 1',
      role: 'admin',
      orgId: org1.id,
      emailVerified: true,
    },
  });

  // Create account with password for user1
  await prisma.account.create({
    data: {
      userId: user1.id,
      accountId: user1.id,
      providerId: 'credential',
      password: testPasswordHash,
    },
  });

  const user2 = await prisma.user.create({
    data: {
      email: 'test2@testorg1.com',
      name: 'Test User 2',
      role: 'member',
      orgId: org1.id,
      emailVerified: true,
    },
  });

  // Create account with password for user2
  await prisma.account.create({
    data: {
      userId: user2.id,
      accountId: user2.id,
      providerId: 'credential',
      password: testPasswordHash,
    },
  });

  // Create user in org2
  const user3 = await prisma.user.create({
    data: {
      email: 'test3@testorg2.com',
      name: 'Test User 3',
      role: 'admin',
      orgId: org2.id,
      emailVerified: true,
    },
  });

  // Create account with password for user3
  await prisma.account.create({
    data: {
      userId: user3.id,
      accountId: user3.id,
      providerId: 'credential',
      password: testPasswordHash,
    },
  });

  return {
    orgs: { org1, org2 },
    users: { user1, user2, user3 },
  };
}

/**
 * Create a test session for a user (for authenticated API requests)
 *
 * @param prisma - Prisma client
 * @param userId - User ID to create session for
 * @returns Session token
 */
export async function createTestSession(
  prisma: PrismaClient,
  userId: string
): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days

  await prisma.session.create({
    data: {
      userId,
      token,
      expiresAt,
    },
  });

  return token;
}
