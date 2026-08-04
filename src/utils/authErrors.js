export function getFriendlyAuthErrorMessage(error, fallback) {
  const code = error?.code;

  if (code === "auth/invalid-email") {
    return "Enter a valid email address.";
  }

  if (
    code === "auth/invalid-credential" ||
    code === "auth/wrong-password" ||
    code === "auth/user-not-found"
  ) {
    return "We could not log you in. Check the email and password, then try again.";
  }

  if (code === "auth/email-already-in-use") {
    return "An account already exists for this email. Try logging in instead.";
  }

  if (code === "auth/weak-password") {
    return "Use a stronger password with at least 8 characters.";
  }

  if (code === "auth/too-many-requests") {
    return "Too many attempts. Please wait a moment before trying again.";
  }

  if (code === "auth/requires-recent-login") {
    return "For security, log out and back in, then try this account change again.";
  }

  if (code === "auth/network-request-failed") {
    return "Network problem. Check your connection and try again.";
  }

  return fallback || "Something went wrong. Please try again.";
}

export function canRequestPasswordReset(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}
