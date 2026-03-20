CREATE INDEX IF NOT EXISTS "PrintJob_node_id_status_createdAt_idx"
ON "PrintJob"("node_id", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "PrintJob_node_id_updatedAt_idx"
ON "PrintJob"("node_id", "updatedAt");

CREATE INDEX IF NOT EXISTS "PrintJob_node_id_status_claimed_at_createdAt_idx"
ON "PrintJob"("node_id", "status", "claimed_at", "createdAt");
