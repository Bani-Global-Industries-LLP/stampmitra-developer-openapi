#!/usr/bin/env node
// Smoke test for scripts/mock-server.mjs: starts it on an ephemeral port and exercises routing + scenarios.
import assert from "node:assert/strict";
import { createMockServer } from "./mock-server.mjs";

const server = createMockServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const H = { Authorization: "Bearer sk_test_EXAMPLEKEY00000000", "Content-Type": "application/json" };
const call = async (method, path, headers = {}, body) => {
  const res = await fetch(base + path, { method, headers: { ...H, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, headers: res.headers, json: await res.json() };
};
let n = 0;
const ok = (name, fn) => fn().then(() => { n++; console.log("  ok -", name); });

await ok("POST /v1/verify/pan success", async () => {
  const r = await call("POST", "/v1/verify/pan", {}, { pan: "ABCDE1234F" });
  assert.equal(r.status, 200); assert.equal(r.json.referenceId, "SMV-20260927-8F42K7");
});
await ok("path params resolve (GET /v1/orders/{id}/documents/{documentId}/download)", async () => {
  const r = await call("GET", "/v1/orders/abc/documents/xyz/download");
  assert.equal(r.status, 200);
});
await ok("error-400 documented fixture", async () => {
  const r = await call("POST", "/v1/verify/pan", { "x-mock-scenario": "error-400" }, { pan: "bad" });
  assert.equal(r.status, 400); assert.equal(r.json.error.code, "BAD_REQUEST");
});
await ok("429 carries Retry-After", async () => {
  const r = await call("POST", "/v1/verify/gstin", { "x-mock-scenario": "error-429" }, { gstin: "x" });
  assert.equal(r.status, 429); assert.equal(r.headers.get("retry-after"), "30");
});
await ok("generic error for undocumented status", async () => {
  const r = await call("GET", "/v1/services", { "x-mock-scenario": "error-503" });
  assert.equal(r.status, 503); assert.equal(r.json.error.code, "SERVICE_UNAVAILABLE");
});
await ok("seq:503,503,200 is stateful", async () => {
  const s = [];
  for (let i = 0; i < 3; i++) s.push((await call("GET", "/v1/services", { "x-mock-scenario": "seq:k1:503,503,200" })).status);
  assert.deepEqual(s, [503, 503, 200]);
});
await ok("requests are recorded (Idempotency-Key visible)", async () => {
  await fetch(base + "/__mock/reset", { method: "POST" });
  await call("POST", "/v1/orders", { "Idempotency-Key": "k-123" }, { externalOrderId: "a", externalCustomerId: "b", serviceCode: "s" });
  const rec = await (await fetch(base + "/__mock/requests")).json();
  assert.equal(rec.length, 1); assert.equal(rec[0].headers["idempotency-key"], "k-123");
});
await ok("missing auth -> 401", async () => {
  const res = await fetch(base + "/v1/services");
  assert.equal(res.status, 401);
});
await ok("unknown route -> 404, unknown scenario -> 501", async () => {
  assert.equal((await call("GET", "/v1/nope")).status, 404);
  assert.equal((await call("GET", "/v1/services", { "x-mock-scenario": "error-418x" })).status, 501);
});
await ok("delay scenario", async () => {
  const t = Date.now(); await call("GET", "/v1/services", { "x-mock-scenario": "delay:150" });
  assert.ok(Date.now() - t >= 140);
});
server.close();
console.log(`OK: mock server smoke test, ${n} checks`);
