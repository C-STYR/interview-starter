-- CreateTable
CREATE TABLE "DigestBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "idempotencyKey" TEXT,
    "userCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "DigestBatch_idempotencyKey_key" ON "DigestBatch"("idempotencyKey");

-- CreateIndex
CREATE INDEX "DigestBatch_createdAt_idx" ON "DigestBatch"("createdAt");
