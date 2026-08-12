import { generateOpaqueToken, sha256 } from "./crypto.js";

const STATE_TTL_MS = 10 * 60 * 1000;

export function createOAuthStateRecord({
  uid,
  businessId,
  redirectPath = "/data-sources",
  now = new Date(),
} = {}) {
  const state = generateOpaqueToken(32);
  const createdAt = now.toISOString();

  return {
    state,
    stateHash: sha256(state),
    record: {
      uid,
      businessId,
      redirectPath,
      createdAt,
      expiresAt: new Date(now.getTime() + STATE_TTL_MS).toISOString(),
      consumedAt: null,
    },
  };
}

export function isOAuthStateRecordValid(record, { uid, now = new Date() } = {}) {
  if (!record || record.consumedAt) return false;
  if (uid && record.uid !== uid) return false;
  const expiresAt =
    typeof record.expiresAt?.toDate === "function"
      ? record.expiresAt.toDate()
      : new Date(record.expiresAt);
  return Number.isFinite(expiresAt.getTime()) && expiresAt > now;
}
