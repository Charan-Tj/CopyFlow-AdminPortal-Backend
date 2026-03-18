-- Backfill file_urls from legacy file_url before dropping old column.
UPDATE "PrintJob"
SET "file_urls" = jsonb_build_array("file_url")
WHERE "file_urls" IS NULL AND "file_url" IS NOT NULL;

ALTER TABLE "PrintJob"
DROP COLUMN "file_url";
