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
 *   Idempotency-Key: <unique-key> (optional, recommended for production)
 *
 * Idempotency:
 *   If an Idempotency-Key header is provided, the same key will always return the same result.
 *   This is the ONLY duplicate prevention mechanism - use it to prevent duplicate digest runs.
 *   Recommended format: ISO week date (e.g., "2026-W07") or UUID for manual runs.
 *
 * For testing:
 *   curl -X POST http://localhost:3000/api/cron/weekly-digest
 *   curl -X POST http://localhost:3000/api/cron/weekly-digest -H "Idempotency-Key: 2026-W07"
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
    // Check for idempotency key
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

    // If idempotency key is provided, check if we've already processed this request
    if (idempotencyKey) {
      const existingBatch = await prisma.digestBatch.findUnique({
        where: { idempotencyKey },
      });

      if (existingBatch) {
        // Return cached response for this idempotency key
        return res.status(200).json({
          message: existingBatch.status === 'completed'
            ? "Digest events already created for this idempotency key"
            : "Previous attempt with this idempotency key failed",
          userCount: existingBatch.userCount,
          status: existingBatch.status,
          createdAt: existingBatch.createdAt,
          idempotent: true,
        });
      }
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

    // Create outbox events for all users and record batch in a transaction
    await prisma.$transaction(async (tx) => {
      // Create outbox events for all users
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

      // Record this batch for idempotency tracking
      await tx.digestBatch.create({
        data: {
          idempotencyKey: idempotencyKey || null,
          userCount: users.length,
          status: 'completed',
        },
      });
    });

    return res.status(200).json({
      message: "Weekly digest events created successfully",
      userCount: users.length,
      idempotencyKey: idempotencyKey || undefined,
    });
  } catch (error) {
    console.error("Error creating weekly digest events:", error);

    // Record failed batch if idempotency key was provided
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
    if (idempotencyKey) {
      try {
        await prisma.digestBatch.create({
          data: {
            idempotencyKey,
            userCount: 0,
            status: 'failed',
          },
        });
      } catch (batchError) {
        // Ignore errors when recording failure (e.g., duplicate key)
        console.error("Error recording failed batch:", batchError);
      }
    }

    return res.status(500).json({ error: "Internal server error" });
  }
}
