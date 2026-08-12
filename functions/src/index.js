import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
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
  decryptSecret,
  encryptSecret,
  sha256,
} from "./pos/crypto.js";
import {
  canManageLegacyBusinessProfile,
  canManagePosIntegration,
  sanitizeBusinessId,
} from "./pos/authz.js";
import {
  createOAuthStateRecord,
  isOAuthStateRecordValid,
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
} from "./pos/squareClient.js";

initializeApp();

const db = getFirestore();

function getEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

function requireSquareEnabled() {
  if (!isSquareIntegrationEnabled()) {
    throw new HttpsError("failed-precondition", "Square integration is not enabled.");
  }
}

function getAppBaseUrl() {
  return getEnv("APP_BASE_URL", "http://localhost:5173").replace(/\/$/, "");
}

function getSquareConfig() {
  const environment = normalizeSquareEnvironment(getEnv("SQUARE_ENVIRONMENT"));
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

function getSecretRef(businessId, provider = POS_PROVIDERS.SQUARE) {
  return db.doc(`posSecrets/${businessId}_${provider}`);
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

async function rebuildPosDemandModel(businessId) {
  const profileSnap = await db.doc(`businessProfiles/${businessId}`).get();
  const profile = profileSnap.data() || {};
  const bucketsSnap = await db
    .collection(`businessProfiles/${businessId}/demandBuckets`)
    .where("source", "==", POS_PROVIDERS.SQUARE)
    .limit(5000)
    .get();
  const buckets = bucketsSnap.docs.map((doc) => doc.data());
  const model = createPosDemandModelFromBuckets({
    buckets,
    openingHours: getDefaultOpeningHours(profile),
    intervalMinutes: getDefaultIntervalMinutes(profile),
  });

  await db.doc(`businessProfiles/${businessId}`).set(
    {
      posDemand: model,
      posDemandUpdatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return model;
}

async function ingestNormalisedTransaction({
  transaction,
  syncSource,
  rebuildDemand = true,
}) {
  const businessId = transaction.businessId;
  const profileSnap = await db.doc(`businessProfiles/${businessId}`).get();
  const profile = profileSnap.data() || {};
  const bucket = getDemandBucketKey({
    timestamp: transaction.timestamp,
    openingHours: getDefaultOpeningHours(profile),
    intervalMinutes: getDefaultIntervalMinutes(profile),
  });

  if (!bucket) {
    return { status: "skipped_out_of_hours" };
  }

  const txRef = getTransactionRef(businessId, transaction);
  const bucketRef = getBucketRef(businessId, transaction.source, bucket);
  let result = { status: "processed" };

  await db.runTransaction(async (firestoreTx) => {
    const existingSnap = await firestoreTx.get(txRef);
    const existing = existingSnap.exists ? existingSnap.data() : null;
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
        syncSource,
        createdAt: existing?.createdAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  if (result.status === "processed") {
    await getConnectionRef(businessId).set(
      {
        lastSuccessfulSyncAt: FieldValue.serverTimestamp(),
        mostRecentImportedTransactionAt: transaction.timestamp,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (rebuildDemand) {
      await rebuildPosDemandModel(businessId);
    }
  }

  return result;
}

async function getSquareSecret(businessId) {
  const config = getSquareConfig();
  const secretSnap = await getSecretRef(businessId).get();
  if (!secretSnap.exists) {
    throw new Error("Square connection credentials are unavailable.");
  }

  const data = secretSnap.data();
  return {
    ...data,
    accessToken: decryptSecret(data.encryptedAccessToken, config.tokenEncryptionKey),
    refreshToken: decryptSecret(data.encryptedRefreshToken, config.tokenEncryptionKey),
  };
}

export const createSquareOAuthUrl = onCall(async (request) => {
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

export const squareOAuthCallback = onRequest(async (req, res) => {
  try {
    requireSquareEnabled();
    const config = getSquareConfig();
    assertSquareOAuthConfigured(config);

    const state = String(req.query.state || "");
    const code = String(req.query.code || "");
    const error = String(req.query.error || "");
    const stateRef = db.doc(`squareOAuthStates/${sha256(state)}`);
    const stateSnap = await stateRef.get();
    const stateRecord = stateSnap.exists ? stateSnap.data() : null;

    if (error) {
      res.redirect(`${getAppBaseUrl()}/data-sources?square=denied`);
      return;
    }

    if (!code || !isOAuthStateRecordValid(stateRecord)) {
      res.redirect(`${getAppBaseUrl()}/data-sources?square=invalid`);
      return;
    }

    const token = await exchangeSquareAuthorizationCode({
      code,
      clientId: config.applicationId,
      clientSecret: config.applicationSecret,
      redirectUri: config.redirectUri,
      environment: config.environment,
    });
    const merchantId = token.merchant_id;
    const locations = await listSquareLocations({
      accessToken: token.access_token,
      environment: config.environment,
    });
    const connectedLocations = locations.map((location) => ({
      squareLocationId: location.id,
      scheduleLoopLocationId: "default",
      name: location.name || "Square location",
      timezone: location.timezone || "",
      status: location.status || "",
    }));

    await Promise.all([
      stateRef.set({ consumedAt: FieldValue.serverTimestamp() }, { merge: true }),
      getSecretRef(stateRecord.businessId).set({
        businessId: stateRecord.businessId,
        provider: POS_PROVIDERS.SQUARE,
        externalMerchantId: merchantId,
        encryptedAccessToken: encryptSecret(
          token.access_token,
          config.tokenEncryptionKey
        ),
        encryptedRefreshToken: encryptSecret(
          token.refresh_token,
          config.tokenEncryptionKey
        ),
        accessTokenExpiresAt: token.expires_at || "",
        environment: config.environment,
        updatedAt: FieldValue.serverTimestamp(),
      }),
      getConnectionRef(stateRecord.businessId).set(
        {
          businessId: stateRecord.businessId,
          provider: POS_PROVIDERS.SQUARE,
          externalMerchantId: merchantId,
          connectedLocations,
          connectionStatus: POS_CONNECTION_STATUSES.CONNECTED,
          environment: config.environment,
          connectedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      ),
      getMerchantMappingRef(POS_PROVIDERS.SQUARE, merchantId).set({
        businessId: stateRecord.businessId,
        provider: POS_PROVIDERS.SQUARE,
        externalMerchantId: merchantId,
        connectedLocations,
        connectionStatus: POS_CONNECTION_STATUSES.CONNECTED,
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    res.redirect(`${getAppBaseUrl()}/data-sources?square=connected`);
  } catch (error) {
    console.error("Square OAuth callback failed", {
      message: error.message,
      provider: POS_PROVIDERS.SQUARE,
    });
    res.redirect(`${getAppBaseUrl()}/data-sources?square=error`);
  }
});

export const disconnectSquare = onCall(async (request) => {
  requireSquareEnabled();
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in before disconnecting Square.");
  }

  const businessId = sanitizeBusinessId(request.data?.businessId);
  await requireManageAccess(request.auth.uid, businessId);
  const config = getSquareConfig();
  const secret = await getSquareSecret(businessId).catch(() => null);

  if (secret?.accessToken) {
    await revokeSquareAccessToken({
      accessToken: secret.accessToken,
      clientId: config.applicationId,
      clientSecret: config.applicationSecret,
      environment: secret.environment || config.environment,
    }).catch((error) => {
      console.warn("Square token revoke failed", {
        businessId,
        provider: POS_PROVIDERS.SQUARE,
        message: error.message,
      });
    });
  }

  await Promise.all([
    getSecretRef(businessId).delete(),
    getConnectionRef(businessId).set(
      {
        connectionStatus: POS_CONNECTION_STATUSES.DISCONNECTED,
        disconnectedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    ),
  ]);

  return { status: POS_CONNECTION_STATUSES.DISCONNECTED };
});

export const syncSquareHistory = onCall(async (request) => {
  requireSquareEnabled();
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in before syncing Square.");
  }

  const businessId = sanitizeBusinessId(request.data?.businessId);
  await requireManageAccess(request.auth.uid, businessId);

  const connectionSnap = await getConnectionRef(businessId).get();
  const connection = connectionSnap.data() || {};
  const secret = await getSquareSecret(businessId);
  const window = createBackfillWindow({
    days: request.data?.days || DEFAULT_BACKFILL_DAYS,
  });
  const locations = connection.connectedLocations?.length
    ? connection.connectedLocations
    : [{ squareLocationId: "" }];

  await getConnectionRef(businessId).set(
    {
      connectionStatus: POS_CONNECTION_STATUSES.SYNCING,
      lastSyncStartedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

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
        });
        if (ingestResult.status === "processed") processed += 1;
      }
    }

    await Promise.all([
      rebuildPosDemandModel(businessId),
      getConnectionRef(businessId).set(
        {
          connectionStatus: POS_CONNECTION_STATUSES.CONNECTED,
          lastSuccessfulSyncAt: FieldValue.serverTimestamp(),
          lastBackfillWindowDays: window.days,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      ),
    ]);
  } catch (error) {
    console.warn("Square historical sync failed", {
      businessId,
      provider: POS_PROVIDERS.SQUARE,
      message: error.message,
    });
    await getConnectionRef(businessId).set(
      {
        connectionStatus: POS_CONNECTION_STATUSES.PROBLEM,
        lastSyncError: "Square sync could not finish.",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    throw new HttpsError("unavailable", "Square sync could not finish.");
  }

  return { processed, days: window.days };
});

export const squareWebhook = onRequest(async (req, res) => {
  const startedAt = Date.now();

  try {
    requireSquareEnabled();
    const config = getSquareConfig();

    if (!config.webhookSignatureKey || !config.webhookNotificationUrl) {
      res.status(503).json({ ok: false });
      return;
    }

    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const signature = req.get("x-square-hmacsha256-signature");
    const validSignature = verifySquareWebhookSignature({
      notificationUrl: config.webhookNotificationUrl,
      rawBody,
      signatureKey: config.webhookSignatureKey,
      signatureHeader: signature,
    });

    if (!validSignature) {
      res.status(403).json({ ok: false });
      return;
    }

    const event =
      typeof req.body === "object" && req.body
        ? req.body
        : JSON.parse(rawBody.toString("utf8"));
    const merchantId = event.merchant_id || event.merchantId || "";
    const eventId = event.event_id || event.id || "";
    const paymentId = getSquarePaymentIdFromWebhook(event);

    if (!merchantId || !paymentId || !eventId) {
      res.status(202).json({ ok: true, ignored: true });
      return;
    }

    const mappingSnap = await getMerchantMappingRef(
      POS_PROVIDERS.SQUARE,
      merchantId
    ).get();
    const mapping = mappingSnap.data();
    if (
      !mapping ||
      mapping.connectionStatus === POS_CONNECTION_STATUSES.DISCONNECTED
    ) {
      res.status(202).json({ ok: true, ignored: true });
      return;
    }

    const eventRef = db.doc(`posWebhookEvents/${POS_PROVIDERS.SQUARE}_${eventId}`);
    const created = await db.runTransaction(async (firestoreTx) => {
      const existing = await firestoreTx.get(eventRef);
      if (existing.exists) return false;
      firestoreTx.create(eventRef, {
        provider: POS_PROVIDERS.SQUARE,
        eventId,
        merchantId,
        businessId: mapping.businessId,
        eventType: event.type || "",
        createdAt: FieldValue.serverTimestamp(),
      });
      return true;
    });

    if (!created) {
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }

    const secret = await getSquareSecret(mapping.businessId);
    const payment = await getSquarePayment({
      accessToken: secret.accessToken,
      environment: secret.environment,
      paymentId,
    });
    const locationMapping = (mapping.connectedLocations || []).find(
      (location) => location.squareLocationId === payment.location_id
    );
    const transaction = normalizeSquarePaymentToTransaction({
      payment,
      businessId: mapping.businessId,
      scheduleLoopLocationId: locationMapping?.scheduleLoopLocationId || "default",
      squareMerchantId: merchantId,
    });

    await ingestNormalisedTransaction({
      transaction,
      syncSource: "square_webhook",
    });
    await getConnectionRef(mapping.businessId).set(
      {
        lastWebhookAt: FieldValue.serverTimestamp(),
        lastWebhookEventType: event.type || "",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    console.info("Square webhook processed", {
      provider: POS_PROVIDERS.SQUARE,
      businessId: mapping.businessId,
      eventType: event.type || "",
      eventId,
      durationMs: Date.now() - startedAt,
    });

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Square webhook processing failed", {
      provider: POS_PROVIDERS.SQUARE,
      message: error.message,
      durationMs: Date.now() - startedAt,
    });
    res.status(500).json({ ok: false });
  }
});
