import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { createSquareLifecycle } from "./pos/lifecycle.js";
import { getSquareLocalTimestamp } from "./pos/timezone.js";
import { initializeApp } from "firebase-admin/app";
import {
  FieldValue,
  Timestamp,
  getFirestore,
} from "firebase-admin/firestore";
import {
  DEFAULT_BACKFILL_DAYS,
  getSquareBaseUrl,
  isSquareIntegrationEnabled,
  normalizeSquareEnvironment,
  POS_CONNECTION_STATUSES,
  POS_PROVIDERS,
  SQUARE_SCOPES,
} from "./pos/config.js";
import {
  sha256,
} from "./pos/crypto.js";
import {
  canManageLegacyBusinessProfile,
  canManagePosIntegration,
  sanitizeBusinessId,
} from "./pos/authz.js";
import {
  createOAuthStateRecord,
} from "./pos/oauthState.js";
import {
  getSquarePaymentIdFromWebhook,
  verifySquareWebhookSignature,
} from "./pos/webhooks.js";
import {
  buildIngestionDelta,
  createPosDemandModelFromBuckets,
  getDemandBucketKey,
} from "./pos/demandAggregation.js";
import { normalizeSquarePaymentToTransaction } from "./pos/normaliseSquare.js";
import {
  collectSquarePayments,
  createBackfillWindow,
  exchangeSquareAuthorizationCode,
  getSquarePayment,
  listSquareLocations,
  listSquarePayments,
  revokeSquareAccessToken,
  refreshSquareAccessToken,
} from "./pos/squareClient.js";

initializeApp();

const db = getFirestore();
const lifecycle = createSquareLifecycle({ db, stamp: () => FieldValue.serverTimestamp() });
const applicationSecret = defineSecret("SQUARE_APPLICATION_SECRET");
const encryptionKey = defineSecret("SQUARE_TOKEN_ENCRYPTION_KEY");
const webhookSignatureKey = defineSecret("SQUARE_WEBHOOK_SIGNATURE_KEY");
const squareOptions = {
  region: "us-central1", timeoutSeconds: 120, maxInstances: 10,
  secrets: [applicationSecret, encryptionKey],
};
const callableOptions = {
  ...squareOptions,
  cors: process.env.FUNCTIONS_EMULATOR === "true"
    ? ["http://localhost:5173", "http://127.0.0.1:5173"]
    : ["https://app.scheduleloop.co.uk"],
};
const LOCAL_APP_BASE_URL = "http://localhost:5173";
const PRODUCTION_APP_BASE_URL = "https://app.scheduleloop.co.uk";

function getEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

function requireSquareEnabled() {
  if (!isSquareIntegrationEnabled()) {
    throw new HttpsError("failed-precondition", "Square integration is not enabled.");
  }
}

function getAppBaseUrl() {
  return getEnv("FUNCTIONS_EMULATOR") === "true" ? LOCAL_APP_BASE_URL : PRODUCTION_APP_BASE_URL;
}

function getSquareConfig() {
  const environment = normalizeSquareEnvironment(getEnv("SQUARE_ENVIRONMENT"));
  if (!["production", "sandbox"].includes(getEnv("SQUARE_ENVIRONMENT"))) {
    throw new HttpsError("failed-precondition", "Set a valid Square environment.");
  }
  if (getEnv("FUNCTIONS_EMULATOR") !== "true") {
    const base = "https://us-central1-scheduloop-96f9a.cloudfunctions.net";
    if (getEnv("APP_BASE_URL") !== PRODUCTION_APP_BASE_URL ||
        getEnv("SQUARE_REDIRECT_URI") !== base + "/squareOAuthCallback" ||
        getEnv("SQUARE_WEBHOOK_NOTIFICATION_URL") !== base + "/squareWebhook") {
      throw new HttpsError("failed-precondition", "Square production URLs are not configured correctly.");
    }
  }
  return {
    environment,
    applicationId: getEnv("SQUARE_APPLICATION_ID"),
    applicationSecret: getEnv("SQUARE_APPLICATION_SECRET"),
    redirectUri: getEnv("SQUARE_REDIRECT_URI"),
    webhookSignatureKey: getEnv("SQUARE_WEBHOOK_SIGNATURE_KEY"),
    webhookNotificationUrl: getEnv("SQUARE_WEBHOOK_NOTIFICATION_URL"),
    tokenEncryptionKey: getEnv("SQUARE_TOKEN_ENCRYPTION_KEY"),
  };
}

function assertSquareOAuthConfigured(config) {
  const missing = [
    ["SQUARE_APPLICATION_ID", config.applicationId],
    ["SQUARE_APPLICATION_SECRET", config.applicationSecret],
    ["SQUARE_REDIRECT_URI", config.redirectUri],
    ["SQUARE_TOKEN_ENCRYPTION_KEY", config.tokenEncryptionKey],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new HttpsError(
      "failed-precondition",
      `Square is missing server configuration: ${missing.join(", ")}.`
    );
  }
}

async function getMembershipForUser(uid) {
  const snapshot = await db.doc(`memberships/${uid}`).get();
  return snapshot.exists ? snapshot.data() : null;
}

async function requireManageAccess(uid, businessId) {
  const membership = await getMembershipForUser(uid);
  if (canManagePosIntegration(membership, businessId)) return membership;

  if (!membership && uid === businessId) {
    const profileSnap = await db.doc(`businessProfiles/${businessId}`).get();
    if (
      profileSnap.exists &&
      canManageLegacyBusinessProfile({
        uid,
        businessId,
        profile: profileSnap.data(),
      })
    ) {
      return {
        businessId,
        role: "owner",
        status: "legacy",
      };
    }
  }

  throw new HttpsError(
    "permission-denied",
    "This account cannot manage POS integrations for this workspace."
  );
}

function getConnectionRef(businessId, provider = POS_PROVIDERS.SQUARE) {
  return db.doc(`businessProfiles/${businessId}/posConnections/${provider}`);
}

function getMerchantMappingRef(provider, merchantId) {
  return db.doc(`posMerchantMappings/${provider}_${merchantId}`);
}

function getTransactionRef(businessId, transaction) {
  return db.doc(
    `businessProfiles/${businessId}/posTransactions/${transaction.source}_${transaction.externalTransactionId}`
  );
}

function getBucketRef(businessId, source, bucket) {
  return db.doc(
    `businessProfiles/${businessId}/demandBuckets/${source}_${bucket.dateKey}_${bucket.slotLabel}`
  );
}

function getDefaultOpeningHours(profile) {
  return {
    open: profile?.hours?.open || "09:00",
    close: profile?.hours?.close || "17:00",
  };
}

function getDefaultIntervalMinutes(profile) {
  return profile?.operatingRules?.intervalMinutes || 60;
}

async function rebuildPosDemandModel(businessId, lease) {
  const profileSnap = await db.doc(`businessProfiles/${businessId}`).get();
  const profile = profileSnap.data() || {};
  const bucketsSnap = await db
    .collection(`businessProfiles/${businessId}/demandBuckets`)
    .where("source", "==", POS_PROVIDERS.SQUARE)
    .limit(5001)
    .get();
  if (bucketsSnap.size > 5000) throw new Error("Square history exceeds the supported aggregation limit.");
  const buckets = bucketsSnap.docs.map((doc) => doc.data());
  const model = createPosDemandModelFromBuckets({
    buckets,
    openingHours: getDefaultOpeningHours(profile),
    intervalMinutes: getDefaultIntervalMinutes(profile),
  });

  await lifecycle.guarded(lease, (tx) => tx.set(db.doc(`businessProfiles/${businessId}`),
    {
      posDemand: model,
      posDemandUpdatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  ));

  return model;
}

async function ingestNormalisedTransaction({
  transaction,
  syncSource,
  rebuildDemand = true,
  lease,
  timezone,
}) {
  const businessId = transaction.businessId;
  const profileSnap = await db.doc(`businessProfiles/${businessId}`).get();
  const profile = profileSnap.data() || {};
  const bucket = getDemandBucketKey({
    timestamp: getSquareLocalTimestamp(transaction.timestamp, timezone),
    openingHours: getDefaultOpeningHours(profile),
    intervalMinutes: getDefaultIntervalMinutes(profile),
  });

  if (!bucket) {
    return { status: "skipped_out_of_hours" };
  }

  const txRef = getTransactionRef(businessId, transaction);
  const bucketRef = getBucketRef(businessId, transaction.source, bucket);
  let result = { status: "processed" };

  await lifecycle.guarded(lease, async (firestoreTx) => {
    result = { status: "processed" };
    const existingSnap = await firestoreTx.get(txRef);
    const existing = existingSnap.exists ? existingSnap.data() : null;
    if (existing?.providerUpdatedAt && Date.parse(existing.providerUpdatedAt) > Date.parse(transaction.updatedAt)) {
      result = { status: "stale" };
      return;
    }
    const incomingFingerprint = sha256(
      JSON.stringify({
        status: transaction.status,
        revenue: transaction.revenue,
        refundedRevenue: transaction.refundedRevenue,
        transactionCount: transaction.transactionCount,
        itemCount: transaction.itemCount,
        updatedAt: transaction.updatedAt,
      })
    );

    if (existing?.fingerprint === incomingFingerprint) {
      result = { status: "duplicate" };
      return;
    }

    const previousTransaction =
      existing?.bucket?.dateKey === bucket.dateKey &&
      existing?.bucket?.slotLabel === bucket.slotLabel
        ? existing
        : null;
    const delta = buildIngestionDelta(previousTransaction, transaction);

    if (existing && !previousTransaction) {
      const oldBucketRef = getBucketRef(
        businessId,
        existing.source,
        existing.bucket
      );
      const oldDelta = buildIngestionDelta(existing, null);
      firestoreTx.set(
        oldBucketRef,
        {
          businessId,
          source: existing.source,
          dateKey: existing.bucket.dateKey,
          weekday: existing.bucket.weekday,
          slotLabel: existing.bucket.slotLabel,
          intervalMinutes: existing.bucket.intervalMinutes,
          transactionCount: FieldValue.increment(oldDelta.transactionCount),
          revenue: FieldValue.increment(oldDelta.revenue),
          itemCount: FieldValue.increment(oldDelta.itemCount),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    firestoreTx.set(
      bucketRef,
      {
        businessId,
        source: transaction.source,
        dateKey: bucket.dateKey,
        weekday: bucket.weekday,
        slotLabel: bucket.slotLabel,
        intervalMinutes: bucket.intervalMinutes,
        transactionCount: FieldValue.increment(delta.transactionCount),
        revenue: FieldValue.increment(delta.revenue),
        itemCount: FieldValue.increment(delta.itemCount),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    firestoreTx.set(
      txRef,
      {
        ...transaction,
        bucket,
        fingerprint: incomingFingerprint,
        providerUpdatedAt: transaction.updatedAt,
        syncSource,
        createdAt: existing?.createdAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  if (result.status === "processed") {
    await lifecycle.guarded(lease, (tx) => tx.set(getConnectionRef(businessId),
      {
        lastSuccessfulSyncAt: FieldValue.serverTimestamp(),
        mostRecentImportedTransactionAt: transaction.timestamp,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    ));
  }

  // A retry must repair a model write that failed after payment ingestion committed.
  if (rebuildDemand) await rebuildPosDemandModel(businessId, lease);
  return result;
}

export const createSquareOAuthUrl = onCall(callableOptions, async (request) => {
  requireSquareEnabled();
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in before connecting Square.");
  }

  const config = getSquareConfig();
  assertSquareOAuthConfigured(config);

  const businessId = sanitizeBusinessId(request.data?.businessId);
  await requireManageAccess(request.auth.uid, businessId);

  const { state, stateHash, record } = createOAuthStateRecord({
    uid: request.auth.uid,
    businessId,
  });
  await db.doc(`squareOAuthStates/${stateHash}`).set({
    ...record,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromDate(new Date(record.expiresAt)),
  });

  const params = new URLSearchParams({
    client_id: config.applicationId,
    scope: SQUARE_SCOPES.join(" "),
    state,
    response_type: "code",
    redirect_uri: config.redirectUri,
  });

  return {
    url: `${getSquareBaseUrl(config.environment)}/oauth2/authorize?${params.toString()}`,
  };
});

export const squareOAuthCallback = onRequest(squareOptions, async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.set("Referrer-Policy", "no-referrer");
  if (req.method !== "GET") { res.status(405).end(); return; }
  let phase = "configuration";
  try {
    requireSquareEnabled();
    const config = getSquareConfig();
    assertSquareOAuthConfigured(config);
    const state = req.query.state;
    const code = req.query.code;
    if (typeof state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(state) ||
        (!req.query.error && (typeof code !== "string" || !code || code.length > 4096))) {
      res.redirect(getAppBaseUrl() + "/data-sources?square=invalid"); return;
    }
    phase = "state-validation";
    const record = await lifecycle.consumeState(db.doc("squareOAuthStates/" + sha256(state)));
    if (req.query.error) { res.redirect(getAppBaseUrl() + "/data-sources?square=denied"); return; }
    phase = "connection-lock";
    await lifecycle.withLease(record.businessId, async (lease) => {
      phase = "token-exchange";
      const token = await exchangeSquareAuthorizationCode({ code, clientId: config.applicationId,
        clientSecret: config.applicationSecret, redirectUri: config.redirectUri, environment: config.environment });
      try {
        phase = "locations";
        const locations = await listSquareLocations({ accessToken: token.access_token, environment: config.environment });
        const connectedLocations = locations.map((location) => ({
          squareLocationId: sanitizeBusinessId(location.id), scheduleLoopLocationId: "default",
          name: location.name || "Square location", timezone: location.timezone || "Europe/London", status: location.status || "",
        }));
        phase = "connection-save";
        await lifecycle.saveConnection(lease, { uid: record.uid, token, locations: connectedLocations, config });
      } catch (error) {
        // Never revoke another active connection's entire merchant authorization.
        await revokeSquareAccessToken({ accessToken: token.access_token, clientId: config.applicationId,
          clientSecret: config.applicationSecret, environment: config.environment, onlyAccessToken: true }).catch(() => {});
        throw error;
      }
    });
    res.redirect(getAppBaseUrl() + "/data-sources?square=connected");
  } catch (error) {
    console.error("Square OAuth callback failed", {
      provider: POS_PROVIDERS.SQUARE, phase,
      providerStatus: Number.isInteger(error?.status) ? error.status : null,
    });
    res.redirect(getAppBaseUrl() + "/data-sources?square=error");
  }
});

export const disconnectSquare = onCall(callableOptions, async (request) => {
  requireSquareEnabled();
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in before disconnecting Square.");
  const businessId = sanitizeBusinessId(request.data?.businessId);
  await requireManageAccess(request.auth.uid, businessId);
  try {
    return await lifecycle.withLease(businessId, (lease) => lifecycle.disconnect(lease, {
      uid: request.auth.uid, config: getSquareConfig(), revoke: revokeSquareAccessToken,
    }));
  } catch {
    throw new HttpsError("unavailable", "Square disconnect could not finish. Retry to complete token revocation.");
  }
});

export const syncSquareHistory = onCall({ ...callableOptions, timeoutSeconds: 540, memory: "512MiB" }, async (request) => {
  requireSquareEnabled();
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in before syncing Square.");
  }

  const businessId = sanitizeBusinessId(request.data?.businessId);
  await requireManageAccess(request.auth.uid, businessId);

  return lifecycle.withLease(businessId, async (lease) => {
  const config = getSquareConfig();
  const connectionSnap = await getConnectionRef(businessId).get();
  const connection = connectionSnap.data() || {};
  const secret = await lifecycle.getSecret(lease, config, refreshSquareAccessToken);
  const window = createBackfillWindow({
    days: request.data?.days || DEFAULT_BACKFILL_DAYS,
  });
  const locations = connection.connectedLocations?.length
    ? connection.connectedLocations
    : [{ squareLocationId: "" }];

  await lifecycle.guarded(lease, (tx) => tx.set(getConnectionRef(businessId),
    {
      connectionStatus: POS_CONNECTION_STATUSES.SYNCING,
      lastSyncStartedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  ));

  let processed = 0;
  try {
    for (const location of locations) {
      const result = await collectSquarePayments({
        beginTime: window.beginTime,
        endTime: window.endTime,
        locationId: location.squareLocationId,
        fetchPage: (params) =>
          listSquarePayments({
            accessToken: secret.accessToken,
            environment: secret.environment,
            ...params,
          }),
      });

      if (result.truncated) throw new Error("Square history needs a smaller date range.");
      for (const payment of result.payments) {
        const transaction = normalizeSquarePaymentToTransaction({
          payment,
          businessId,
          scheduleLoopLocationId: location.scheduleLoopLocationId,
          squareMerchantId: secret.externalMerchantId,
        });
        const ingestResult = await ingestNormalisedTransaction({
          transaction,
          syncSource: "historical_backfill",
          rebuildDemand: false,
          lease,
          timezone: location.timezone || "Europe/London",
        });
        if (ingestResult.status === "processed") processed += 1;
      }
    }

    await rebuildPosDemandModel(businessId, lease);
    await lifecycle.guarded(lease, (tx) => tx.set(getConnectionRef(businessId),
        {
          connectionStatus: POS_CONNECTION_STATUSES.CONNECTED,
          lastSuccessfulSyncAt: FieldValue.serverTimestamp(),
          lastBackfillWindowDays: window.days,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      ));
  } catch {
    console.warn("Square historical sync failed", {
      businessId,
      provider: POS_PROVIDERS.SQUARE,
    });
    await lifecycle.guarded(lease, (tx) => tx.set(getConnectionRef(businessId),
      {
        connectionStatus: POS_CONNECTION_STATUSES.PROBLEM,
        lastSyncError: "Square sync could not finish.",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    ));
    throw new HttpsError("unavailable", "Square sync could not finish.");
  }

  return { processed, days: window.days };
  });
});

export const squareWebhook = onRequest({ ...squareOptions,
  secrets: [...squareOptions.secrets, webhookSignatureKey],
}, async (req, res) => {
  if (req.method !== "POST") { res.status(405).end(); return; }
  try {
    requireSquareEnabled();
    const config = getSquareConfig();
    if (!config.webhookSignatureKey || !config.webhookNotificationUrl) { res.status(503).json({ ok: false }); return; }
    const rawBody = req.rawBody;
    if (!Buffer.isBuffer(rawBody) || !verifySquareWebhookSignature({
      notificationUrl: config.webhookNotificationUrl, rawBody, signatureKey: config.webhookSignatureKey,
      signatureHeader: req.get("x-square-hmacsha256-signature"),
    })) { res.status(403).json({ ok: false }); return; }
    const event = JSON.parse(rawBody.toString("utf8"));
    const paymentId = getSquarePaymentIdFromWebhook(event);
    if (!event.merchant_id || !event.event_id || !paymentId) { res.status(202).json({ ok: true, ignored: true }); return; }
    const merchantId = sanitizeBusinessId(event.merchant_id);
    const mapping = (await getMerchantMappingRef(POS_PROVIDERS.SQUARE, merchantId).get()).data();
    if (!mapping || mapping.connectionStatus !== "connected") { res.status(202).json({ ok: true, ignored: true }); return; }
    const result = await lifecycle.withLease(mapping.businessId, (lease) => lifecycle.processEvent(lease, {
      merchantId, eventId: event.event_id, eventType: event.type,
      process: async () => {
        const secret = await lifecycle.getSecret(lease, config, refreshSquareAccessToken);
        if (secret.externalMerchantId !== merchantId) throw new Error("Square merchant mismatch.");
        const payment = await getSquarePayment({ accessToken: secret.accessToken, environment: secret.environment, paymentId });
        const location = (mapping.connectedLocations || []).find(item => item.squareLocationId === payment.location_id);
        if (!location) throw new Error("Square location is not connected.");
        const transaction = normalizeSquarePaymentToTransaction({ payment, businessId: mapping.businessId,
          scheduleLoopLocationId: location.scheduleLoopLocationId, squareMerchantId: merchantId });
        await ingestNormalisedTransaction({ transaction, syncSource: "square_webhook", lease, timezone: location.timezone || "Europe/London" });
      },
    }));
    res.status(200).json({ ok: true, ...result });
  } catch {
    // Do not include provider response bodies, request URLs, codes or tokens.
    console.error("Square webhook processing failed", { provider: POS_PROVIDERS.SQUARE });
    res.status(503).json({ ok: false });
  }
});
