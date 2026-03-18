ALTER TABLE "Payment" RENAME COLUMN "razorpay_order_id" TO "provider_order_id";
ALTER INDEX "Payment_razorpay_order_id_key" RENAME TO "Payment_provider_order_id_key";
