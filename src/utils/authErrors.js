export function getFriendlyAuthErrorMessage(error, fallback) {
  const code = error?.code;

  if (code === "auth/invalid-email") {
    return "Enter a valid email address.";
  }

  if (
    code === "auth/invalid-action-code" ||
    code === "auth/invalid-credential" ||
    code === "auth/missing-email"
  ) {
    return "This sign-in link is not valid. Request a new secure link.";
  }

  if (code === "auth/expired-action-code") {
    return "This sign-in link has expired. Request a new secure link.";
  }

  if (code === "auth/user-disabled") {
    return "This account cannot sign in. Contact ScheduleLoop support.";
  }

  if (code === "auth/operation-not-allowed") {
    return "Secure sign-in is not configured yet. Contact ScheduleLoop support.";
  }

  if (code === "auth/too-many-requests") {
    return "Too many attempts. Please wait a moment before trying again.";
  }

  if (code === "auth/network-request-failed") {
    return "Network problem. Check your connection and try again.";
  }

  return fallback || "Something went wrong. Please try again.";
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}
