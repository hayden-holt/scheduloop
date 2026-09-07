// src/auth/AuthProvider.jsx
import { useEffect, useMemo, useState } from "react";
import {
  browserLocalPersistence,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  setPersistence,
  signInWithEmailLink,
  signOut,
} from "firebase/auth";
import { auth } from "../firebase";
import { AuthContext } from "./AuthContext";
import { isValidEmail } from "../utils/authErrors";

const EMAIL_LINK_STORAGE_KEY = "scheduloop.emailForSignIn";
const SIGN_IN_REDIRECT_PATH = "/login";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function getActionCodeSettings() {
  const url = new URL(SIGN_IN_REDIRECT_PATH, window.location.origin);
  return {
    url: url.toString(),
    handleCodeInApp: true,
  };
}

function getStoredEmailForSignIn() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(EMAIL_LINK_STORAGE_KEY) || "";
}

function setStoredEmailForSignIn(email) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(EMAIL_LINK_STORAGE_KEY, email);
}

function clearStoredEmailForSignIn() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(EMAIL_LINK_STORAGE_KEY);
}

function AuthLoadingScreen() {
  return (
    <div className="app route-loading-screen" aria-live="polite" aria-label="Loading">
      <div className="route-loading-spinner" />
      <p className="route-loading-text">Loading ScheduleLoop...</p>
    </div>
  );
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        const { uid, email, emailVerified } = firebaseUser;
        setUser({ uid, email, emailVerified });
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      getEmailForSignIn: getStoredEmailForSignIn,
      isEmailSignInLink: (link) => isSignInWithEmailLink(auth, link),
      requestSignInLink: async (email) => {
        const normalizedEmail = normalizeEmail(email);
        if (!isValidEmail(normalizedEmail)) {
          const error = new Error("Enter a valid email address.");
          error.code = "auth/invalid-email";
          throw error;
        }

        await setPersistence(auth, browserLocalPersistence);
        await sendSignInLinkToEmail(
          auth,
          normalizedEmail,
          getActionCodeSettings()
        );
        setStoredEmailForSignIn(normalizedEmail);
      },
      completeEmailLinkSignIn: async (email, link = window.location.href) => {
        const normalizedEmail = normalizeEmail(email);
        if (!isValidEmail(normalizedEmail)) {
          const error = new Error("Enter the same work email to finish sign-in.");
          error.code = "auth/invalid-email";
          throw error;
        }

        if (!isSignInWithEmailLink(auth, link)) {
          const error = new Error("This sign-in link is not valid.");
          error.code = "auth/invalid-action-code";
          throw error;
        }

        await setPersistence(auth, browserLocalPersistence);
        const credential = await signInWithEmailLink(
          auth,
          normalizedEmail,
          link
        );
        clearStoredEmailForSignIn();
        setUser({
          uid: credential.user.uid,
          email: credential.user.email,
          emailVerified: credential.user.emailVerified,
        });
        return credential;
      },
      logout: async () => {
        await signOut(auth);
        clearStoredEmailForSignIn();
        setUser(null);
      },
    }),
    [user, loading]
  );

  return (
    <AuthContext.Provider value={value}>
      {loading ? <AuthLoadingScreen /> : children}
    </AuthContext.Provider>
  );
}
