#!/usr/bin/env node
// Generates postman.json (Postman Collection v2.1) from openapi.json.
// Mirrors src/lib/postman.ts of the StampMitra developer portal so the output matches
// https://developer.stampmitra.in/postman.json byte-for-byte (the check is `npm run check` -> postman parity).
// Usage: node scripts/build-postman.mjs [--spec openapi.json] [--out postman.json]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const METHODS = ["get", "post", "put", "patch", "delete"];

const pickExample = (content) => content?.["application/json"]?.example;

/** Resolves a `#/components/<kind>/<name>` reference (shared responses/parameters). */
function deref(doc, value) {
  const target = typeof value?.$ref === "string" ? value.$ref : undefined;
  if (!target) return value;
  const found = target.replace(/^#\//, "").split("/").reduce((node, key) => node?.[key], doc);
  return found ?? value;
}

function requestItem(doc, path, method, op) {
  const params = (op.parameters ?? []).map((p) => deref(doc, p));
  const pathVars = params.filter((p) => p.in === "path").map((p) => ({ key: p.name, value: `<${p.name}>`, description: p.description }));
  const query = params
    .filter((p) => p.in === "query")
    .map((p) => ({ key: p.name, value: "", description: p.description, disabled: !p.required }));
  const bodyExample = pickExample(op.requestBody?.content);
  // Optional header parameters (Idempotency-Key) are listed but disabled so they are one click away.
  const headerParams = params
    .filter((p) => p.in === "header")
    .map((p) => ({ key: p.name, value: "", description: p.description, disabled: !p.required }));

  const responses = Object.entries(op.responses ?? {}).map(([status, r]) => {
    const res = deref(doc, r);
    const example = pickExample(res.content);
    return {
      name: `${status} ${String(res.description ?? "").split(/[.,:(]/)[0]}`.trim(),
      originalRequest: { method: method.toUpperCase(), url: { raw: `{{baseUrl}}${path}` } },
      status: res.description ?? status,
      code: Number(status),
      _postman_previewlanguage: "json",
      header: [{ key: "Content-Type", value: "application/json" }],
      body: example === undefined ? "" : JSON.stringify(example, null, 2),
    };
  });

  const segments = path.split("/").filter(Boolean).map((s) => (s.startsWith("{") ? `:${s.slice(1, -1)}` : s));
  return {
    name: op.summary ?? `${method.toUpperCase()} ${path}`,
    request: {
      method: method.toUpperCase(),
      header: [
        ...(bodyExample === undefined ? [] : [{ key: "Content-Type", value: "application/json" }]),
        ...headerParams,
      ],
      url: {
        raw: `{{baseUrl}}/${segments.join("/")}`,
        host: ["{{baseUrl}}"],
        path: segments,
        ...(pathVars.length ? { variable: pathVars } : {}),
        ...(query.length ? { query } : {}),
      },
      ...(bodyExample === undefined
        ? {}
        : { body: { mode: "raw", raw: JSON.stringify(bodyExample, null, 2), options: { raw: { language: "json" } } } }),
      description: op.description,
    },
    response: responses,
  };
}

export function buildPostman(doc) {
  const folders = new Map();
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const tag = op.tags?.[0] ?? "Other";
      if (!folders.has(tag)) folders.set(tag, []);
      folders.get(tag).push(requestItem(doc, path, method, op));
    }
  }
  const order = doc.tags.map((t) => t.name);
  return {
    info: {
      name: "StampMitra Developer API",
      description:
        "Postman collection for the StampMitra Developer API (verification, e-Stamp, usage and logs, webhook events). Generated from the same OpenAPI document as https://developer.stampmitra.in/openapi.json. Set {{baseUrl}} and {{apiKey}} (your sk_test_... key) in the collection Variables.",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      _postman_id: "b2c7f1a4-3d5e-4a6b-9c8d-1e2f3a4b5c6d",
    },
    variable: [
      { key: "baseUrl", value: doc.servers?.[0]?.url ?? "https://api-b2b.stampmitra.in", type: "string" },
      { key: "apiKey", value: "", type: "string" },
    ],
    auth: { type: "bearer", bearer: [{ key: "token", value: "{{apiKey}}", type: "string" }] },
    item: order.filter((t) => folders.has(t)).map((name) => ({ name, item: folders.get(name) })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
  const spec = resolve(root, arg("--spec", "openapi.json"));
  const out = resolve(root, arg("--out", "postman.json"));
  const doc = JSON.parse(readFileSync(spec, "utf8"));
  writeFileSync(out, JSON.stringify(buildPostman(doc), null, 2) + "\n");
  console.log(`wrote ${out}`);
}
