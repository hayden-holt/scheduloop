import { randomUUID } from "node:crypto";
import { canManagePosIntegration, canManageLegacyBusinessProfile, sanitizeBusinessId } from "./authz.js";
import { isOAuthStateRecordValid } from "./oauthState.js";
import { encryptSecret, decryptSecret } from "./crypto.js";

// Only Square lifecycle metadata is added to the existing POS documents.
// All external calls happen outside Firestore transactions; lease checks fence
// late writes from a timed-out worker after another operation has taken over.
export function createSquareLifecycle({ db, stamp, now = Date.now }) {
  const connectionRef = (id) => db.doc(`businessProfiles/${sanitizeBusinessId(id)}/posConnections/square`);
  const secretRef = (id) => db.doc(`posSecrets/${sanitizeBusinessId(id)}_square`);
  const mappingRef = (id) => db.doc(`posMerchantMappings/square_${sanitizeBusinessId(id)}`);
  const fail = (code) => { const error = new Error("Square operation could not complete."); error.code = code; throw error; };

  async function assertManage(tx, uid, businessId) {
    sanitizeBusinessId(uid);
    sanitizeBusinessId(businessId);
    const membership = (await tx.get(db.doc(`memberships/${uid}`))).data();
    const profile = (await tx.get(db.doc(`businessProfiles/${businessId}`))).data();
    if (!profile && !membership) fail("permission-denied");
    if (canManagePosIntegration(membership, businessId)) return;
    if (!membership && canManageLegacyBusinessProfile({ uid, businessId, profile })) return;
    fail("permission-denied");
  }

  async function consumeState(ref) {
    return db.runTransaction(async (tx) => {
      const record = (await tx.get(ref)).data();
      if (!isOAuthStateRecordValid(record, { now: new Date(now()) })) fail("invalid-state");
      await assertManage(tx, record.uid, record.businessId);
      tx.set(ref, { consumedAt: stamp() }, { merge: true });
      return record;
    });
  }

  async function withLease(businessId, fn) {
    const ref = connectionRef(businessId);
    const id = randomUUID();
    await db.runTransaction(async (tx) => {
      const data = (await tx.get(ref)).data() || {};
      if (data.operationLease?.until > now()) fail("aborted");
      tx.set(ref, { operationLease: { id, until: now() + 600_000 } }, { merge: true });
    });
    const lease = { businessId, id, ref };
    try { return await fn(lease); }
    finally {
      await db.runTransaction(async (tx) => {
        const data = (await tx.get(ref)).data();
        if (data?.operationLease?.id === id) tx.set(ref, { operationLease: null }, { merge: true });
      });
    }
  }

  async function guarded(lease, fn) {
    return db.runTransaction(async (tx) => {
      const connection = (await tx.get(lease.ref)).data();
      if (connection?.operationLease?.id !== lease.id || connection.operationLease.until <= now()) fail("aborted");
      return fn(tx, connection);
    });
  }

  async function saveConnection(lease, { uid, token, locations, config }) {
    if (!token?.access_token || !token.refresh_token || !token.merchant_id ||
        !Number.isFinite(Date.parse(token.expires_at)) || Date.parse(token.expires_at) <= now()) fail("invalid-token");
    const merchantId = sanitizeBusinessId(token.merchant_id);
    const credentials = {
      businessId: lease.businessId, provider: "square", externalMerchantId: merchantId,
      encryptedAccessToken: encryptSecret(token.access_token, config.tokenEncryptionKey),
      encryptedRefreshToken: encryptSecret(token.refresh_token, config.tokenEncryptionKey),
      accessTokenExpiresAt: token.expires_at, environment: config.environment, updatedAt: stamp(),
    };
    await guarded(lease, async (tx, connection) => {
      // Membership can change while the seller is on Square or during exchange.
      await assertManage(tx, uid, lease.businessId);
      const mapping = (await tx.get(mappingRef(merchantId))).data();
      const previousSecret = (await tx.get(secretRef(lease.businessId))).data();
      const oldMerchant = connection.externalMerchantId;
      const oldMapping = oldMerchant && oldMerchant !== merchantId
        ? (await tx.get(mappingRef(oldMerchant))).data() : null;
      // Retain ownership even after disconnect: transferring a seller between
      // businesses needs an explicit migration, never an OAuth side effect.
      if (mapping && mapping.businessId !== lease.businessId) fail("merchant-in-use");
      if (previousSecret?.revocationPending) fail("revocation-pending");
      if (previousSecret && oldMerchant !== merchantId) fail("disconnect-required");
      if (oldMapping?.businessId === lease.businessId) {
        tx.set(mappingRef(oldMerchant), { connectionStatus: "disconnected", updatedAt: stamp() }, { merge: true });
      }
      tx.set(secretRef(lease.businessId), credentials);
      const metadata = {
        businessId: lease.businessId, provider: "square", externalMerchantId: merchantId,
        connectedLocations: locations, connectionStatus: "connected", environment: config.environment,
        updatedAt: stamp(),
      };
      tx.set(lease.ref, { ...metadata, connectedAt: stamp(), lastSyncError: null }, { merge: true });
      tx.set(mappingRef(merchantId), metadata);
    });
  }

  async function getSecret(lease, config, refresh) {
    const data = await guarded(lease, async (tx, connection) => {
      const secret = (await tx.get(secretRef(lease.businessId))).data();
      if (!secret || secret.revocationPending || secret.businessId !== lease.businessId ||
          secret.provider !== "square" || secret.environment !== config.environment ||
          secret.externalMerchantId !== connection.externalMerchantId ||
          !["connected", "syncing", "problem"].includes(connection.connectionStatus)) fail("failed-precondition");
      const mapping = (await tx.get(mappingRef(secret.externalMerchantId))).data();
      if (mapping?.businessId !== lease.businessId || mapping.connectionStatus !== "connected") fail("permission-denied");
      return secret;
    });
    const accessToken = decryptSecret(data.encryptedAccessToken, config.tokenEncryptionKey);
    const refreshToken = decryptSecret(data.encryptedRefreshToken, config.tokenEncryptionKey);
    // Renew on use after roughly a week of a normal 30-day token lifetime.
    if (Date.parse(data.accessTokenExpiresAt) > now() + 23 * 86400_000) return { ...data, accessToken };
    try {
      const token = await refresh({ refreshToken, clientId: config.applicationId,
        clientSecret: config.applicationSecret, environment: config.environment });
      if (!token?.access_token || !token.refresh_token ||
          (token.merchant_id && token.merchant_id !== data.externalMerchantId) ||
          !Number.isFinite(Date.parse(token.expires_at)) || Date.parse(token.expires_at) <= now()) fail("invalid-token");
      const updated = {
        encryptedAccessToken: encryptSecret(token.access_token, config.tokenEncryptionKey),
        encryptedRefreshToken: encryptSecret(token.refresh_token, config.tokenEncryptionKey),
        accessTokenExpiresAt: token.expires_at, updatedAt: stamp(),
      };
      await guarded(lease, (tx) => tx.set(secretRef(lease.businessId), updated, { merge: true }));
      return { ...data, ...updated, accessToken: token.access_token };
    } catch {
      await guarded(lease, (tx) => tx.set(lease.ref, {
        connectionStatus: "problem", lastSyncError: "Square credentials could not be renewed. Retry or reconnect Square.",
        updatedAt: stamp(),
      }, { merge: true }));
      fail("unavailable");
    }
  }

  async function disconnect(lease, { uid, config, revoke }) {
    const secret = await guarded(lease, async (tx, connection) => {
      await assertManage(tx, uid, lease.businessId);
      const data = (await tx.get(secretRef(lease.businessId))).data();
      if (data && (data.businessId !== lease.businessId || data.environment !== config.environment ||
          data.externalMerchantId !== connection.externalMerchantId)) fail("permission-denied");
      const merchantId = data?.externalMerchantId || connection.externalMerchantId;
      const mapping = merchantId ? (await tx.get(mappingRef(merchantId))).data() : null;
      if (mapping?.businessId === lease.businessId) tx.set(mappingRef(merchantId), {
        connectionStatus: "disconnected", updatedAt: stamp(),
      }, { merge: true });
      tx.set(lease.ref, { connectionStatus: "disconnected", disconnectedAt: stamp(), updatedAt: stamp() }, { merge: true });
      if (data) tx.set(secretRef(lease.businessId), { revocationPending: true }, { merge: true });
      return data;
    });
    if (secret) {
      // Retain encrypted credentials only if remote revocation fails so a retry
      // can finish; disconnected routing already prevents further ingestion.
      try {
        await revoke({ accessToken: decryptSecret(secret.encryptedAccessToken, config.tokenEncryptionKey),
          clientId: config.applicationId, clientSecret: config.applicationSecret, environment: secret.environment });
      } catch { fail("unavailable"); }
      await guarded(lease, (tx) => tx.delete(secretRef(lease.businessId)));
    }
    return { status: "disconnected" };
  }

  async function processEvent(lease, { eventId, merchantId, eventType, process }) {
    sanitizeBusinessId(eventId);
    const ref = db.doc(`posWebhookEvents/square_${eventId}`);
    const duplicate = await guarded(lease, async (tx, connection) => {
      const mapping = (await tx.get(mappingRef(merchantId))).data();
      const event = (await tx.get(ref)).data();
      if (mapping?.businessId !== lease.businessId || mapping.connectionStatus !== "connected" ||
          connection.externalMerchantId !== merchantId || connection.connectionStatus === "disconnected") fail("permission-denied");
      if (event && (event.businessId !== lease.businessId || event.merchantId !== merchantId)) fail("permission-denied");
      return Boolean(event?.processedAt);
    });
    if (duplicate) return { duplicate: true };
    await process();
    await guarded(lease, (tx) => {
      tx.set(ref, { provider: "square", eventId, merchantId, businessId: lease.businessId,
        eventType, processedAt: stamp() }, { merge: true });
      tx.set(lease.ref, { lastWebhookAt: stamp(), lastWebhookEventType: eventType, updatedAt: stamp() }, { merge: true });
    });
    return { duplicate: false };
  }

  return { consumeState, withLease, guarded, saveConnection, getSecret, disconnect, processEvent, assertManage };
}
