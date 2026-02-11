import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";
import { createOutboxEvent } from "@/lib/outbox";

/**
 * Weekly Digest Cron Endpoint
 *
 * This endpoint creates outbox events for sending weekly digest emails to all active users.
 * It should be called once per week by a cron service (e.g., GitHub Actions, Vercel Cron, cron-job.org).
 *
 * Usage:
 *   POST /api/cron/weekly-digest
 *   Authorization: Bearer <CRON_SECRET> (optional, for production)
 *
 * For testing:
 *   curl -X POST http://localhost:3000/api/cron/weekly-digest
 */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  // Authentication: Required in production, optional in development
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    // If CRON_SECRET is set, require authentication
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  } else if (process.env.NODE_ENV === 'production') {
    // In production, CRON_SECRET must be set
    console.error('CRON_SECRET not set in production environment');
    return res.status(500).json({ error: "Server configuration error" });
  }
  // In development without CRON_SECRET: allow through for testing

  try {
    // Check if we already created digest events recently (within last 6 days)
    // This prevents accidental duplicate runs
    const sixDaysAgo = new Date();
    sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);

    const recentDigestEvent = await prisma.outboxEvent.findFirst({
      where: {
        eventType: 'digest.weekly',
        createdAt: {
          gte: sixDaysAgo,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (recentDigestEvent) {
      return res.status(200).json({
        message: "Digest events already created recently",
        lastCreated: recentDigestEvent.createdAt,
      });
    }

    // Get all active users (not soft-deleted)
    const users = await prisma.user.findMany({
      where: {
        deletedAt: null,
      },
      select: {
        id: true,
        email: true,
        name: true,
      },
    });

    if (users.length === 0) {
      return res.status(200).json({
        message: "No active users to send digest to",
        userCount: 0,
      });
    }

    // Create outbox events for all users in a transaction
    await prisma.$transaction(async (tx) => {
      for (const user of users) {
        await createOutboxEvent(tx, {
          aggregateId: user.id,
          eventType: 'digest.weekly',
          payload: {
            userId: user.id,
            email: user.email,
            name: user.name,
          },
        });
      }
    });

    return res.status(200).json({
      message: "Weekly digest events created successfully",
      userCount: users.length,
    });
  } catch (error) {
    console.error("Error creating weekly digest events:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
