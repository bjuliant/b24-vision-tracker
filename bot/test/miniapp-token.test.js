import test from "node:test";
import assert from "node:assert/strict";
import { signMiniAppToken, verifyMiniAppToken } from "../miniapp-token.js";

const secret = "test-only-secret";
const now = Date.UTC(2026, 6, 17, 12, 0, 0);

test("map and exporter credentials retain their galaxy and purpose", () => {
  const mapToken = signMiniAppToken(secret, { u: "10", c: "-20", g: "B23", p: "map", e: now + 1_000 });
  const exportToken = signMiniAppToken(secret, { u: "10", c: "-20", g: "B24", p: "export", e: now + 30_000 });

  assert.deepEqual(verifyMiniAppToken(secret, mapToken, { now }), {
    u: "10", c: "-20", g: "B23", p: "map", e: now + 1_000, l: ""
  });
  assert.deepEqual(verifyMiniAppToken(secret, exportToken, { now }), {
    u: "10", c: "-20", g: "B24", p: "export", e: now + 30_000, l: ""
  });
});

test("expired or tampered credentials fail closed", () => {
  const expired = signMiniAppToken(secret, { u: "10", c: "-20", g: "B23", p: "export", e: now - 1 });
  const valid = signMiniAppToken(secret, { u: "10", c: "-20", g: "B23", p: "export", e: now + 1_000 });
  const tampered = `${valid.slice(0, -1)}${valid.endsWith("a") ? "b" : "a"}`;

  assert.equal(verifyMiniAppToken(secret, expired, { now }), null);
  assert.equal(verifyMiniAppToken(secret, tampered, { now }), null);
});
