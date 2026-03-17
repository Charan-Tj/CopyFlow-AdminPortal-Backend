-- AlterTable
ALTER TABLE "Node"
ADD COLUMN "state" TEXT,
ADD COLUMN "pincode" TEXT,
ADD COLUMN "latitude" DECIMAL(10,7),
ADD COLUMN "longitude" DECIMAL(10,7),
ADD COLUMN "contact_name" TEXT,
ADD COLUMN "contact_phone" TEXT,
ADD COLUMN "contact_email" TEXT;
