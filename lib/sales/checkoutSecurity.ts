import crypto from "node:crypto";

export function createSalesCheckoutToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashSalesCheckoutToken(token: string) {
  return crypto
    .createHash("sha256")
    .update(token.trim(), "utf8")
    .digest("hex");
}

export function isValidSalesCheckoutToken(token: string) {
  return /^[A-Za-z0-9_-]{32,96}$/.test(token.trim());
}
