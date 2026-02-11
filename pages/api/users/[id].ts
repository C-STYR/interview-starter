import type { NextApiRequest, NextApiResponse } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query;

  if (typeof id !== "string") {
    return res.status(400).json({ error: "Invalid user ID" });
  }

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

  // Find the requested user
  const user = await prisma.user.findUnique({
    where: { id },
    include: { org: true },
  });

  // Check if user exists and belongs to the same org
  if (!user || user.orgId !== currentUser.orgId) {
    return res.status(404).json({ error: "User not found" });
  }

  // Check if user is soft-deleted (unless specifically including deleted)
  const includeDeleted = req.query.includeDeleted === "true";
  if (user.deletedAt && !includeDeleted) {
    return res.status(404).json({ error: "User not found" });
  }

  if (req.method === "GET") {
    return res.status(200).json(user);
  }

  if (req.method === "DELETE") {
    // Prevent deleting yourself
    if (user.id === currentUser.id) {
      return res.status(400).json({ error: "Cannot delete yourself" });
    }

    // Check if already soft-deleted
    if (user.deletedAt) {
      return res.status(400).json({ error: "User already deleted" });
    }

    // Soft delete: set deletedAt and deletedBy
    await prisma.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.id,
      },
    });

    return res.status(200).json({ message: "User deleted" });
  }

  res.setHeader("Allow", ["GET", "DELETE"]);
  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}
