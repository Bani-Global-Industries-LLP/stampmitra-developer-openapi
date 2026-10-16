#!/usr/bin/env node
// Generates fixtures/webhook-signatures.json deterministically (fixed secrets, fixed "now").
// Scheme (stampmitra-b2b-platform src/webhooks/webhook-signing.ts): hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
// where rawBody == JSON.stringify(payload) as sent. Headers: X-Webhook-Signature, X-Webhook-Timestamp (unix seconds), X-Webhook-Event-Id.
import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sign = (secret, ts, body) => createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");

const SECRET = "whsec_test_0123456789abcdef";
const WRONG = "whsec_test_fedcba9876543210";
const NOW = 1760605200; // 2026-10-16T09:00:00Z, the fixed clock for every vector
const payloadObj = { id: "evt_01HZX3P0C4", type: "order.completed", createdAt: "2026-10-16T08:59:58.000Z", data: { orderId: "ord_01HZX3K9Q2", status: "COMPLETED" } };
const body = JSON.stringify(payloadObj);
const unicodeBody = JSON.stringify({ id: "evt_unicode", type: "verification.completed", data: { name: "रवि कुमार", note: "café ₹500 ✓" } });
const ts = String(NOW - 10);

const mk = (name, description, o) => ({ name, description, ...o });
const vectors = [
  mk("valid", "Correct signature, fresh timestamp.", { secret: SECRET, timestamp: ts, payload: body, signature: sign(SECRET, ts, body), expected: { valid: true } }),
  mk("valid-unicode-payload", "Payload bytes are UTF-8; sign the raw string exactly as received.", { secret: SECRET, timestamp: ts, payload: unicodeBody, signature: sign(SECRET, ts, unicodeBody), expected: { valid: true } }),
  mk("valid-at-tolerance-edge", "Timestamp exactly 300 s old: accepted (|now - ts| <= tolerance).", { secret: SECRET, timestamp: String(NOW - 300), payload: body, signature: sign(SECRET, String(NOW - 300), body), expected: { valid: true } }),
  mk("valid-future-within-tolerance", "Clock skew: timestamp 60 s in the future is accepted.", { secret: SECRET, timestamp: String(NOW + 60), payload: body, signature: sign(SECRET, String(NOW + 60), body), expected: { valid: true } }),
  mk("tampered-payload", "Body altered after signing.", { secret: SECRET, timestamp: ts, payload: body.replace("COMPLETED", "FAILED"), signature: sign(SECRET, ts, body), expected: { valid: false, reason: "signature_mismatch" } }),
  mk("tampered-payload-whitespace", "Re-serialised (pretty-printed) body: signature covers the raw bytes, so it must fail.", { secret: SECRET, timestamp: ts, payload: JSON.stringify(payloadObj, null, 2), signature: sign(SECRET, ts, body), expected: { valid: false, reason: "signature_mismatch" } }),
  mk("tampered-timestamp", "Timestamp changed (still fresh) but signature was computed for the original.", { secret: SECRET, timestamp: String(NOW - 5), payload: body, signature: sign(SECRET, ts, body), expected: { valid: false, reason: "signature_mismatch" } }),
  mk("tampered-signature", "Last hex digit flipped.", { secret: SECRET, timestamp: ts, payload: body, signature: (() => { const s = sign(SECRET, ts, body); return s.slice(0, -1) + (s.endsWith("0") ? "1" : "0"); })(), expected: { valid: false, reason: "signature_mismatch" } }),
  mk("wrong-secret", "Signed with a different secret.", { secret: WRONG, timestamp: ts, payload: body, signature: sign(SECRET, ts, body), expected: { valid: false, reason: "signature_mismatch" } }),
  mk("stale-timestamp", "Correctly signed but 301 s old: beyond the 300 s tolerance.", { secret: SECRET, timestamp: String(NOW - 301), payload: body, signature: sign(SECRET, String(NOW - 301), body), expected: { valid: false, reason: "timestamp_outside_tolerance" } }),
  mk("stale-timestamp-hour", "Correctly signed but one hour old (replay).", { secret: SECRET, timestamp: String(NOW - 3600), payload: body, signature: sign(SECRET, String(NOW - 3600), body), expected: { valid: false, reason: "timestamp_outside_tolerance" } }),
  mk("future-timestamp-too-far", "Correctly signed but 301 s in the future.", { secret: SECRET, timestamp: String(NOW + 301), payload: body, signature: sign(SECRET, String(NOW + 301), body), expected: { valid: false, reason: "timestamp_outside_tolerance" } }),
  mk("malformed-timestamp", "Non-numeric timestamp header.", { secret: SECRET, timestamp: "yesterday", payload: body, signature: sign(SECRET, "yesterday", body), expected: { valid: false, reason: "invalid_timestamp" } }),
  mk("empty-signature", "Missing signature header.", { secret: SECRET, timestamp: ts, payload: body, signature: "", expected: { valid: false, reason: "signature_mismatch" } }),
  mk("non-hex-signature", "Signature that is not 64 hex chars (must not throw; compare safely).", { secret: SECRET, timestamp: ts, payload: body, signature: "not-a-signature", expected: { valid: false, reason: "signature_mismatch" } }),
  mk("uppercase-hex-signature", "Server emits lowercase hex; uppercase is NOT accepted by the reference implementation.", { secret: SECRET, timestamp: ts, payload: body, signature: sign(SECRET, ts, body).toUpperCase(), expected: { valid: false, reason: "signature_mismatch" } }),
];

const doc = {
  $comment: "Generated by scripts/build-webhook-vectors.mjs; verified by scripts/check-fixtures.mjs with Node crypto. Do not hand-edit.",
  version: 1,
  scheme: "hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`))",
  headers: { signature: "X-Webhook-Signature", timestamp: "X-Webhook-Timestamp", eventId: "X-Webhook-Event-Id" },
  timestampUnit: "unix seconds (string)",
  toleranceSeconds: 300,
  now: NOW,
  comparison: "constant-time",
  vectors,
};
writeFileSync(resolve(root, "fixtures/webhook-signatures.json"), JSON.stringify(doc, null, 2) + "\n");
console.log(`wrote ${vectors.length} vectors`);
