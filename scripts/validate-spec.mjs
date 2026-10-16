#!/usr/bin/env node
// Validates openapi.json against the OpenAPI 3.1 meta-schema and applies repo-specific sanity checks.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Validator } from "@seriousme/openapi-schema-validator";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = resolve(root, process.argv[2] ?? "openapi.json");

const validator = new Validator();
const res = await validator.validate(file);
if (!res.valid) {
  console.error("FAIL: openapi.json does not match the OpenAPI schema");
  console.error(JSON.stringify(res.errors, null, 2));
  process.exit(1);
}
if (!String(validator.version).startsWith("3.1")) {
  console.error(`FAIL: expected OpenAPI 3.1.x, got ${validator.version}`);
  process.exit(1);
}

const spec = JSON.parse(readFileSync(file, "utf8"));
const problems = [];
const seen = new Set();
let ops = 0;
for (const [path, item] of Object.entries(spec.paths ?? {})) {
  for (const [method, op] of Object.entries(item)) {
    if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
    ops++;
    if (op.operationId) {
      if (seen.has(op.operationId)) problems.push(`duplicate operationId ${op.operationId}`);
      seen.add(op.operationId);
    }
    const tmpl = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    const declared = (op.parameters ?? []).filter((p) => p.in === "path").map((p) => p.name);
    for (const t of tmpl) if (!declared.includes(t)) problems.push(`${method.toUpperCase()} ${path}: path param {${t}} not declared`);
  }
}
if (problems.length) {
  console.error("FAIL:\n - " + problems.join("\n - "));
  process.exit(1);
}
console.log(`OK: OpenAPI ${validator.version} valid; ${ops} operations; ${Object.keys(spec.components?.schemas ?? {}).length} component schemas`);
