export const POS_PROVIDERS = Object.freeze({
  SQUARE: "square",
  EPOS_NOW: "epos_now",
  LIGHTSPEED: "lightspeed",
});

export const POS_CONNECTION_STATUSES = Object.freeze({
  CONNECTED: "connected",
  SYNCING: "syncing",
  PROBLEM: "problem",
  DISCONNECTED: "disconnected",
});

export const SQUARE_ENVIRONMENTS = Object.freeze({
  SANDBOX: "sandbox",
  PRODUCTION: "production",
});

export const SQUARE_API_VERSION = "2026-07-15";
export const SQUARE_SCOPES = Object.freeze([
  "MERCHANT_PROFILE_READ",
  "PAYMENTS_READ",
]);

export const DEFAULT_BACKFILL_DAYS = 30;
export const MAX_BACKFILL_DAYS = 90;
export const MAX_BACKFILL_PAGES = 20;

export function normalizeSquareEnvironment(value) {
  return String(value || "").toLowerCase() === SQUARE_ENVIRONMENTS.PRODUCTION
    ? SQUARE_ENVIRONMENTS.PRODUCTION
    : SQUARE_ENVIRONMENTS.SANDBOX;
}

export function getSquareBaseUrl(environment) {
  return normalizeSquareEnvironment(environment) === SQUARE_ENVIRONMENTS.PRODUCTION
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

export function isSquareIntegrationEnabled(env = process.env) {
  return String(env.ENABLE_SQUARE_INTEGRATION || "").toLowerCase() === "true";
}
