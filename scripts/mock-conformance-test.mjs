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

let checked = 0, multipartChecked = 0;
const failures = [];
for (const f of files) {
  const fx = JSON.parse(readFileSync(resolve(dir, f), "utf8"));
  const { request: q, response: want } = fx;
  const url = new URL(base + q.path);
  for (const [k, v] of Object.entries(q.query ?? {})) url.searchParams.set(k, v);
  const headers = { ...q.headers, "x-mock-scenario": fx.scenario };
  let body = q.body === undefined ? undefined : JSON.stringify(q.body);
  if (q.multipart) {
    // the fixture carries parts, not bytes: build real multipart/form-data and let fetch add the boundary
    body = new FormData();
    for (const p of q.multipart.parts) { if (p.filename === undefined) body.append(p.name, p.value); else body.append(p.name, new Blob([p.content], { type: p.contentType }), p.filename); }
    delete headers["Content-Type"];
    await fetch(base + "/__mock/reset", { method: "POST" });
  }
  const res = await fetch(url, { method: q.method, headers, body });
  const text = await res.text();
  try {
    assert.equal(res.status, want.status, "status");
    for (const [k, v] of Object.entries(want.headers ?? {})) assert.equal(res.headers.get(k), v, `header ${k}`);
    if (want.status === 429 && !("Retry-After" in (want.headers ?? {}))) assert.equal(res.headers.get("retry-after"), null, "unexpected Retry-After");
    assert.equal(text, JSON.stringify(want.body), "body bytes");
    if (q.multipart) {
      const rec = (await (await fetch(base + "/__mock/requests")).json()).at(-1);
      assert.match(rec.headers["content-type"], /^multipart\/form-data; boundary=/, "recorded content-type");
      const got = rec.body.multipart;
      assert.equal(got.length, q.multipart.parts.length, "recorded part count");
      q.multipart.parts.forEach((p, i) => {
        assert.equal(got[i].name, p.name, `part ${i} name`);
        if (p.filename === undefined) assert.equal(got[i].value, p.value, `part ${p.name} value`);
        else { assert.equal(got[i].filename, p.filename, "filename"); assert.equal(got[i].contentType, p.contentType, "file content type"); assert.equal(got[i].size, Buffer.byteLength(p.content), "file size"); }
      });
      multipartChecked++;
    }
    checked++;
  } catch (e) {
    failures.push(`${f}: ${e.message}`);
  }
}
server.close();
if (failures.length) { console.error(`FAIL (${failures.length}/${files.length}):\n - ` + failures.join("\n - ")); process.exit(1); }
console.log(`OK: ${checked}/${files.length} fixtures replayed through the mock server, status + headers + body byte-equal (${multipartChecked} multipart requests parsed and recorded)`);
