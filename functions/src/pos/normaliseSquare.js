import { POS_PROVIDERS } from "./config.js";

const COUNTED_PAYMENT_STATUSES = new Set(["APPROVED", "COMPLETED"]);

function centsToMajorUnits(money) {
  const amount = Number(money?.amount);
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount / 100) * 100) / 100;
}

function getPaymentTimestamp(payment) {
  return (
    payment?.created_at ||
    payment?.updated_at ||
    payment?.card_details?.card_payment_timeline?.captured_at ||
    ""
  );
}

export function normalizeSquarePaymentToTransaction({
  payment,
  businessId,
  scheduleLoopLocationId = "default",
  squareMerchantId,
} = {}) {
  if (!payment?.id) {
    throw new Error("Square payment is missing an id.");
  }

  const timestamp = getPaymentTimestamp(payment);
  const parsedTimestamp = new Date(timestamp);
  if (!timestamp || Number.isNaN(parsedTimestamp.getTime())) {
    throw new Error("Square payment is missing a valid timestamp.");
  }

  const status = String(payment.status || "").toUpperCase();
  const grossRevenue = centsToMajorUnits(
    payment.total_money || payment.amount_money
  );
  const refundedRevenue = centsToMajorUnits(payment.refunded_money);
  const isCounted = COUNTED_PAYMENT_STATUSES.has(status);
  const revenue = isCounted ? Math.max(0, grossRevenue - refundedRevenue) : 0;
  const transactionCount = isCounted && revenue > 0 ? 1 : 0;

  return {
    businessId,
    locationId: scheduleLoopLocationId || "default",
    source: POS_PROVIDERS.SQUARE,
    externalMerchantId: squareMerchantId || payment.merchant_id || "",
    externalLocationId: payment.location_id || "",
    externalTransactionId: payment.id,
    externalOrderId: payment.order_id || "",
    timestamp: parsedTimestamp.toISOString(),
    status,
    transactionCount,
    revenue,
    refundedRevenue,
    itemCount: 0,
    currency: payment.total_money?.currency || payment.amount_money?.currency || "",
    updatedAt: payment.updated_at || parsedTimestamp.toISOString(),
  };
}
