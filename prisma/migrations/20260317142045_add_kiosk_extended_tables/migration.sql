-- CreateEnum
CREATE TYPE "KioskRuntimeStatus" AS ENUM ('ONLINE', 'OFFLINE', 'DEGRADED');

-- AlterTable
ALTER TABLE "Kiosk" ADD COLUMN     "agent_version" TEXT,
ADD COLUMN     "host_name" TEXT,
ADD COLUMN     "ip_address" TEXT,
ADD COLUMN     "last_startup_at" TIMESTAMP(3),
ADD COLUMN     "latitude" DECIMAL(10,7),
ADD COLUMN     "longitude" DECIMAL(10,7),
ADD COLUMN     "os_name" TEXT,
ADD COLUMN     "runtime_status" "KioskRuntimeStatus" NOT NULL DEFAULT 'OFFLINE';

-- AlterTable
ALTER TABLE "PrintJob" ADD COLUMN     "assigned_printer" TEXT,
ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "document_name" TEXT,
ADD COLUMN     "error_category" TEXT,
ADD COLUMN     "error_message" TEXT,
ADD COLUMN     "final_status" TEXT,
ADD COLUMN     "finish_time" TIMESTAMP(3),
ADD COLUMN     "latency_ms" INTEGER,
ADD COLUMN     "queue_time" TIMESTAMP(3),
ADD COLUMN     "retry_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "start_time" TIMESTAMP(3),
ADD COLUMN     "user_name" TEXT;

-- CreateTable
CREATE TABLE "KioskPrinterSnapshot" (
    "id" TEXT NOT NULL,
    "kiosk_id" TEXT NOT NULL,
    "node_id" TEXT,
    "printer_name" TEXT NOT NULL,
    "driver_name" TEXT,
    "port_name" TEXT,
    "is_online" BOOLEAN NOT NULL DEFAULT true,
    "status_code" INTEGER,
    "health_score" INTEGER,
    "ink_level_black" INTEGER,
    "ink_level_cyan" INTEGER,
    "ink_level_magenta" INTEGER,
    "ink_level_yellow" INTEGER,
    "toner_level" INTEGER,
    "paper_estimate" INTEGER,
    "consumables" JSONB,
    "snmp_sampled_at" TIMESTAMP(3),
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KioskPrinterSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KioskPrinterConsumable" (
    "id" TEXT NOT NULL,
    "printer_snapshot_id" TEXT NOT NULL,
    "consumable_index" TEXT NOT NULL,
    "description" TEXT,
    "level_value" INTEGER,
    "max_value" INTEGER,
    "percent" INTEGER,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KioskPrinterConsumable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KioskJobLifecycle" (
    "id" TEXT NOT NULL,
    "kiosk_id" TEXT NOT NULL,
    "node_id" TEXT,
    "job_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT,
    "attempt_no" INTEGER,
    "retry_no" INTEGER,
    "latency_ms" INTEGER,
    "error_category" TEXT,
    "error_message" TEXT,
    "assigned_printer" TEXT,
    "actor" TEXT,
    "payload" JSONB,

    CONSTRAINT "KioskJobLifecycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KioskDailyMetric" (
    "id" TEXT NOT NULL,
    "kiosk_id" TEXT NOT NULL,
    "node_id" TEXT,
    "metric_date" TIMESTAMP(3) NOT NULL,
    "pages_printed" INTEGER NOT NULL DEFAULT 0,
    "revenue_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "failed_paid_jobs" INTEGER NOT NULL DEFAULT 0,
    "reconciliation_delta" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "successful_jobs" INTEGER NOT NULL DEFAULT 0,
    "failed_jobs" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KioskDailyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KioskPaymentEvent" (
    "id" TEXT NOT NULL,
    "kiosk_id" TEXT NOT NULL,
    "node_id" TEXT,
    "job_id" TEXT,
    "payment_id" TEXT,
    "event_type" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "currency" TEXT DEFAULT 'INR',
    "reference" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KioskPaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KioskSystemLog" (
    "id" TEXT NOT NULL,
    "kiosk_id" TEXT NOT NULL,
    "node_id" TEXT,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KioskSystemLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KioskNotification" (
    "id" TEXT NOT NULL,
    "kiosk_id" TEXT NOT NULL,
    "node_id" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "acknowledged_at" TIMESTAMP(3),
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KioskNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KioskFailureDiagnostic" (
    "id" TEXT NOT NULL,
    "kiosk_id" TEXT NOT NULL,
    "node_id" TEXT,
    "job_id" TEXT,
    "error_category" TEXT NOT NULL,
    "error_message" TEXT NOT NULL,
    "diagnostic_payload" JSONB,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KioskFailureDiagnostic_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KioskPrinterSnapshot_kiosk_id_captured_at_idx" ON "KioskPrinterSnapshot"("kiosk_id", "captured_at");

-- CreateIndex
CREATE INDEX "KioskPrinterSnapshot_printer_name_captured_at_idx" ON "KioskPrinterSnapshot"("printer_name", "captured_at");

-- CreateIndex
CREATE INDEX "KioskPrinterConsumable_printer_snapshot_id_idx" ON "KioskPrinterConsumable"("printer_snapshot_id");

-- CreateIndex
CREATE INDEX "KioskPrinterConsumable_consumable_index_idx" ON "KioskPrinterConsumable"("consumable_index");

-- CreateIndex
CREATE INDEX "KioskJobLifecycle_kiosk_id_event_time_idx" ON "KioskJobLifecycle"("kiosk_id", "event_time");

-- CreateIndex
CREATE INDEX "KioskJobLifecycle_job_id_event_time_idx" ON "KioskJobLifecycle"("job_id", "event_time");

-- CreateIndex
CREATE INDEX "KioskJobLifecycle_event_type_idx" ON "KioskJobLifecycle"("event_type");

-- CreateIndex
CREATE INDEX "KioskDailyMetric_node_id_metric_date_idx" ON "KioskDailyMetric"("node_id", "metric_date");

-- CreateIndex
CREATE UNIQUE INDEX "KioskDailyMetric_kiosk_id_metric_date_key" ON "KioskDailyMetric"("kiosk_id", "metric_date");

-- CreateIndex
CREATE INDEX "KioskPaymentEvent_kiosk_id_created_at_idx" ON "KioskPaymentEvent"("kiosk_id", "created_at");

-- CreateIndex
CREATE INDEX "KioskPaymentEvent_job_id_idx" ON "KioskPaymentEvent"("job_id");

-- CreateIndex
CREATE INDEX "KioskPaymentEvent_payment_id_idx" ON "KioskPaymentEvent"("payment_id");

-- CreateIndex
CREATE INDEX "KioskSystemLog_kiosk_id_created_at_idx" ON "KioskSystemLog"("kiosk_id", "created_at");

-- CreateIndex
CREATE INDEX "KioskSystemLog_level_created_at_idx" ON "KioskSystemLog"("level", "created_at");

-- CreateIndex
CREATE INDEX "KioskNotification_kiosk_id_created_at_idx" ON "KioskNotification"("kiosk_id", "created_at");

-- CreateIndex
CREATE INDEX "KioskNotification_severity_created_at_idx" ON "KioskNotification"("severity", "created_at");

-- CreateIndex
CREATE INDEX "KioskFailureDiagnostic_kiosk_id_created_at_idx" ON "KioskFailureDiagnostic"("kiosk_id", "created_at");

-- CreateIndex
CREATE INDEX "KioskFailureDiagnostic_job_id_idx" ON "KioskFailureDiagnostic"("job_id");

-- CreateIndex
CREATE INDEX "KioskFailureDiagnostic_error_category_created_at_idx" ON "KioskFailureDiagnostic"("error_category", "created_at");

-- AddForeignKey
ALTER TABLE "KioskPrinterSnapshot" ADD CONSTRAINT "KioskPrinterSnapshot_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "Kiosk"("pi_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskPrinterSnapshot" ADD CONSTRAINT "KioskPrinterSnapshot_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskPrinterConsumable" ADD CONSTRAINT "KioskPrinterConsumable_printer_snapshot_id_fkey" FOREIGN KEY ("printer_snapshot_id") REFERENCES "KioskPrinterSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskJobLifecycle" ADD CONSTRAINT "KioskJobLifecycle_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "Kiosk"("pi_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskJobLifecycle" ADD CONSTRAINT "KioskJobLifecycle_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskJobLifecycle" ADD CONSTRAINT "KioskJobLifecycle_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "PrintJob"("job_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskDailyMetric" ADD CONSTRAINT "KioskDailyMetric_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "Kiosk"("pi_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskDailyMetric" ADD CONSTRAINT "KioskDailyMetric_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskPaymentEvent" ADD CONSTRAINT "KioskPaymentEvent_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "Kiosk"("pi_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskPaymentEvent" ADD CONSTRAINT "KioskPaymentEvent_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskPaymentEvent" ADD CONSTRAINT "KioskPaymentEvent_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "PrintJob"("job_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskPaymentEvent" ADD CONSTRAINT "KioskPaymentEvent_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskSystemLog" ADD CONSTRAINT "KioskSystemLog_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "Kiosk"("pi_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskSystemLog" ADD CONSTRAINT "KioskSystemLog_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskNotification" ADD CONSTRAINT "KioskNotification_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "Kiosk"("pi_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskNotification" ADD CONSTRAINT "KioskNotification_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskFailureDiagnostic" ADD CONSTRAINT "KioskFailureDiagnostic_kiosk_id_fkey" FOREIGN KEY ("kiosk_id") REFERENCES "Kiosk"("pi_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskFailureDiagnostic" ADD CONSTRAINT "KioskFailureDiagnostic_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskFailureDiagnostic" ADD CONSTRAINT "KioskFailureDiagnostic_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "PrintJob"("job_id") ON DELETE SET NULL ON UPDATE CASCADE;
