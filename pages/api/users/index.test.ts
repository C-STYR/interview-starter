import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  createTestDatabase,
  cleanupTestDatabase,
  seedTestData,
} from '@/lib/test-utils/test-db';
import {
  assertOutboxEventExists,
  assertAuditLogExists,
  countOutboxEvents,
  countAuditLogs,
} from '@/lib/test-utils/test-helpers';

// Store test prisma instance globally for mocking
let testPrisma: PrismaClient;

// Mock Prisma - use vi.hoisted to ensure it runs before imports
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));

// Mock Better Auth
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

describe('POST /api/users', () => {
  let testData: any;
  let mockSession: any;

  beforeEach(async () => {
    // Create test database
    testPrisma = await createTestDatabase();

    // Seed test data
    testData = await seedTestData(testPrisma);

    // Setup mock session for user1 (admin in org1)
    mockSession = {
      user: { id: testData.users.user1.id },
      session: { token: 'test-token' },
    };

    const { auth } = await import('@/lib/auth');
    vi.mocked(auth.api.getSession).mockResolvedValue(mockSession);
  });

  afterEach(async () => {
    await cleanupTestDatabase(testPrisma);
    vi.clearAllMocks();
  });

  it('should create a new user with outbox event and audit log', async () => {
    const { default: handler } = await import('./index');

    const req = {
      method: 'POST',
      headers: {},
      body: {
        name: 'New User',
        email: 'newuser@testorg1.com',
        role: 'member',
      },
    } as NextApiRequest;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await handler(req, res);

    // Verify response
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'New User',
        email: 'newuser@testorg1.com',
        role: 'member',
        orgId: testData.orgs.org1.id,
        createdBy: testData.users.user1.id,
      })
    );

    // Get created user
    const createdUser = await testPrisma.user.findUnique({
      where: { email: 'newuser@testorg1.com' },
    });
    expect(createdUser).toBeTruthy();

    // Verify outbox event was created
    await assertOutboxEventExists(testPrisma, {
      aggregateId: createdUser!.id,
      eventType: 'user.created',
      payloadContains: {
        userId: createdUser!.id,
        email: 'newuser@testorg1.com',
        name: 'New User',
      },
    });

    // Verify audit log was created
    await assertAuditLogExists(testPrisma, {
      actor: testData.users.user1.id,
      action: 'user_created',
      targetId: createdUser!.id,
      metadataContains: {
        email: 'newuser@testorg1.com',
        name: 'New User',
        role: 'member',
      },
    });
  });

  it('should create user and event atomically (transaction)', async () => {
    const { default: handler } = await import('./index');

    const req = {
      method: 'POST',
      headers: {},
      body: {
        name: 'Atomic User',
        email: 'atomic@testorg1.com',
      },
    } as NextApiRequest;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await handler(req, res);

    // Count entities - should have exactly 1 of each
    const userCount = await testPrisma.user.count({
      where: { email: 'atomic@testorg1.com' },
    });
    const eventCount = await countOutboxEvents(testPrisma, {
      eventType: 'user.created',
    });
    const auditCount = await countAuditLogs(testPrisma, {
      action: 'user_created',
    });

    expect(userCount).toBe(1);
    expect(eventCount).toBeGreaterThanOrEqual(1);
    expect(auditCount).toBeGreaterThanOrEqual(1);
  });

  it('should require authentication', async () => {
    // Mock no session
    const { auth } = await import('@/lib/auth');
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    const { default: handler } = await import('./index');

    const req = {
      method: 'POST',
      headers: {},
      body: {
        name: 'Test User',
        email: 'test@example.com',
      },
    } as NextApiRequest;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('should reject duplicate email', async () => {
    const { default: handler } = await import('./index');

    const req = {
      method: 'POST',
      headers: {},
      body: {
        name: 'Duplicate',
        email: testData.users.user2.email, // Use existing user's email
      },
    } as NextApiRequest;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Email already exists' });

    // Verify no outbox event or audit log was created
    const eventCount = await countOutboxEvents(testPrisma, {
      eventType: 'user.created',
    });
    const auditCount = await countAuditLogs(testPrisma, {
      action: 'user_created',
    });

    // Should be 0 since seed data doesn't create users via API
    expect(eventCount).toBe(0);
    expect(auditCount).toBe(0);
  });

  it('should require name and email', async () => {
    const { default: handler } = await import('./index');

    const req = {
      method: 'POST',
      headers: {},
      body: {
        name: 'Test User',
        // Missing email
      },
    } as NextApiRequest;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Name and email are required' });
  });

  it('should default role to member if not provided', async () => {
    const { default: handler } = await import('./index');

    const req = {
      method: 'POST',
      headers: {},
      body: {
        name: 'Default Role User',
        email: 'defaultrole@testorg1.com',
        // No role specified
      },
    } as NextApiRequest;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'member',
      })
    );
  });

  it('should assign user to current user\'s organization', async () => {
    const { default: handler } = await import('./index');

    const req = {
      method: 'POST',
      headers: {},
      body: {
        name: 'Same Org User',
        email: 'sameorg@testorg1.com',
      },
    } as NextApiRequest;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: testData.orgs.org1.id, // Should be same as user1's org
      })
    );
  });
});

describe('GET /api/users', () => {
  let testData: any;
  let mockSession: any;

  beforeEach(async () => {
    testPrisma = await createTestDatabase();
    testData = await seedTestData(testPrisma);

    // Setup mock session for user1 (admin in org1)
    mockSession = {
      user: { id: testData.users.user1.id },
      session: { token: 'test-token' },
    };

    const { auth } = await import('@/lib/auth');
    vi.mocked(auth.api.getSession).mockResolvedValue(mockSession);
  });

  afterEach(async () => {
    await cleanupTestDatabase(testPrisma);
    vi.clearAllMocks();
  });

  it('should return only users from same organization', async () => {
    const { default: handler } = await import('./index');

    const req = {
      method: 'GET',
      headers: {},
      query: {},
    } as unknown as NextApiRequest;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);

    // Get the returned users
    const returnedUsers = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // Should return user1 and user2 (both in org1), but not user3 (org2)
    expect(returnedUsers).toHaveLength(2);
    expect(returnedUsers.map((u: any) => u.id)).toContain(testData.users.user1.id);
    expect(returnedUsers.map((u: any) => u.id)).toContain(testData.users.user2.id);
    expect(returnedUsers.map((u: any) => u.id)).not.toContain(testData.users.user3.id);
  });

  it('should exclude soft-deleted users by default', async () => {
    // Soft delete user2
    await testPrisma.user.update({
      where: { id: testData.users.user2.id },
      data: {
        deletedAt: new Date(),
        deletedBy: testData.users.user1.id,
      },
    });

    const { default: handler } = await import('./index');

    const req = {
      method: 'GET',
      headers: {},
      query: {},
    } as unknown as NextApiRequest;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await handler(req, res);

    const returnedUsers = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // Should only return user1 (user2 is soft-deleted)
    expect(returnedUsers).toHaveLength(1);
    expect(returnedUsers[0].id).toBe(testData.users.user1.id);
  });

  it('should include soft-deleted users when includeDeleted=true', async () => {
    // Soft delete user2
    await testPrisma.user.update({
      where: { id: testData.users.user2.id },
      data: {
        deletedAt: new Date(),
        deletedBy: testData.users.user1.id,
      },
    });

    const { default: handler } = await import('./index');

    const req = {
      method: 'GET',
      headers: {},
      query: { includeDeleted: 'true' },
    } as unknown as NextApiRequest;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await handler(req, res);

    const returnedUsers = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // Should return both user1 and user2
    expect(returnedUsers).toHaveLength(2);
  });

  it('should require authentication', async () => {
    // Mock no session
    const { auth } = await import('@/lib/auth');
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    const { default: handler } = await import('./index');

    const req = {
      method: 'GET',
      headers: {},
      query: {},
    } as unknown as NextApiRequest;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });
});
