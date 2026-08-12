import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function getEncryptionKey(secret) {
  if (!secret) {
    throw new Error("Missing token encryption key.");
  }

  const trimmed = String(secret).trim();
  const base64 = Buffer.from(trimmed, "base64");
  if (base64.length === 32) return base64;

  return crypto.createHash("sha256").update(trimmed).digest();
}

export function encryptSecret(value, secret) {
  const iv = crypto.randomBytes(IV_BYTES);
  const key = getEncryptionKey(secret);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptSecret(encryptedValue, secret) {
  const [version, iv, tag, ciphertext] = String(encryptedValue || "").split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) {
    throw new Error("Unsupported encrypted secret format.");
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getEncryptionKey(secret),
    Buffer.from(iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function generateOpaqueToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}
