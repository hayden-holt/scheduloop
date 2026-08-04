// src/auth/AuthProvider.jsx
import { useEffect, useMemo, useState } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateEmail,
  updatePassword,
} from "firebase/auth";
import { auth } from "../firebase";
import { AuthContext } from "./AuthContext";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        const { uid, email } = firebaseUser;
        setUser({ uid, email });
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
      signup: async (email, password) => {
        const credential = await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );
        setUser({
          uid: credential.user.uid,
          email: credential.user.email,
        });
        return credential;
      },
      login: async (email, password) => {
        const credential = await signInWithEmailAndPassword(
          auth,
          email,
          password
        );
        setUser({
          uid: credential.user.uid,
          email: credential.user.email,
        });
        return credential;
      },
      logout: async () => {
        await signOut(auth);
        setUser(null);
      },
      updateUserEmail: async (email) => {
        if (!auth.currentUser) {
          throw new Error("You must be logged in to update your email.");
        }

        const nextEmail = String(email || "").trim();
        await updateEmail(auth.currentUser, nextEmail);
        setUser({
          uid: auth.currentUser.uid,
          email: auth.currentUser.email,
        });
      },
      updateUserPassword: async (password) => {
        if (!auth.currentUser) {
          throw new Error("You must be logged in to update your password.");
        }

        await updatePassword(auth.currentUser, password);
      },
      resetPassword: async (email) => sendPasswordResetEmail(auth, email),
    }),
    [user, loading]
  );

  return (
    <AuthContext.Provider value={value}>
      {loading ? null : children}
    </AuthContext.Provider>
  );
}
