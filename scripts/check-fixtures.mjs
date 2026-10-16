#!/usr/bin/env node
// Conformance-asset checks:
//  1. every spec operation (METHOD + path) has a success fixture and a fixture for each documented status
//  2. every fixture request/response body conforms to the spec schema (ajv, JSON Schema 2020-12)
//  3. fixture request paths/queries match the operation template; no orphan fixtures
//  4. validators.json vectors agree with their patterns (>=5 valid, >=8 invalid per type)
//  5. webhook-signatures.json vectors verify with Node crypto and match expected outcomes
//  6. retry-scenarios.json is well formed and consistent with the retry policy
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(resolve(root, p), "utf8"));
const spec = read("openapi.json");
const SOURCES = new Set(["spec-example", "schema-derived", "illustrative"]);
const errors = [];
const fail = (m) => errors.push(m);

// ---- 1-3 operation fixtures
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const fix = (s) => JSON.parse(JSON.stringify(s).replaceAll("#/components/schemas/", "spec#/components/schemas/"));
ajv.addSchema({ $id: "spec", components: fix({ schemas: spec.components?.schemas ?? {} }) });

const dir = resolve(root, "fixtures/operations");
const fixtures = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => ({ f, ...read(`fixtures/operations/${f}`) }));
const byOp = new Map();
for (const fx of fixtures) {
  for (const k of ["name", "request", "response"]) if (!(k in fx)) fail(`${fx.f}: missing ${k}`);
  const k = `${fx.operation?.method} ${fx.operation?.path}`;
  if (!byOp.has(k)) byOp.set(k, []);
  byOp.get(k).push(fx);
}

const deref = (node) => {
  let n = node;
  while (n && typeof n.$ref === "string") n = n.$ref.replace(/^#\//, "").split("/").reduce((x, k) => x?.[k], spec);
  return n;
};
const tmplRe = (p) => new RegExp("^" + p.replace(/\{\w+\}/g, "[^/]+") + "$");
let ops = 0, bodiesChecked = 0;
for (const [path, item] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(item)) {
    if (typeof op !== "object" || !op.responses) continue;
    ops++;
    const key = `${method.toUpperCase()} ${path}`;
    const list = byOp.get(key) ?? [];
    if (!list.some((x) => x.response.status >= 200 && x.response.status < 300)) fail(`${key}: no success fixture`);
    for (const status of Object.keys(op.responses)) {
      const fx = list.find((x) => String(x.response.status) === status);
      if (!fx) { fail(`${key}: no fixture for documented status ${status}`); continue; }
      if (!tmplRe(path).test(fx.request.path)) fail(`${fx.f}: request.path ${fx.request.path} does not match ${path}`);
      if (fx.request.method !== method.toUpperCase()) fail(`${fx.f}: method mismatch`);
      const resSchema = deref(op.responses[status]).content?.["application/json"]?.schema;
      if (resSchema) {
        const v = ajv.compile(fix(resSchema));
        bodiesChecked++;
        if (!v(fx.response.body)) fail(`${fx.f}: response body violates schema: ${ajv.errorsText(v.errors)}`);
      }
      const reqSchema = op.requestBody?.content?.["application/json"]?.schema;
      if (reqSchema) {
        const v = ajv.compile(fix(reqSchema));
        bodiesChecked++;
        if (!v(fx.request.body)) fail(`${fx.f}: request body violates schema: ${ajv.errorsText(v.errors)}`);
      } else if (fx.request.body !== undefined) fail(`${fx.f}: body present but operation has no requestBody`);
      // The hardened contract documents that the API sends NO Retry-After on 429, so fixtures must not invent one.
      if (status === "429" && fx.response.headers?.["Retry-After"]) fail(`${fx.f}: 429 fixture must not carry Retry-After (spec: the API sends none)`);
      if (!status.startsWith("2") && !fx.response.body?.error?.requestId) fail(`${fx.f}: error fixture lacks error.requestId`);
      if (!SOURCES.has(fx.source)) fail(`${fx.f}: source must be one of ${[...SOURCES].join("|")}`);
      if (fx.source === "spec-example") {
        const specEx = deref(op.responses[status]).content?.["application/json"]?.example;
        const okEx = Object.entries(op.responses).filter(([k]) => k.startsWith("2")).map(([, r]) => deref(r).content?.["application/json"]?.example).find((x) => x !== undefined);
        const want = specEx !== undefined ? specEx : status.startsWith("2") ? okEx : undefined;
        if (JSON.stringify(want) !== JSON.stringify(fx.response.body)) fail(`${fx.f}: tagged spec-example but response body differs from the spec example`);
        const reqEx = op.requestBody?.content?.["application/json"]?.example;
        if (reqEx !== undefined && JSON.stringify(reqEx) !== JSON.stringify(fx.request.body)) fail(`${fx.f}: request body differs from the spec example`);
      }
      const idemDeclared = (op.parameters ?? []).map(deref).some((p) => p.in === "header" && p.name === "Idempotency-Key");
      if (idemDeclared !== ("Idempotency-Key" in (fx.request.headers ?? {}))) fail(`${fx.f}: Idempotency-Key header presence must match the operation's declared parameter`);
    }
    for (const x of list) if (!(x.response.status in {}) && !(String(x.response.status) in op.responses)) fail(`${x.f}: status ${x.response.status} not documented`);
  }
}
const sc = new Map();
for (const fx of fixtures) { const id = `${fx.operation.method} ${fx.operation.path} ${fx.scenario}`; if (sc.has(id)) fail(`duplicate scenario ${id}`); sc.set(id, 1); }
for (const k of byOp.keys()) {
  const [m, p] = k.split(" ");
  if (!spec.paths[p]?.[m.toLowerCase()]) fail(`orphan fixtures for ${k}`);
}

// ---- 3b webhook delivery fixtures: one per spec webhook, signature verifies, body matches WebhookEvent schema
const whDir = resolve(root, "fixtures/webhooks");
const whFixtures = readdirSync(whDir).filter((f) => f.endsWith(".json")).map((f) => ({ f, ...read(`fixtures/webhooks/${f}`) }));
for (const event of Object.keys(spec.webhooks ?? {})) if (!whFixtures.some((x) => x.event === event)) fail(`no webhook fixture for ${event}`);
for (const x of whFixtures) {
  const item = spec.webhooks?.[x.event]?.post;
  if (!item) { fail(`${x.f}: unknown webhook event ${x.event}`); continue; }
  for (const h of ["X-Webhook-Signature", "X-Webhook-Timestamp", "X-Webhook-Event-Id"]) if (!x.headers?.[h]) fail(`${x.f}: missing header ${h}`);
  const sig = createHmac("sha256", x.secret).update(`${x.headers["X-Webhook-Timestamp"]}.${x.rawBody}`).digest("hex");
  if (sig !== x.headers["X-Webhook-Signature"]) fail(`${x.f}: signature does not verify`);
  if (Math.abs(x.now - Number(x.headers["X-Webhook-Timestamp"])) > 300) fail(`${x.f}: timestamp outside the 300 s tolerance`);
  const schema = item.requestBody.content["application/json"].schema;
  const v = ajv.compile(fix(schema));
  bodiesChecked++;
  if (!v(JSON.parse(x.rawBody))) fail(`${x.f}: payload violates WebhookEvent schema: ${ajv.errorsText(v.errors)}`);
}

// ---- 4 validators
const val = read("fixtures/validators.json");
let vecs = 0;
for (const [name, v] of Object.entries(val.validators)) {
  const re = new RegExp(v.pattern);
  const norm = (s) => (v.normalization === "trim only" ? s.trim() : s.trim().toUpperCase());
  if (v.valid.length < 5) fail(`validators.${name}: need >=5 valid`);
  if (v.invalid.length < 8) fail(`validators.${name}: need >=8 invalid`);
  for (const s of v.valid) { vecs++; if (!re.test(norm(s))) fail(`validators.${name}: expected valid: ${JSON.stringify(s)}`); }
  for (const s of v.invalid) { vecs++; if (re.test(norm(s))) fail(`validators.${name}: expected invalid: ${JSON.stringify(s)}`); }
}
for (const need of ["pan", "gstin", "ifsc", "cin", "udyam", "vehicleNumber", "bankAccount", "passport", "drivingLicense", "voterId"]) if (!val.validators[need]) fail(`validators: missing ${need}`);

// ---- 5 webhook signatures
const wh = read("fixtures/webhook-signatures.json");
const verify = ({ secret, timestamp, payload, signature }) => {
  if (!/^\d+$/.test(timestamp)) return { valid: false, reason: "invalid_timestamp" };
  if (Math.abs(wh.now - Number(timestamp)) > wh.toleranceSeconds) return { valid: false, reason: "timestamp_outside_tolerance" };
  const exp = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex"));
  const got = Buffer.from(signature);
  const ok = exp.length === got.length && timingSafeEqual(exp, got);
  return ok ? { valid: true } : { valid: false, reason: "signature_mismatch" };
};
const seenKinds = new Set();
for (const v of wh.vectors) {
  const r = verify(v);
  if (r.valid !== v.expected.valid || (!r.valid && r.reason !== v.expected.reason)) fail(`webhook vector ${v.name}: got ${JSON.stringify(r)} expected ${JSON.stringify(v.expected)}`);
  seenKinds.add(v.name.split("-")[0]);
}
for (const k of ["valid", "tampered", "wrong", "stale"]) if (!seenKinds.has(k)) fail(`webhook vectors missing kind ${k}`);

// ---- 6 retry scenarios
const rs = read("fixtures/retry-scenarios.json");
const RETRY = new Set([429, 502, 503, 504]);
const simulate = (s) => {
  const max = (s.maxRetries ?? rs.defaults.maxRetries) + 1;
  const retriable = s.method === "GET" || s.idempotencyKey !== false;
  let attempts = 0;
  for (const item of s.sequence) {
    attempts++;
    const st = typeof item === "object" ? item.status : item;
    const retryable = RETRY.has(st) || (st === "connection_error" && !s.billed) || (st === "timeout" && !s.billed);
    if (!retryable || !retriable || attempts >= max) break;
  }
  return attempts;
};
for (const s of rs.scenarios) {
  if (s.optional) continue;
  const a = simulate(s);
  if (a !== s.expectedAttempts) fail(`retry scenario ${s.name}: reference policy gives ${a} attempts, fixture says ${s.expectedAttempts}`);
  if (s.billed && s.method === "POST" && s.expectedAttempts !== 1) fail(`retry scenario ${s.name}: billed POST must be single attempt`);
}

if (errors.length) {
  console.error(`FAIL (${errors.length}):\n - ` + errors.join("\n - "));
  process.exit(1);
}
console.log(`OK: ${ops} operations, ${fixtures.length} operation fixtures, ${whFixtures.length} webhook fixtures, ${bodiesChecked} bodies schema-checked, ${vecs} validator vectors, ${wh.vectors.length} webhook vectors, ${rs.scenarios.length} retry scenarios`);
