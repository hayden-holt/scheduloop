import { getFunctions, httpsCallable } from "firebase/functions";

const functions = getFunctions();

export function getSquareIntegrationEnabled() {
  return import.meta.env.VITE_ENABLE_SQUARE_INTEGRATION === "true";
}

export async function createSquareOAuthUrl(businessId) {
  const callable = httpsCallable(functions, "createSquareOAuthUrl");
  const result = await callable({ businessId });
  return result.data.url;
}

export async function syncSquareHistory(businessId, days = 30) {
  const callable = httpsCallable(functions, "syncSquareHistory");
  const result = await callable({ businessId, days });
  return result.data;
}

export async function disconnectSquare(businessId) {
  const callable = httpsCallable(functions, "disconnectSquare");
  const result = await callable({ businessId });
  return result.data;
}
