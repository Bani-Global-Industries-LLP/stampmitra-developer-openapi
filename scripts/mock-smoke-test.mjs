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
await ok("documented 429 carries Retry-After: 1 (contract >= 1.2.0); retry-after:<n> scenario overrides it", async () => {
  const r = await call("POST", "/v1/verify/gstin", { "x-mock-scenario": "error-429" }, { gstin: "x" });
  assert.equal(r.status, 429); assert.equal(r.headers.get("retry-after"), "1");
  const r2 = await call("POST", "/v1/verify/gstin", { "x-mock-scenario": "retry-after:7" }, { gstin: "x" });
  assert.equal(r2.status, 429); assert.equal(r2.headers.get("retry-after"), "7"); assert.equal(r2.json.error.code, "TOO_MANY_REQUESTS");
});
await ok("success-201 additional documented 2xx (and an undocumented success-201 is 501)", async () => {
  const r = await call("POST", "/v1/estamp/duty/calculate", { "x-mock-scenario": "success-201" }, {});
  assert.equal(r.status, 201);
  assert.equal((await call("POST", "/v1/verify/pan", { "x-mock-scenario": "success-201" }, { pan: "ABCDE1234F" })).status, 501);
});
await ok("literal segments win over {param} (states/availability, orders/validate)", async () => {
  const a = await call("GET", "/v1/estamp/states/availability");
  assert.equal(a.status, 200); assert.equal(a.json.activeCount, 1);
  const st = await call("GET", "/v1/estamp/states/MH");
  assert.equal(st.status, 200); assert.equal(st.json.code, "MH");
  const v = await call("POST", "/v1/estamp/orders/validate", {}, { state: "MH" });
  assert.equal(v.status, 200);
  assert.equal((await call("GET", "/v1/estamp/orders/estord_9c1f2a3b")).json.id, "estord_9c1f2a3b");
  const sro = await call("GET", "/v1/estamp/states/MH/districts/PUNE/sros");
  assert.equal(sro.status, 200); assert.ok(Array.isArray(sro.json));
});
await ok("POST /v1/estamp/stamps/{stampId}/pan-card answers 202 as its only success", async () => {
  const r = await call("POST", "/v1/estamp/stamps/eststamp_4f21ab/pan-card", {}, { panCardImage: "https://cdn.example.com/kyc/pan-4417.jpg" });
  assert.equal(r.status, 202); assert.equal(r.json.panCard.status, "PROCESSING");
  assert.equal((await call("POST", "/v1/estamp/stamps/eststamp_4f21ab/pan-card", { "x-mock-scenario": "error-409" }, {})).status, 409);
});
await ok("multipart upload is accepted and recorded (parts, filename, content type, size)", async () => {
  await fetch(base + "/__mock/reset", { method: "POST" });
  const fd = new FormData();
  fd.append("file", new Blob(["%PDF-1.4\n%%EOF\n"], { type: "application/pdf" }), "pan.pdf");
  fd.append("type", "pan_card");
  const res = await fetch(base + "/v1/estamp/orders/estord_9c1f2a3b/documents", { method: "POST", headers: { Authorization: H.Authorization, "Idempotency-Key": "doc-k1" }, body: fd });
  assert.equal(res.status, 201); assert.equal((await res.json()).status, "RECEIVED");
  const rec = (await (await fetch(base + "/__mock/requests")).json())[0];
  assert.equal(rec.headers["idempotency-key"], "doc-k1");
  assert.deepEqual(rec.body.multipart, [{ name: "file", filename: "pan.pdf", contentType: "application/pdf", size: 15 }, { name: "type", size: 8, value: "pan_card" }]);
  const bad = await fetch(base + "/v1/estamp/orders/estord_9c1f2a3b/documents", { method: "POST", headers: { Authorization: H.Authorization, "x-mock-scenario": "error-400" }, body: fd });
  assert.equal(bad.status, 400);
});
await ok("wallets: topup 200 + 201, balance, transactions, invoices", async () => {
  for (const w of ["stamp-duty-wallet", "service-fee-wallet"]) {
    assert.equal((await call("POST", `/v1/${w}/topup`, {}, { baseAmount: 1000 })).status, 200);
    assert.equal((await call("POST", `/v1/${w}/topup`, { "x-mock-scenario": "success-201" }, { baseAmount: 1000 })).status, 201);
    assert.equal((await call("GET", `/v1/${w}`)).status, 200);
    assert.equal((await call("GET", `/v1/${w}/transactions?limit=5`)).status, 200);
    assert.equal((await call("GET", `/v1/${w}/invoices`)).status, 200);
    assert.equal((await call("GET", `/v1/${w}/invoices/inv_1`)).status, 200);
    assert.equal((await call("GET", `/v1/${w}/invoices/inv_1`, { "x-mock-scenario": "error-404" })).status, 404);
  }
  const fee = (await call("POST", "/v1/stamp-duty-wallet/topup", {}, { baseAmount: 1000 })).json;
  assert.equal(fee.processingFeePercent, "6.00"); assert.equal(fee.gstAmount, 10.8); assert.equal(fee.creditAmount, "1000.00");
  assert.equal((await call("GET", "/v1/estamp/wallet")).status, 200);
});
await ok("generic error for undocumented status", async () => {
  const r = await call("GET", "/v1/usage/summary", { "x-mock-scenario": "error-503" });
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
