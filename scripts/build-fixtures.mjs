#!/usr/bin/env node
// Regenerates fixtures/operations/*.json (one file per operation x documented status) and
// fixtures/webhooks/*.json (one signed delivery per webhook event) from openapi.json.
//
// Every body comes from the spec, in this priority order, and the fixture's `source` says which:
//   spec-example    the `example` on the media type (or the same operation's 200 example for a "same body as 200" 201)
//   schema-derived  synthesised deterministically from the response/request JSON Schema (required + optional props,
//                   first enum value, format-aware strings). Valid by construction; checked with ajv in `npm run check`.
//   illustrative    hand-written below, used ONLY where the spec leaves a body unconstrained
//                   (`x-shape: passthrough`, i.e. the upstream owns the shape). Shape hints only.
// Fixtures are keyed by METHOD + path template (never operationId). Output is deterministic.
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const spec = JSON.parse(readFileSync(resolve(root, "openapi.json"), "utf8"));
const opsDir = resolve(root, "fixtures/operations");
const whDir = resolve(root, "fixtures/webhooks");
for (const d of [opsDir, whDir]) { rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }); }

const deref = (node) => {
  let n = node;
  const seen = new Set();
  while (n && typeof n.$ref === "string") {
    if (seen.has(n.$ref)) throw new Error(`$ref cycle ${n.$ref}`);
    seen.add(n.$ref);
    n = n.$ref.replace(/^#\//, "").split("/").reduce((x, k) => x?.[k], spec);
    if (n === undefined) throw new Error(`unresolved ${node.$ref}`);
  }
  return n;
};

// ---- deterministic schema -> instance synthesis
const OPAQUE = Symbol("opaque");
function synth(schema, name = "", depth = 0) {
  const s = deref(schema ?? {});
  if (s["x-shape"] === "passthrough") return OPAQUE;
  if (s.example !== undefined) return s.example;
  if (s.const !== undefined) return s.const;
  if (s.enum) return s.enum[0];
  if (s.default !== undefined) return s.default;
  const alt = s.oneOf ?? s.anyOf;
  if (alt) return synth(alt[0], name, depth + 1);
  if (s.allOf) return Object.assign({}, ...s.allOf.map((x) => synth(x, name, depth + 1)));
  const types = [].concat(s.type ?? (s.properties ? "object" : s.items ? "array" : []));
  const t = types.find((x) => x !== "null");
  if (!t) return OPAQUE; // untyped node: the spec says "upstream-owned shape"
  switch (t) {
    case "object": {
      const out = {};
      for (const [k, v] of Object.entries(s.properties ?? {})) {
        const val = synth(v, k, depth + 1);
        out[k] = val;
      }
      return out;
    }
    case "array": return depth > 6 ? [] : [synth(s.items ?? {}, name, depth + 1)];
    case "boolean": return true;
    case "integer": return Math.max(s.minimum ?? 1, 1);
    case "number": return Math.max(s.minimum ?? 1, 1);
    default: {
      const f = s.format;
      if (f === "date-time") return "2026-10-15T09:41:07.000Z";
      if (f === "date") return "2026-10-15";
      if (f === "uuid") return "b3f1c2a4-7d5e-4a6b-9c8d-1e2f3a4b5c6d";
      if (f === "uri" || f === "url") return "https://example.invalid/resource";
      if (f === "email") return "user@example.invalid";
      return /id$/i.test(name) ? "id_0123456789" : `${name || "value"}`.slice(0, s.maxLength ?? 64);
    }
  }
}
const hasOpaque = (v) => v === OPAQUE || (v && typeof v === "object" && Object.values(v).some(hasOpaque));

// ---- hand-written bodies, ONLY for upstream-owned (passthrough/untyped) shapes. Shape hints only.
const ILLUSTRATIVE = {
  "GET /v1/estamp/schema/{serviceCode}": { fields: [{ name: "state", type: "string", required: true }, { name: "stampValue", type: "number", required: true }] },
  "GET /v1/estamp/states": { states: [{ code: "MH", name: "Maharashtra" }, { code: "DL", name: "Delhi" }] },
  "GET /v1/estamp/states/{stateCode}/instruments": { instruments: [{ code: "rent_agreement", name: "Rent Agreement" }] },
  "GET /v1/estamp/instruments/{instrumentCode}/articles": { articles: [{ code: "ART-36", name: "Lease" }] },
  "POST /v1/estamp/duty/calculate": { amount: 500, currency: "INR" },
  "POST /v1/estamp/orders/{orderId}/parties": { partiesCount: 2 },
  "GET /v1/orders/{id}": { externalOrderId: "ord_ext_123", order: { status: "CREATED" } },
  "GET /v1/orders/{id}/status": { externalOrderId: "ord_ext_123", status: "CREATED" },
  "GET /v1/orders/{id}/payment": { externalOrderId: "ord_ext_123", payment: { status: "PENDING" } },
  "GET /v1/orders/{id}/documents": { externalOrderId: "ord_ext_123", documents: [{ id: "doc_01HZX3MA77", type: "certificate" }] },
  "GET /v1/webhooks/events": { items: [{ id: "evt_01HZX3P0C4", status: "SUCCEEDED", attempts: 1 }], nextCursor: null },
  "POST /v1/webhooks/events/{id}/replay": { id: "evt_01HZX3P0C4", status: "QUEUED" },
};

const PATH_PARAMS = { serviceCode: "estamp.instrument.rent_agreement", stateCode: "MH", instrumentCode: "rent_agreement", orderId: "ord_ext_123", id: "ord_ext_123", documentId: "doc_01HZX3MA77" };
const ID_OVERRIDE = { "GET /v1/payments/intents/{id}": "pi_01HZX3N5B8", "POST /v1/webhooks/events/{id}/replay": "evt_01HZX3P0C4" };
const IDEM_KEY = "7b1d2c58-4f1a-4c1e-9a53-0d6f7e2b9c11";
const QUERY = { "/v1/logs": { from: "2026-10-01T00:00:00.000Z", to: "2026-10-16T00:00:00.000Z", service: "pan.verify", status: "success", limit: "50" }, "/v1/webhooks/events": { limit: "20" } };

const json = (c) => c?.["application/json"];
const slug = (m, p) => `${m}-${p.replace(/[{}]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "")}`.toLowerCase();
const sorted = (o) => o; // generator key order is already deterministic

function pickBody(key, schemaNode, mediaExample, fallbackExample, illustrative) {
  if (mediaExample !== undefined) return { body: mediaExample, source: "spec-example" };
  if (fallbackExample !== undefined) return { body: fallbackExample, source: "spec-example" };
  const v = schemaNode ? synth(schemaNode) : undefined;
  if (v !== undefined && !hasOpaque(v)) return { body: v, source: "schema-derived" };
  if (illustrative !== undefined) {
    // overlay: keep schema-derived keys that are not opaque, replace opaque ones from the hand-written body
    return { body: illustrative, source: "illustrative" };
  }
  throw new Error(`no body for ${key}`);
}

function build(method, path, op) {
  const M = method.toUpperCase();
  const key = `${M} ${path}`;
  const params = (op.parameters ?? []).map(deref);
  let url = path;
  for (const p of params.filter((x) => x.in === "path")) {
    const v = (p.name === "id" && ID_OVERRIDE[key]) || p.example || PATH_PARAMS[p.name] || "example";
    url = url.replace(`{${p.name}}`, encodeURIComponent(v));
  }
  const headers = { Authorization: "Bearer sk_test_EXAMPLEKEY00000000", Accept: "application/json" };
  const reqMedia = json(op.requestBody?.content);
  let body, reqSource;
  if (op.requestBody) {
    headers["Content-Type"] = "application/json";
    ({ body, source: reqSource } = pickBody(`${key} request`, reqMedia?.schema, reqMedia?.example, undefined, undefined));
  }
  if (params.some((p) => p.in === "header" && p.name === "Idempotency-Key")) headers["Idempotency-Key"] = IDEM_KEY;

  const okExamples = Object.entries(op.responses).filter(([s]) => s.startsWith("2")).map(([, r]) => json(deref(r).content)?.example).filter((x) => x !== undefined);
  const firstOk = Object.keys(op.responses).find((s) => s.startsWith("2"));
  const fixtures = [];
  for (const [status, r] of Object.entries(op.responses)) {
    const res = deref(r);
    const isOk = status.startsWith("2");
    const media = json(res.content);
    const { body: rbody, source: rsrc } = pickBody(`${key} ${status}`, media?.schema, media?.example, isOk ? okExamples[0] : undefined, isOk ? ILLUSTRATIVE[key] : undefined);
    // First 2xx is `success`; further documented 2xx (e.g. POST 200 + 201) become `success-<status>`.
    const scenario = !isOk ? `error-${status}` : status === firstOk ? "success" : `success-${status}`;
    const request = { method: M, path: url, ...(QUERY[path] ? { query: QUERY[path] } : {}), headers, ...(body !== undefined ? { body } : {}) };
    const sources = [rsrc, reqSource].filter(Boolean);
    const source = sources.includes("illustrative") ? "illustrative" : sources.includes("schema-derived") ? "schema-derived" : "spec-example";
    fixtures.push({
      name: `${M} ${path} - ${scenario}`,
      operation: { method: M, path },
      scenario,
      source,
      description: res.description,
      request,
      response: { status: Number(status), headers: { "Content-Type": "application/json" }, body: sorted(rbody) },
    });
  }
  return fixtures;
}

const counts = { "spec-example": 0, "schema-derived": 0, illustrative: 0 };
let n = 0;
for (const [path, item] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(item)) {
    if (typeof op !== "object" || !op.responses) continue;
    for (const f of build(method, path, op)) {
      writeFileSync(resolve(opsDir, `${slug(method, path)}.${f.scenario}.json`), JSON.stringify(f, null, 2) + "\n");
      counts[f.source]++; n++;
    }
  }
}

// ---- webhook deliveries: spec example payload, signed with a fixed secret at a fixed clock
const SECRET = "whsec_test_0123456789abcdef";
const NOW = 1760605200; // 2026-10-16T09:00:00Z
let w = 0;
for (const [event, item] of Object.entries(spec.webhooks ?? {})) {
  const op = item.post;
  const media = json(op.requestBody.content);
  const payload = media.example ?? synth(media.schema);
  const rawBody = JSON.stringify(payload);
  const ts = String(NOW - 10);
  const signature = createHmac("sha256", SECRET).update(`${ts}.${rawBody}`).digest("hex");
  const fx = {
    name: `webhook ${event}`,
    event,
    operationId: op.operationId,
    source: media.example !== undefined ? "spec-example" : "schema-derived",
    secret: SECRET,
    now: NOW,
    headers: { "Content-Type": "application/json", "X-Webhook-Signature": signature, "X-Webhook-Timestamp": ts, "X-Webhook-Event-Id": `evt_${event.replace(/\W+/g, "_")}_01` },
    rawBody,
    expected: { valid: true },
  };
  writeFileSync(resolve(whDir, `${event.replace(/[^a-z0-9]+/gi, "-")}.json`), JSON.stringify(fx, null, 2) + "\n");
  w++;
}
console.log(`wrote ${n} operation fixtures (${counts["spec-example"]} spec-example, ${counts["schema-derived"]} schema-derived, ${counts.illustrative} illustrative) and ${w} webhook fixtures`);
