/*
  Warnings:

  - Added the required column `node_id` to the `Kiosk` table without a default value. This is not possible if the table is not empty.
  - Added the required column `node_id` to the `PrintJob` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "node_id" TEXT;

-- AlterTable
ALTER TABLE "Kiosk" ADD COLUMN     "node_id" TEXT NOT NULL,
ADD COLUMN     "printer_list" JSONB;

-- AlterTable
ALTER TABLE "PricingConfig" ADD COLUMN     "node_id" TEXT;

-- AlterTable
ALTER TABLE "PrintJob" ADD COLUMN     "claimed_at" TIMESTAMP(3),
ADD COLUMN     "claimed_by" TEXT,
ADD COLUMN     "copies" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "file_checksum" TEXT,
ADD COLUMN     "file_url" TEXT,
ADD COLUMN     "node_id" TEXT NOT NULL,
ADD COLUMN     "phone_number" TEXT,
ADD COLUMN     "sides" TEXT NOT NULL DEFAULT 'single';

-- CreateTable
CREATE TABLE "Node" (
    "id" TEXT NOT NULL,
    "node_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "college" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "qr_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeCredential" (
    "id" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'OPERATOR',
    "last_login" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NodeCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Node_node_code_key" ON "Node"("node_code");

-- CreateIndex
CREATE UNIQUE INDEX "Node_qr_token_key" ON "Node"("qr_token");

-- CreateIndex
CREATE UNIQUE INDEX "NodeCredential_email_key" ON "NodeCredential"("email");

-- AddForeignKey
ALTER TABLE "Kiosk" ADD CONSTRAINT "Kiosk_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "Node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "Node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingConfig" ADD CONSTRAINT "PricingConfig_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeCredential" ADD CONSTRAINT "NodeCredential_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "Node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
