-- CreateEnum
CREATE TYPE "CafeOrderStatus" AS ENUM ('PREPARING', 'READY', 'SERVED');

-- CreateEnum
CREATE TYPE "CafeOrderPaymentStatus" AS ENUM ('NOT_TRACKED');

-- CreateTable
CREATE TABLE "cafe_orders" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "status" "CafeOrderStatus" NOT NULL DEFAULT 'PREPARING',
    "createdById" TEXT NOT NULL,
    "customerName" TEXT,
    "totalAed" DECIMAL(10,2) NOT NULL,
    "paymentStatus" "CafeOrderPaymentStatus" NOT NULL DEFAULT 'NOT_TRACKED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cafe_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cafe_order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "unitPriceAed" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "cafe_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cafe_orders_orderNumber_key" ON "cafe_orders"("orderNumber");

-- CreateIndex
CREATE INDEX "cafe_orders_createdAt_id_idx" ON "cafe_orders"("createdAt", "id");

-- CreateIndex
CREATE INDEX "cafe_orders_createdById_createdAt_idx" ON "cafe_orders"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "cafe_orders_status_idx" ON "cafe_orders"("status");

-- CreateIndex
CREATE INDEX "cafe_order_items_orderId_idx" ON "cafe_order_items"("orderId");

-- CreateIndex
CREATE INDEX "cafe_order_items_itemName_idx" ON "cafe_order_items"("itemName");

-- AddForeignKey
ALTER TABLE "cafe_orders" ADD CONSTRAINT "cafe_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cafe_order_items" ADD CONSTRAINT "cafe_order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "cafe_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Check Constraints
ALTER TABLE "cafe_orders"
  ADD CONSTRAINT "cafe_orders_total_aed_check" CHECK ("totalAed" >= 0),
  ADD CONSTRAINT "cafe_orders_order_number_not_blank_check" CHECK (length(btrim("orderNumber")) > 0);

ALTER TABLE "cafe_order_items"
  ADD CONSTRAINT "cafe_order_items_unit_price_aed_check" CHECK ("unitPriceAed" >= 0),
  ADD CONSTRAINT "cafe_order_items_quantity_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "cafe_order_items_item_name_not_blank_check" CHECK (length(btrim("itemName")) > 0);

-- Order line items are historical snapshots: name, price, quantity and parent order never change.
CREATE FUNCTION "cafe_order_items_reject_snapshot_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'cafe_order_items snapshot columns are immutable'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "cafe_order_items_snapshot_immutable"
  BEFORE UPDATE OF "orderId", "itemName", "unitPriceAed", "quantity" ON "cafe_order_items"
  FOR EACH ROW EXECUTE FUNCTION "cafe_order_items_reject_snapshot_update"();
