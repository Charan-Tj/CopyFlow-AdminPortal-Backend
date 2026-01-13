-- CreateTable
CREATE TABLE "PricingConfig" (
    "id" TEXT NOT NULL,
    "bw_price" DECIMAL(10,2) NOT NULL,
    "color_price" DECIMAL(10,2) NOT NULL,
    "author" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PricingConfig_pkey" PRIMARY KEY ("id")
);
