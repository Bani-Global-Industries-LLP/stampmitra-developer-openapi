#!/usr/bin/env node
// Pulls the published contract from the developer portal into this repo.
//   node scripts/sync-from-portal.mjs                       # fetch https://developer.stampmitra.in/{openapi,postman}.json
//   node scripts/sync-from-portal.mjs --base https://staging.example   # other origin
//   node scripts/sync-from-portal.mjs --from-file <openapi.json> [<postman.json>]   # offline: copy local files
// Output is normalised (2-space JSON + trailing newline) so diffs only show real contract changes.
// If postman.json is not provided/fetched it is regenerated from openapi.json via build-postman.mjs.
// Exits 1 on non-JSON / non-3.1 responses so a broken portal never overwrites the mirror.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPostman } from "./build-postman.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : undefined; };
const base = (opt("--base") ?? "https://developer.stampmitra.in").replace(/\/$/, "");
const write = (name, obj) => writeFileSync(resolve(root, name), JSON.stringify(obj, null, 2) + "\n");

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "stampmitra-developer-openapi-sync" } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  try { return await res.json(); } catch { throw new Error(`${url} did not return JSON`); }
}

let openapi, postman;
const ff = args.indexOf("--from-file");
if (ff > -1) {
  const files = args.slice(ff + 1).filter((a) => !a.startsWith("--"));
  if (!files[0]) { console.error("--from-file needs <openapi.json> [<postman.json>]"); process.exit(2); }
  openapi = JSON.parse(readFileSync(resolve(files[0]), "utf8"));
  if (files[1]) postman = JSON.parse(readFileSync(resolve(files[1]), "utf8"));
} else {
  openapi = await fetchJson(`${base}/openapi.json`);
  try { postman = await fetchJson(`${base}/postman.json`); } catch (e) { console.warn(`warn: ${e.message}; regenerating postman.json from openapi.json`); }
}
if (!String(openapi?.openapi).startsWith("3.1") || !openapi.paths) { console.error("refusing to sync: not an OpenAPI 3.1 document"); process.exit(1); }
postman ??= buildPostman(openapi);
if (!postman?.item || !String(postman?.info?.schema).includes("collection/v2.1")) { console.error("refusing to sync: not a Postman v2.1 collection"); process.exit(1); }

write("openapi.json", openapi);
write("postman.json", postman);
console.log(`synced openapi.json (${Object.keys(openapi.paths).length} paths, version ${openapi.info?.version}) and postman.json`);
console.log("next: npm run build:fixtures && npm test, then update CHANGELOG.md");
