import crypto from "node:crypto";

export function createSquareWebhookSignature({
  notificationUrl,
  rawBody,
  signatureKey,
}) {
  return crypto
    .createHmac("sha256", String(signatureKey || ""))
    .update(String(notificationUrl || ""))
    .update(Buffer.isBuffer(rawBody) ? rawBody : String(rawBody || ""))
    .digest("base64");
}

export function verifySquareWebhookSignature({
  notificationUrl,
  rawBody,
  signatureKey,
  signatureHeader,
}) {
  if (!notificationUrl || !rawBody || !signatureKey || !signatureHeader) {
    return false;
  }

  const expected = Buffer.from(
    createSquareWebhookSignature({ notificationUrl, rawBody, signatureKey })
  );
  const received = Buffer.from(String(signatureHeader));

  return (
    expected.length === received.length &&
    crypto.timingSafeEqual(expected, received)
  );
}

export function getSquarePaymentIdFromWebhook(event) {
  return (
    event?.data?.object?.payment?.id ||
    event?.data?.object?.payment_id ||
    event?.data?.id ||
    ""
  );
}
