#!/usr/bin/env node
// Tests scripts/sync-from-portal.mjs against a local fake portal: it must refuse an older/smaller spec,
// accept a newer one, be idempotent, honour --force, and fail cleanly on HTTP errors / non-JSON.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { buildPostman } from "./build-postman.mjs";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = resolve(root, "scripts/sync-from-portal.mjs");
const current = JSON.parse(readFileSync(resolve(root, "openapi.json"), "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));

// OLD portal: a lower version with 4 operations removed (the pre-hardening 27-path shape)
const old = clone(current); old.info.version = "0.9.0";
for (const p of Object.keys(old.paths).slice(-4)) delete old.paths[p];
old.webhooks = undefined;
// SAME version, fewer operations
const sameFewer = clone(current); delete sameFewer.paths[Object.keys(sameFewer.paths).at(-1)];
// NEWER portal: minor bump with one extra operation
const newer = clone(current); newer.info.version = "1.1.0";
newer.paths["/v1/ping"] = { get: { summary: "ping", tags: [newer.tags[0].name], responses: { 200: { description: "ok" } } } };

let served = old; let mode = "json";
const server = createServer((req, res) => {
  if (mode === "500") { res.writeHead(500); return res.end("boom"); }
  if (mode === "html") { res.writeHead(200, { "content-type": "text/html" }); return res.end("<html>not json</html>"); }
  if (req.url === "/openapi.json") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(served)); }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const dir = mkdtempSync(resolve(tmpdir(), "sync-guard-"));
const fresh = () => { for (const f of ["openapi.json", "postman.json"]) copyFileSync(resolve(root, f), resolve(dir, f)); };
const run = (...a) => new Promise((res) => {
  // async spawn so the in-process fake portal can answer
  import("node:child_process").then(({ spawn }) => {
    const c = spawn(process.execPath, [script, "--base", base, "--out-dir", dir, ...a], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => res({ code, out, err }));
  });
});
const localVersion = () => JSON.parse(readFileSync(resolve(dir, "openapi.json"), "utf8")).info.version;
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log("  ok -", name); };

try {
  fresh();
  await t("older portal spec is refused (exit 3), local untouched", async () => {
    served = old; mode = "json";
    const r = await run();
    assert.equal(r.code, 3, r.err); assert.match(r.err, /older/); assert.equal(localVersion(), current.info.version);
  });
  await t("same version with fewer operations is refused", async () => {
    served = sameFewer; const r = await run(); assert.equal(r.code, 3, r.err); assert.match(r.err, /fewer operations/);
  });
  await t("--force overwrites with the older spec", async () => {
    served = old; const r = await run("--force"); assert.equal(r.code, 0, r.err); assert.equal(localVersion(), "0.9.0"); fresh();
  });
  await t("identical spec is a no-op", async () => {
    served = current; const r = await run(); assert.equal(r.code, 0, r.err); assert.match(r.out, /up to date/);
  });
  await t("--dry-run writes nothing", async () => {
    served = newer; const r = await run("--dry-run"); assert.equal(r.code, 0, r.err); assert.equal(localVersion(), current.info.version);
  });
  await t("newer spec is accepted and postman.json regenerated", async () => {
    served = newer; const r = await run(); assert.equal(r.code, 0, r.err); assert.equal(localVersion(), "1.1.0");
    assert.equal(readFileSync(resolve(dir, "postman.json"), "utf8"), JSON.stringify(buildPostman(newer), null, 2) + "\n");
  });
  await t("HTTP 500 -> exit 1, nothing changed", async () => {
    fresh(); mode = "500"; const r = await run(); assert.equal(r.code, 1); assert.equal(localVersion(), current.info.version);
  });
  await t("non-JSON -> exit 1", async () => { mode = "html"; const r = await run(); assert.equal(r.code, 1); assert.match(r.err, /sync failed/); });
  await t("non-3.1 document -> exit 1", async () => {
    mode = "json"; served = { openapi: "3.0.3", paths: {} }; const r = await run(); assert.equal(r.code, 1); assert.match(r.err, /not an OpenAPI 3\.1/);
  });
  await t("--from-file honours the same guard", async () => {
    fresh(); const f = resolve(dir, "old.json"); writeFileSync(f, JSON.stringify(old));
    const r = await run("--from-file", f); assert.equal(r.code, 3, r.err);
  });
} finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
console.log(`OK: sync guard test, ${n} checks`);
