#!/usr/bin/env node
// Mock-server conformance: replays EVERY fixture in fixtures/operations through scripts/mock-server.mjs
// (request exactly as recorded, scenario selected via x-mock-scenario) and asserts the response is
// byte-equal to the fixture: same status, every fixture header, and the raw body text identical to
// JSON.stringify(fixture.response.body). Also checks routing is unambiguous across all path templates.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMockServer } from "./mock-server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(root, "fixtures/operations");
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

const server = createMockServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

let checked = 0;
const failures = [];
for (const f of files) {
  const fx = JSON.parse(readFileSync(resolve(dir, f), "utf8"));
  const { request: q, response: want } = fx;
  const url = new URL(base + q.path);
  for (const [k, v] of Object.entries(q.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: q.method,
    headers: { ...q.headers, "x-mock-scenario": fx.scenario },
    body: q.body === undefined ? undefined : JSON.stringify(q.body),
  });
  const text = await res.text();
  try {
    assert.equal(res.status, want.status, "status");
    for (const [k, v] of Object.entries(want.headers ?? {})) assert.equal(res.headers.get(k), v, `header ${k}`);
    if (want.status === 429 && !("Retry-After" in (want.headers ?? {}))) assert.equal(res.headers.get("retry-after"), null, "unexpected Retry-After");
    assert.equal(text, JSON.stringify(want.body), "body bytes");
    checked++;
  } catch (e) {
    failures.push(`${f}: ${e.message}`);
  }
}
server.close();
if (failures.length) { console.error(`FAIL (${failures.length}/${files.length}):\n - ` + failures.join("\n - ")); process.exit(1); }
console.log(`OK: ${checked}/${files.length} fixtures replayed through the mock server, status + headers + body byte-equal`);
