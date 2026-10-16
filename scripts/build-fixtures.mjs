#!/usr/bin/env node
// Regenerates fixtures/operations/*.json from openapi.json.
// Success + every documented error status per operation. Bodies come from the spec examples; where the
// spec has no example (the schema is just `{type: object}`) an ILLUSTRATIVE body from ILLUSTRATIVE below is
// used and the fixture is tagged `"source": "illustrative"`. Illustrative bodies are shape hints only.
// Fixtures are keyed by METHOD + path template (never operationId).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const spec = JSON.parse(readFileSync(resolve(root, "openapi.json"), "utf8"));
const outDir = resolve(root, "fixtures/operations");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const PATH_PARAMS = {
  serviceCode: "estamp.instrument.rent_agreement",
  stateCode: "MH",
  instrumentCode: "rent_agreement",
  orderId: "ord_01HZX3K9Q2",
  id: "ord_01HZX3K9Q2",
  documentId: "doc_01HZX3MA77",
};
const ID_OVERRIDE = {
  "GET /v1/payments/intents/{id}": "pi_01HZX3N5B8",
  "POST /v1/webhooks/events/{id}/replay": "evt_01HZX3P0C4",
};
const IDEMPOTENT = new Set(["POST /v1/orders", "POST /v1/payments/intents", "POST /v1/estamp/orders/{orderId}/parties"]);
const REQUEST_ID = "a1b2c3d4-e5f6-4a1b-8c2d-9f0e1a2b3c4d";

const ILLUSTRATIVE = {
  "GET /v1/services/{serviceCode}": { response: { serviceCode: "estamp.instrument.rent_agreement", name: "Rent Agreement e-Stamp", active: true } },
  "GET /v1/estamp/schema/{serviceCode}": { response: { serviceCode: "estamp.instrument.rent_agreement", fields: [{ name: "state", type: "string", required: true }, { name: "stampValue", type: "number", required: true }] } },
  "GET /v1/estamp/states": { response: { states: [{ code: "MH", name: "Maharashtra" }, { code: "DL", name: "Delhi" }] } },
  "GET /v1/estamp/states/{stateCode}/instruments": { response: { instruments: [{ code: "rent_agreement", name: "Rent Agreement" }] } },
  "GET /v1/estamp/instruments/{instrumentCode}/articles": { response: { articles: [{ code: "ART-36", name: "Lease" }] } },
  "POST /v1/estamp/duty/calculate": { request: { state: "MH", instrumentCode: "rent_agreement", consideration: 120000 }, response: { amount: 500, currency: "INR" } },
  "POST /v1/estamp/orders/{orderId}/parties": { request: { parties: [{ role: "first_party", name: "Rahul Kumar" }, { role: "second_party", name: "Anita Sharma" }] }, response: { orderId: "ord_01HZX3K9Q2", partiesCount: 2 } },
  "POST /v1/orders": { response: { id: "ord_01HZX3K9Q2", externalOrderId: "ord_ext_123", serviceCode: "estamp.instrument.rent_agreement", status: "created" } },
  "GET /v1/orders/{id}": { response: { id: "ord_01HZX3K9Q2", externalOrderId: "ord_ext_123", status: "created" } },
  "GET /v1/orders/{id}/status": { response: { id: "ord_01HZX3K9Q2", status: "created" } },
  "POST /v1/payments/intents": { request: { orderId: "ord_01HZX3K9Q2" }, response: { id: "pi_01HZX3N5B8", orderId: "ord_01HZX3K9Q2", status: "requires_payment" } },
  "GET /v1/payments/intents/{id}": { response: { id: "pi_01HZX3N5B8", orderId: "ord_01HZX3K9Q2", status: "requires_payment" } },
  "GET /v1/orders/{id}/payment": { response: { orderId: "ord_01HZX3K9Q2", status: "pending" } },
  "GET /v1/orders/{id}/documents": { response: { documents: [{ id: "doc_01HZX3MA77", type: "certificate", name: "e-stamp-certificate.pdf" }] } },
  "GET /v1/orders/{id}/documents/{documentId}/download": { response: { url: "https://files.example.invalid/doc_01HZX3MA77.pdf", expiresAt: "2026-10-15T10:00:00.000Z" } },
  "GET /v1/webhooks/events": { response: { items: [{ id: "evt_01HZX3P0C4", type: "order.completed", status: "SUCCEEDED", attempts: 1 }], nextCursor: null } },
  "POST /v1/webhooks/events/{id}/replay": { response: { id: "evt_01HZX3P0C4", status: "QUEUED" } },
};

const json = (c) => c?.["application/json"];
const slug = (m, p) => `${m}-${p.replace(/[{}]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "")}`.toLowerCase();

function build(method, path, op) {
  const key = `${method.toUpperCase()} ${path}`;
  const params = op.parameters ?? [];
  let url = path;
  for (const p of params.filter((x) => x.in === "path")) {
    const v = (p.name === "id" && ID_OVERRIDE[key]) || PATH_PARAMS[p.name] || "example";
    url = url.replace(`{${p.name}}`, encodeURIComponent(v));
  }
  const query = {};
  if (path === "/v1/logs") Object.assign(query, { from: "2026-10-01T00:00:00.000Z", to: "2026-10-16T00:00:00.000Z", service: "pan.verify", status: "success", limit: "50" });
  if (path === "/v1/webhooks/events") Object.assign(query, { limit: "20" });

  const headers = { Authorization: "Bearer sk_test_EXAMPLEKEY00000000", Accept: "application/json" };
  const reqSpec = json(op.requestBody?.content);
  const ill = ILLUSTRATIVE[key] ?? {};
  let body;
  let reqSource;
  if (op.requestBody) {
    headers["Content-Type"] = "application/json";
    if (reqSpec?.example !== undefined) { body = reqSpec.example; reqSource = "spec-example"; }
    else { body = ill.request ?? {}; reqSource = "illustrative"; }
  }
  if (IDEMPOTENT.has(key)) headers["Idempotency-Key"] = "7b1d2c58-4f1a-4c1e-9a53-0d6f7e2b9c11";

  const fixtures = [];
  for (const [status, res] of Object.entries(op.responses)) {
    const ex = json(res.content)?.example;
    const isOk = status.startsWith("2");
    let rbody, source;
    if (ex !== undefined) { rbody = ex; source = "spec-example"; }
    else if (isOk && ill.response) { rbody = ill.response; source = "illustrative"; }
    else if (!isOk) { rbody = { error: { code: "ERROR", message: res.description, requestId: REQUEST_ID } }; source = "illustrative"; }
    else throw new Error(`no body for ${key} ${status}`);
    const rh = { "Content-Type": "application/json", "x-request-id": rbody?.error?.requestId ?? REQUEST_ID };
    if (status === "429") rh["Retry-After"] = "30";
    const scenario = isOk ? "success" : `error-${status}`;
    const request = { method: method.toUpperCase(), path: url, ...(Object.keys(query).length ? { query } : {}), headers, ...(body !== undefined ? { body } : {}) };
    fixtures.push({
      name: `${method.toUpperCase()} ${path} - ${scenario}`,
      operation: { method: method.toUpperCase(), path },
      scenario,
      source: source === "illustrative" || reqSource === "illustrative" ? "illustrative" : "spec-example",
      description: res.description,
      request,
      response: { status: Number(status), headers: rh, body: rbody },
    });
  }
  return fixtures;
}

let n = 0;
for (const [path, item] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(item)) {
    if (typeof op !== "object" || !op.responses) continue;
    for (const f of build(method, path, op)) {
      writeFileSync(resolve(outDir, `${slug(method, path)}.${f.scenario}.json`), JSON.stringify(f, null, 2) + "\n");
      n++;
    }
  }
}
console.log(`wrote ${n} fixtures to fixtures/operations`);
