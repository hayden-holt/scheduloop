import {
  DEFAULT_BACKFILL_DAYS,
  getSquareBaseUrl,
  MAX_BACKFILL_DAYS,
  MAX_BACKFILL_PAGES,
  SQUARE_API_VERSION,
} from "./config.js";

function clampBackfillDays(days) {
  const parsed = Number(days);
  if (!Number.isFinite(parsed)) return DEFAULT_BACKFILL_DAYS;
  return Math.min(Math.max(Math.round(parsed), 1), MAX_BACKFILL_DAYS);
}

function createSquareHeaders(accessToken) {
  const headers = {
    "Content-Type": "application/json",
    "Square-Version": SQUARE_API_VERSION,
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return headers;
}

async function parseSquareResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("Square API request failed.");
    error.status = response.status;
    error.squareErrors = body.errors || [];
    throw error;
  }
  return body;
}

export async function squareApiFetch({
  path,
  accessToken,
  environment,
  method = "GET",
  body,
  clientAuthorization,
}) {
  const response = await fetch(`${getSquareBaseUrl(environment)}${path}`, {
    method,
    headers: { ...createSquareHeaders(accessToken), ...(clientAuthorization ? { Authorization: `Client ${clientAuthorization}` } : {}) },
    signal: AbortSignal.timeout(20_000),
    body: body ? JSON.stringify(body) : undefined,
  });

  return parseSquareResponse(response);
}

export async function exchangeSquareAuthorizationCode({
  code,
  clientId,
  clientSecret,
  redirectUri,
  environment,
}) {
  return squareApiFetch({
    path: "/oauth2/token",
    environment,
    method: "POST",
    body: {
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    },
  });
}

export async function refreshSquareAccessToken({
  refreshToken,
  clientId,
  clientSecret,
  environment,
}) {
  return squareApiFetch({
    path: "/oauth2/token",
    environment,
    method: "POST",
    body: {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    },
  });
}

export async function revokeSquareAccessToken({ accessToken, clientId, clientSecret, environment, onlyAccessToken = false }) {
  const result = await squareApiFetch({ path: "/oauth2/revoke", environment, method: "POST",
    clientAuthorization: clientSecret,
    body: { client_id: clientId, access_token: accessToken, revoke_only_access_token: onlyAccessToken },
  });
  if (result.success !== true) throw new Error("Square token revocation was not confirmed.");
  return result;
}

export async function listSquareLocations({ accessToken, environment }) {
  const body = await squareApiFetch({
    path: "/v2/locations",
    accessToken,
    environment,
  });

  return body.locations || [];
}

export async function getSquarePayment({ accessToken, environment, paymentId }) {
  const body = await squareApiFetch({
    path: `/v2/payments/${encodeURIComponent(paymentId)}`,
    accessToken,
    environment,
  });

  return body.payment;
}

export async function collectSquarePayments({
  fetchPage,
  beginTime,
  endTime,
  locationId,
  maxPages = MAX_BACKFILL_PAGES,
}) {
  const payments = [];
  let cursor = "";

  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage({
      beginTime,
      endTime,
      locationId,
      cursor,
      limit: 100,
    });

    payments.push(...(result.payments || []));
    cursor = result.cursor || "";
    if (!cursor) break;
  }

  return {
    payments,
    nextCursor: cursor,
    truncated: Boolean(cursor),
  };
}

export async function listSquarePayments({
  accessToken,
  environment,
  beginTime,
  endTime,
  locationId,
  cursor,
  limit = 100,
}) {
  const params = new URLSearchParams({
    begin_time: beginTime,
    end_time: endTime,
    sort_order: "ASC",
    limit: String(Math.min(Number(limit) || 100, 100)),
  });

  if (locationId) params.set("location_id", locationId);
  if (cursor) params.set("cursor", cursor);

  return squareApiFetch({
    path: `/v2/payments?${params.toString()}`,
    accessToken,
    environment,
  });
}

export function createBackfillWindow({ days, now = new Date() } = {}) {
  const safeDays = clampBackfillDays(days);
  const end = new Date(now);
  const begin = new Date(end.getTime() - safeDays * 24 * 60 * 60 * 1000);

  return {
    days: safeDays,
    beginTime: begin.toISOString(),
    endTime: end.toISOString(),
  };
}
