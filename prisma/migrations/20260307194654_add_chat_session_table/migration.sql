-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "job_id" TEXT,
    "node_id" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatSession_sender_key" ON "ChatSession"("sender");

-- CreateIndex
CREATE INDEX "ChatSession_job_id_idx" ON "ChatSession"("job_id");
