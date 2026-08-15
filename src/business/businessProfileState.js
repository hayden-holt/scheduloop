const WRITE_ROLES = new Set(["owner", "admin", "manager"]);

const PROFILE_WRITE_KEYS = new Set([
  "businessType",
  "businessName",
  "businessSubtype",
  "location",
  "customerPattern",
  "businessRhythm",
  "demandEstimates",
  "roles",
  "hours",
  "busyLevel",
  "peakStaff",
  "csvDemand",
  "dayConfigs",
  "operatingRules",
  "staffingFeedback",
]);

export function isCompleteProfile(profile) {
  return Boolean(
    profile &&
      profile.businessType &&
      Array.isArray(profile.roles) &&
      profile.roles.length > 0 &&
      profile.hours
  );
}

export function sanitizeText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

export function sanitizeProfilePatch(config) {
  return Object.fromEntries(
    Object.entries(config || {})
      .filter(([key]) => PROFILE_WRITE_KEYS.has(key))
      .map(([key, value]) => {
        if (key === "businessName") return [key, sanitizeText(value, 120)];
        if (key === "businessSubtype") return [key, sanitizeText(value, 80)];
        if (key === "businessType") return [key, sanitizeText(value, 40)];
        if (key === "location") return [key, sanitizeText(value, 120)];
        if (key === "customerPattern") return [key, sanitizeText(value, 40)];
        if (key === "businessRhythm") return [key, sanitizeText(value, 40)];
        if (key === "busyLevel") return [key, sanitizeText(value, 40)];
        return [key, value];
      })
  );
}

export function normalizeRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  return WRITE_ROLES.has(normalized) || normalized === "employee"
    ? normalized
    : "manager";
}

export function normalizeMembershipData(data) {
  if (!data) return null;

  const businessId = sanitizeText(data.businessId, 128);
  const status = sanitizeText(data.status || "active", 40);
  const hasOnboardingComplete = Object.prototype.hasOwnProperty.call(
    data,
    "onboardingComplete"
  );
  const onboardingComplete = data.onboardingComplete === true;
  const legacyProvisioned =
    status === "active" && Boolean(businessId) && !hasOnboardingComplete;
  const needsOnboarding =
    status === "active" && !onboardingComplete && !legacyProvisioned;

  return {
    businessId,
    role: normalizeRole(data.role),
    status,
    email: sanitizeText(data.email, 180),
    onboardingComplete,
    needsOnboarding,
    legacyProvisioned,
    legacy: false,
  };
}

export function shouldLoadBusinessProfileForMembership(membership) {
  return Boolean(
    membership?.status === "active" &&
      membership.businessId &&
      (membership.onboardingComplete || membership.legacyProvisioned)
  );
}

export function createLegacyMembership(user) {
  return {
    businessId: user.uid,
    role: "owner",
    status: "active",
    email: user.email || "",
    onboardingComplete: true,
    needsOnboarding: false,
    legacy: true,
  };
}

export function canWriteProfile(membership) {
  return Boolean(membership && WRITE_ROLES.has(membership.role));
}

export function buildCompletedOnboardingState({
  config,
  businessId,
  user,
  membership,
  profile,
}) {
  const safePatch = sanitizeProfilePatch(config);
  const nextProfile = {
    ...(profile || {}),
    ...safePatch,
    businessId,
    ownerUid: profile?.ownerUid || user.uid,
    updatedBy: user.uid,
  };
  const nextMembership = {
    ...(membership || {}),
    businessId,
    status: "active",
    email: membership?.email || user.email || "",
    role: normalizeRole(membership?.role),
    onboardingComplete: true,
    needsOnboarding: false,
  };

  return { safePatch, profile: nextProfile, membership: nextMembership };
}

export function getWorkspaceRouteState({
  isAuthenticated,
  loadingProfile = false,
  accessDenied = false,
  membership = null,
  profile = null,
  profileError = "",
}) {
  if (!isAuthenticated) return "login";
  if (loadingProfile) return "loading";
  if (accessDenied || !membership || membership.status !== "active") {
    return "accessDenied";
  }
  if (profileError) return "profileError";
  if (membership.onboardingComplete && !membership.businessId) {
    return "profileError";
  }
  if (membership.needsOnboarding || !isCompleteProfile(profile)) {
    return "onboarding";
  }
  return "dashboard";
}
