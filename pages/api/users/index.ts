import type { NextApiRequest, NextApiResponse } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createOutboxEvent } from "@/lib/outbox";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Get session from Better Auth
  const session = await auth.api.getSession({
    headers: new Headers(req.headers as Record<string, string>),
  });

  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Get current user with org
  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
  });

  if (!currentUser?.orgId) {
    return res.status(400).json({ error: "User not associated with an organization" });
  }

  if (req.method === "GET") {
    // Optional query param to include deleted users (admin feature)
    const includeDeleted = req.query.includeDeleted === "true";

    const users = await prisma.user.findMany({
      where: {
        orgId: currentUser.orgId,
        // Filter out soft-deleted users by default
        deletedAt: includeDeleted ? undefined : null,
      },
      orderBy: { createdAt: "desc" },
    });
    return res.status(200).json(users);
  }

  if (req.method === "POST") {
    const { name, email, role } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: "Name and email are required" });
    }

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({ error: "Email already exists" });
    }

    // Create user with audit fields and outbox event in a transaction
    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          name,
          email,
          role: role || "member",
          orgId: currentUser.orgId,
          // Audit fields
          createdBy: currentUser.id,
          updatedBy: null,
          deletedBy: null,
          deletedAt: null,
        },
      });

      // Create outbox event for welcome email
      await createOutboxEvent(tx, {
        aggregateId: newUser.id,
        eventType: 'user.created',
        payload: {
          userId: newUser.id,
          email: newUser.email,
          name: newUser.name,
        },
      });

      // Create audit log entry for user creation
      await tx.auditLog.create({
        data: {
          actor: currentUser.id,
          action: 'user_created',
          targetId: newUser.id,
          metadata: JSON.stringify({
            email: newUser.email,
            name: newUser.name,
            role: newUser.role,
          }),
        },
      });

      return newUser;
    });

    return res.status(201).json(user);
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}
