import type { NextApiRequest, NextApiResponse } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";

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
    const users = await prisma.user.findMany({
      where: { orgId: currentUser.orgId },
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

    const user = await prisma.user.create({
      data: {
        name,
        email,
        role: role || "member",
        orgId: currentUser.orgId,
      },
    });

    return res.status(201).json(user);
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}
