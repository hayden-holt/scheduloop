import { useCallback, useEffect, useMemo, useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { useAuth } from "../auth/AuthContext";
import { db } from "../firebase";
import { BusinessProfileContext } from "./BusinessProfileContext";

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

function isCompleteProfile(profile) {
  return Boolean(
    profile &&
      profile.businessType &&
      Array.isArray(profile.roles) &&
      profile.roles.length > 0 &&
      profile.hours
  );
}

function requireSignedInUser(user) {
  if (!user?.uid) {
    throw new Error("You must be logged in to save business data.");
  }
}

function createPermissionError(message) {
  const error = new Error(message);
  error.code = "permission-denied";
  return error;
}

function sanitizeText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function sanitizeProfilePatch(config) {
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

function normalizeRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  return WRITE_ROLES.has(normalized) || normalized === "employee"
    ? normalized
    : "manager";
}

function getMembershipFromSnap(snapshot) {
  if (!snapshot.exists()) return null;

  const data = snapshot.data();
  const businessId = sanitizeText(data.businessId, 128);
  const status = sanitizeText(data.status || "active", 40);

  if (!businessId || status !== "active") return null;

  return {
    businessId,
    role: normalizeRole(data.role),
    status,
    email: sanitizeText(data.email, 180),
    legacy: false,
  };
}

function createLegacyMembership(user) {
  return {
    businessId: user.uid,
    role: "owner",
    status: "legacy",
    email: user.email || "",
    legacy: true,
  };
}

function canWriteProfile(membership) {
  return Boolean(membership && WRITE_ROLES.has(membership.role));
}

function logProfileError(label, error) {
  if (import.meta.env.DEV) {
    console.error(label, error);
  }
}

export function BusinessProfileProvider({ children }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [membership, setMembership] = useState(null);
  const [businessId, setBusinessId] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState("");

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoadingProfile(true);
      setProfileError("");
      setAccessDenied(false);

      if (!user) {
        setProfile(null);
        setMembership(null);
        setBusinessId("");
        setLoadingProfile(false);
        return;
      }

      try {
        const membershipSnap = await getDoc(doc(db, "memberships", user.uid));
        const hasMembershipRecord = membershipSnap.exists();
        let nextMembership = getMembershipFromSnap(membershipSnap);
        let nextBusinessId = nextMembership?.businessId || "";
        let profileSnap = null;

        if (nextBusinessId) {
          profileSnap = await getDoc(doc(db, "businessProfiles", nextBusinessId));
        } else if (!hasMembershipRecord) {
          const legacySnap = await getDoc(doc(db, "businessProfiles", user.uid));
          if (legacySnap.exists()) {
            const legacyData = legacySnap.data();
            if (!legacyData.ownerUid || legacyData.ownerUid === user.uid) {
              nextMembership = createLegacyMembership(user);
              nextBusinessId = user.uid;
              profileSnap = legacySnap;
            }
          }
        }

        if (!active) return;

        if (!nextMembership || !nextBusinessId) {
          setProfile(null);
          setMembership(null);
          setBusinessId("");
          setAccessDenied(true);
          return;
        }

        setMembership(nextMembership);
        setBusinessId(nextBusinessId);

        if (!profileSnap?.exists()) {
          setProfile(null);
          return;
        }

        const data = profileSnap.data();
        if (data.businessId && data.businessId !== nextBusinessId) {
          throw new Error("Business profile membership check failed.");
        }

        if (
          nextMembership.legacy &&
          data.ownerUid &&
          data.ownerUid !== user.uid
        ) {
          throw new Error("Legacy business profile ownership check failed.");
        }

        setProfile({ ...data, businessId: nextBusinessId });
      } catch (err) {
        logProfileError("Failed to load ScheduleLoop profile", err);
        if (active) {
          setProfile(null);
          setMembership(null);
          setBusinessId("");
          setProfileError(
            "We could not load your ScheduleLoop workspace. Your business data was not changed."
          );
        }
      } finally {
        if (active) {
          setLoadingProfile(false);
        }
      }
    };

    load();

    return () => {
      active = false;
    };
  }, [user]);

  const saveProfile = useCallback(
    async (config) => {
      requireSignedInUser(user);

      if (!businessId || !canWriteProfile(membership)) {
        throw createPermissionError(
          "This account is not authorised to update this ScheduleLoop workspace."
        );
      }

      const safePatch = sanitizeProfilePatch(config);
      const statePayload = {
        ...(profile || {}),
        ...safePatch,
        businessId,
        ownerUid: profile?.ownerUid || user.uid,
        updatedBy: user.uid,
      };

      const firestorePayload = {
        ...safePatch,
        businessId,
        ownerUid: profile?.ownerUid || user.uid,
        updatedBy: user.uid,
        updatedAt: serverTimestamp(),
      };

      if (!profile) {
        firestorePayload.createdAt = serverTimestamp();
      }

      try {
        const ref = doc(db, "businessProfiles", businessId);
        await setDoc(ref, firestorePayload, { merge: true });
        setProfile(statePayload);
        setProfileError("");
        return statePayload;
      } catch (err) {
        logProfileError("Failed to save ScheduleLoop profile", err);
        throw err;
      }
    },
    [businessId, membership, profile, user]
  );

  const saveCsvDemand = useCallback(
    async (csvDemand) => saveProfile({ csvDemand }),
    [saveProfile]
  );

  const value = useMemo(
    () => ({
      profile,
      membership,
      businessId,
      accessDenied,
      canManageProfile: canWriteProfile(membership),
      hasProfile: isCompleteProfile(profile),
      loadingProfile,
      profileError,
      saveProfile,
      saveCsvDemand,
    }),
    [
      profile,
      membership,
      businessId,
      accessDenied,
      loadingProfile,
      profileError,
      saveProfile,
      saveCsvDemand,
    ]
  );

  return (
    <BusinessProfileContext.Provider value={value}>
      {children}
    </BusinessProfileContext.Provider>
  );
}
