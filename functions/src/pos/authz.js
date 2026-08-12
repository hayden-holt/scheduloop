const MANAGE_ROLES = new Set(["owner", "admin", "manager"]);

export function canManagePosIntegration(membership, businessId) {
  return Boolean(
    membership &&
      membership.businessId === businessId &&
      membership.status === "active" &&
      MANAGE_ROLES.has(String(membership.role || "").toLowerCase())
  );
}

export function canManageLegacyBusinessProfile({ uid, businessId, profile }) {
  return Boolean(
    uid &&
      businessId &&
      uid === businessId &&
      profile &&
      (!profile.ownerUid || profile.ownerUid === uid)
  );
}

export function sanitizeBusinessId(value) {
  return String(value || "").trim().slice(0, 128);
}
