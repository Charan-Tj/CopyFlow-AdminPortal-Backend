-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('UPLOADED', 'PAID', 'PRINTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ColorMode" AS ENUM ('BW', 'COLOR');

-- CreateTable
CREATE TABLE "Kiosk" (
    "pi_id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Kiosk_pkey" PRIMARY KEY ("pi_id")
);

-- CreateTable
CREATE TABLE "PrintJob" (
    "job_id" TEXT NOT NULL,
    "kiosk_id" TEXT NOT NULL,
    "page_count" INTEGER NOT NULL,
    "color_mode" "ColorMode" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'UPLOADED',
    "payable_amount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("job_id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "razorpay_order_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintToken" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "actor" TEXT,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_job_id_key" ON "Payment"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_razorpay_order_id_key" ON "Payment"("razorpay_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "PrintToken_job_id_key" ON "PrintToken"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "PrintToken_token_hash_key" ON "PrintToken"("token_hash");

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "Kiosk"("pi_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "PrintJob"("job_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintToken" ADD CONSTRAINT "PrintToken_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "PrintJob"("job_id") ON DELETE RESTRICT ON UPDATE CASCADE;
