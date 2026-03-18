-- Add support for multi-file print jobs while preserving legacy single-file column.
ALTER TABLE "PrintJob"
ADD COLUMN "file_urls" JSONB;
