import { createHmac, timingSafeEqual } from "node:crypto";

export function signMiniAppToken(secret, payload) {
  if (!secret) throw new Error("Mini app access secret is required");
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyMiniAppToken(secret, value, { now = Date.now() } = {}) {
  const [encoded, signature] = String(value || "").split(".");
  if (!encoded || !signature || !secret) return null;

  const expected = createHmac("sha256", secret).update(encoded).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const galaxy = String(payload.g || "").trim().toUpperCase();
    if (!payload.u || !payload.c || !/^B\d{2}$/.test(galaxy) || Number(payload.e) <= now) return null;
    return {
      ...payload,
      u: String(payload.u),
      c: String(payload.c),
      g: galaxy,
      l: String(payload.l || ""),
      p: String(payload.p || "map")
    };
  } catch {
    return null;
  }
}
