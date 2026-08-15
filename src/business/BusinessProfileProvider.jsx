import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { useAuth } from "../auth/AuthContext";
import { db } from "../firebase";
import { BusinessProfileContext } from "./BusinessProfileContext";
import {
  buildCompletedOnboardingState,
  canWriteProfile,
  createLegacyMembership,
  isCompleteProfile,
  normalizeMembershipData,
  sanitizeProfilePatch,
  shouldLoadBusinessProfileForMembership,
} from "./businessProfileState";

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

function getMembershipFromSnap(snapshot) {
  return snapshot.exists() ? normalizeMembershipData(snapshot.data()) : null;
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
        let nextBusinessId = "";
        let profileSnap = null;

        if (nextMembership?.status && nextMembership.status !== "active") {
          nextMembership = null;
        } else if (
          nextMembership?.onboardingComplete &&
          !nextMembership.businessId
        ) {
          throw new Error("Completed membership is missing a businessId.");
        } else if (shouldLoadBusinessProfileForMembership(nextMembership)) {
          nextBusinessId = nextMembership.businessId;
          profileSnap = await getDoc(
            doc(db, "businessProfiles", nextBusinessId)
          );
          if (!profileSnap.exists()) {
            if (nextMembership.legacyProvisioned) {
              nextMembership = {
                ...nextMembership,
                businessId: "",
                onboardingComplete: false,
                needsOnboarding: true,
                legacyProvisioned: false,
              };
              nextBusinessId = "";
              profileSnap = null;
            } else {
              throw new Error("Expected business profile was not found.");
            }
          } else if (nextMembership.legacyProvisioned) {
            nextMembership = {
              ...nextMembership,
              onboardingComplete: true,
              needsOnboarding: false,
              legacyProvisioned: false,
            };
          }
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

        if (!nextMembership) {
          setProfile(null);
          setMembership(null);
          setBusinessId("");
          setAccessDenied(true);
          return;
        }

        if (nextMembership.needsOnboarding) {
          setProfile(null);
          setMembership(nextMembership);
          setBusinessId("");
          setAccessDenied(false);
          return;
        }

        if (!nextBusinessId) {
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

  const completeOnboarding = useCallback(
    async (config) => {
      requireSignedInUser(user);

      if (!membership || membership.status !== "active" || !canWriteProfile(membership)) {
        throw createPermissionError(
          "This account is not authorised to create a ScheduleLoop workspace."
        );
      }

      const profileRef = doc(collection(db, "businessProfiles"));
      const membershipRef = doc(db, "memberships", user.uid);
      const nextBusinessId = profileRef.id;
      const {
        safePatch,
        profile: nextProfile,
        membership: nextMembership,
      } = buildCompletedOnboardingState({
        config,
        businessId: nextBusinessId,
        user,
        membership,
        profile,
      });
      const timestamp = serverTimestamp();
      const firestoreProfile = {
        ...safePatch,
        businessId: nextBusinessId,
        ownerUid: profile?.ownerUid || user.uid,
        updatedBy: user.uid,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      try {
        const batch = writeBatch(db);
        batch.set(profileRef, firestoreProfile);
        batch.set(
          membershipRef,
          {
            businessId: nextBusinessId,
            onboardingComplete: true,
            updatedAt: timestamp,
          },
          { merge: true }
        );
        await batch.commit();
        setProfile(nextProfile);
        setMembership(nextMembership);
        setBusinessId(nextBusinessId);
        setAccessDenied(false);
        setProfileError("");
        return nextProfile;
      } catch (err) {
        logProfileError("Failed to complete ScheduleLoop onboarding", err);
        throw err;
      }
    },
    [membership, profile, user]
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
      needsOnboarding: Boolean(membership?.needsOnboarding),
      loadingProfile,
      profileError,
      completeOnboarding,
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
      completeOnboarding,
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
