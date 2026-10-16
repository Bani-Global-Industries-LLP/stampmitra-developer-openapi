#!/usr/bin/env node
// Pulls the published contract from the developer portal into this repo - safely.
//
//   node scripts/sync-from-portal.mjs                       # fetch https://developer.stampmitra.in/openapi.json
//   node scripts/sync-from-portal.mjs --base https://staging.example   # other origin
//   node scripts/sync-from-portal.mjs --from-file <openapi.json>       # offline: use a local file
//   --dry-run     report what would happen, write nothing
//   --force       skip the "never downgrade" guard (use only when a rollback is intended)
//   --out-dir <d> read/write openapi.json + postman.json in <d> instead of the repo root (used by the tests)
//
// Safety rules (the live portal may still serve an OLDER spec until the hardened one is deployed):
//   * the candidate must be an OpenAPI 3.1 document with paths; non-JSON / HTTP errors / timeouts exit 1 and change nothing
//   * it is compared with the local openapi.json by info.version (semver) and operation + webhook counts;
//     if it is OLDER (lower version, or the same version with fewer operations/webhooks) the sync is REFUSED
//     (exit 3, nothing written) unless --force is given
//   * postman.json is always regenerated from the accepted openapi.json with build-postman.mjs (byte-identical to the
//     portal's /postman.json for the same spec); a differing portal postman.json only produces a warning
//   * output is normalised (2-space JSON + trailing newline) so diffs show only real contract changes
// Exit codes: 0 synced or already up to date, 1 error, 2 usage, 3 refused (portal older than local).
// When run in GitHub Actions it also writes `synced=true|false` and `reason=...` to $GITHUB_OUTPUT.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPostman } from "./build-postman.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : undefined; };
const flag = (n) => args.includes(n);
const outDir = resolve(opt("--out-dir") ?? repoRoot);
const base = (opt("--base") ?? "https://developer.stampmitra.in").replace(/\/$/, "");
const force = flag("--force");
const dry = flag("--dry-run");
const norm = (obj) => JSON.stringify(obj, null, 2) + "\n";

const setOutput = (k, v) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };
const done = (code, synced, reason) => { setOutput("synced", String(synced)); setOutput("reason", reason); process.exit(code); };

export const parseVersion = (v) => {
  const m = String(v ?? "").trim().replace(/^v/, "").match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : [0, 0, 0];
};
export const cmpVersion = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; };
const METHODS = ["get", "put", "post", "delete", "patch", "options", "head", "trace"];
export const countOps = (doc) => Object.values(doc?.paths ?? {}).reduce((n, item) => n + METHODS.filter((m) => item?.[m]).length, 0);
export const countWebhooks = (doc) => Object.keys(doc?.webhooks ?? {}).length;

/** Returns null when `candidate` may replace `local`, otherwise a human-readable refusal reason. */
export function downgradeReason(local, candidate) {
  if (!local) return null;
  const lv = parseVersion(local.info?.version), cv = parseVersion(candidate.info?.version);
  const c = cmpVersion(cv, lv);
  if (c < 0) return `portal info.version ${candidate.info?.version} is older than local ${local.info?.version}`;
  if (c === 0) {
    if (countOps(candidate) < countOps(local)) return `same version ${candidate.info?.version} but portal has fewer operations (${countOps(candidate)} < ${countOps(local)})`;
    if (countWebhooks(candidate) < countWebhooks(local)) return `same version ${candidate.info?.version} but portal has fewer webhooks (${countWebhooks(candidate)} < ${countWebhooks(local)})`;
  }
  return null;
}

async function fetchJson(url) {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "stampmitra-developer-openapi-sync" }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
      try { return await res.json(); } catch { throw new Error(`${url} did not return JSON`); }
    } catch (e) { lastErr = e; if (/HTTP 4\d\d|did not return JSON/.test(e.message)) break; }
  }
  throw lastErr;
}

async function main() {
  let candidate, portalPostman;
  const ff = args.indexOf("--from-file");
  try {
    if (ff > -1) {
      const f = args[ff + 1];
      if (!f || f.startsWith("--")) { console.error("--from-file needs <openapi.json>"); return done(2, false, "usage"); }
      candidate = JSON.parse(readFileSync(resolve(f), "utf8"));
    } else {
      candidate = await fetchJson(`${base}/openapi.json`);
      try { portalPostman = await fetchJson(`${base}/postman.json`); } catch (e) { console.warn(`warn: ${e.message}; postman.json will be regenerated from openapi.json`); }
    }
  } catch (e) {
    console.error(`sync failed: ${e.message}`);
    return done(1, false, "fetch-error");
  }
  if (!String(candidate?.openapi).startsWith("3.1") || !candidate.paths || typeof candidate.paths !== "object") {
    console.error("refusing to sync: not an OpenAPI 3.1 document with paths");
    return done(1, false, "invalid-document");
  }

  const openapiPath = resolve(outDir, "openapi.json");
  const local = existsSync(openapiPath) ? JSON.parse(readFileSync(openapiPath, "utf8")) : undefined;
  const summary = (d) => `v${d?.info?.version} / ${countOps(d)} operations / ${countWebhooks(d)} webhooks`;
  console.log(`local:     ${local ? summary(local) : "(none)"}\ncandidate: ${summary(candidate)}`);

  const reason = downgradeReason(local, candidate);
  if (reason && !force) {
    console.error(`refusing to overwrite a newer local spec with an older one: ${reason}.\nThe portal probably has not deployed the hardened contract yet. Re-run with --force only for an intentional rollback.`);
    return done(3, false, "portal-older");
  }
  if (reason) console.warn(`warn: --force given, overwriting despite: ${reason}`);

  const postman = buildPostman(candidate);
  if (portalPostman && norm(portalPostman) !== norm(postman)) console.warn("warn: the portal's postman.json differs from the one generated from its openapi.json; using the generated one (CI checks this parity)");

  const changed = !local || norm(local) !== norm(candidate) || !existsSync(resolve(outDir, "postman.json")) || readFileSync(resolve(outDir, "postman.json"), "utf8") !== norm(postman);
  if (!changed) { console.log("already up to date"); return done(0, false, "up-to-date"); }
  if (dry) { console.log("dry run: would update openapi.json and postman.json"); return done(0, false, "dry-run"); }
  writeFileSync(openapiPath, norm(candidate));
  writeFileSync(resolve(outDir, "postman.json"), norm(postman));
  console.log(`synced openapi.json (${Object.keys(candidate.paths).length} paths, ${countOps(candidate)} operations, version ${candidate.info?.version}) and postman.json`);
  console.log("next: npm run build:fixtures && npm run build:webhook-vectors && npm test, then update CHANGELOG.md");
  return done(0, true, "synced");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
