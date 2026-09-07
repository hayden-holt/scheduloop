const MANAGE_ROLES = new Set(["owner", "admin", "manager"]);

export function canManagePosIntegration(membership, businessId) {
  return Boolean(
    membership &&
      membership.businessId === businessId &&
      membership.status === "active" &&
      (!("onboardingComplete" in membership) || membership.onboardingComplete === true) &&
      MANAGE_ROLES.has(String(membership.role || "").toLowerCase())
  );
}

export function canManageLegacyBusinessProfile({ uid, businessId, profile }) {
  return Boolean(
    uid &&
      businessId &&
      uid === businessId &&
      profile &&
      profile.ownerUid === uid
  );
}

export function sanitizeBusinessId(value) {
  if (typeof value !== "string" || !value || value.length > 128 ||
      value !== value.trim() || (value.includes("/") || value.includes("\\") || [...value].some(char => char.charCodeAt(0) < 32)) || value === "." || value === "..") {
    throw new Error("Invalid Square resource identifier.");
  }
  return value;
}
