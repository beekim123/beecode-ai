import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function createOpaqueSecret(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export function secretsMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * Binds a rendered OAuth consent form to the authenticated browser session
 * without persisting the raw HttpOnly session secret.
 */
export function createOAuthConsentToken(
  browserSessionToken: string,
  input: { clientId: string; redirectUri: string; challenge: string; state: string },
): string {
  return createHmac("sha256", browserSessionToken)
    .update(JSON.stringify([input.clientId, input.redirectUri, input.challenge, input.state]), "utf8")
    .digest("base64url");
}
