#!/usr/bin/env node
// Tiny zero-dependency mock of the StampMitra Developer API for SDK CI. Serves fixtures/operations/*.json.
//
//   node scripts/mock-server.mjs [--port 4010] [--host 127.0.0.1]
//
// Routing: METHOD + path template from each fixture. Scenario selected by request header `x-mock-scenario`:
//   (absent)|success     the operation's success fixture
//   success-<status>     an additional documented 2xx fixture, e.g. success-201 on POSTs that document 200 + 201
//   error-<status>       the operation's fixture for that status, served exactly as documented (the spec says the API
//                        sends NO Retry-After on 429); if not documented for the operation, a generic error body
//                        (a generic 429 adds Retry-After: 1 so SDKs can test header parsing)
//   retry-after:<secs>   429 with `Retry-After: <secs>` (documented 429 body when the operation has one) - for rate-limit tests
//   seq:<key>:<s1>,<s2>  stateful sequence per <key>, e.g. seq:a:503,503,200 -> 503, 503, then 200 (success fixture);
//                        the last item repeats. A 'conn' item destroys the socket without responding.
//   delay:<ms>           success fixture after <ms> (timeout tests)
// Auth: requests without `Authorization: Bearer ...` or `x-api-key` get 401 (like the real API).
// Control: GET /__mock/requests -> recorded requests (method, path, headers, body); POST /__mock/reset clears
//          recordings and sequences. GET /__mock/health -> {ok:true}.
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function loadFixtures(dir = resolve(root, "fixtures/operations")) {
  const routes = new Map(); // "METHOD template" -> { re, scenarios: Map }
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const fx = JSON.parse(readFileSync(resolve(dir, f), "utf8"));
    const k = `${fx.operation.method} ${fx.operation.path}`;
    if (!routes.has(k)) routes.set(k, { method: fx.operation.method, template: fx.operation.path, re: new RegExp("^" + fx.operation.path.replace(/\{\w+\}/g, "[^/]+") + "/?$"), scenarios: new Map() });
    routes.get(k).scenarios.set(fx.scenario, fx);
  }
  // most specific (fewest params / longest) first
  return [...routes.values()].sort((a, b) => (a.template.match(/\{/g)?.length ?? 0) - (b.template.match(/\{/g)?.length ?? 0) || b.template.length - a.template.length);
}

const GENERIC = {
  400: ["BAD_REQUEST", "Bad request"], 401: ["UNAUTHORIZED", "Missing or invalid API key."], 402: ["PAYMENT_REQUIRED", "Insufficient wallet balance"],
  403: ["FORBIDDEN", "Forbidden"], 404: ["NOT_FOUND", "The requested resource was not found."], 409: ["CONFLICT", "Conflict"],
  429: ["TOO_MANY_REQUESTS", "Rate limit exceeded"], 500: ["INTERNAL_ERROR", "Internal error"], 502: ["INTERNAL_ERROR", "Upstream unreachable"],
  503: ["SERVICE_UNAVAILABLE", "Service unavailable"], 504: ["GATEWAY_TIMEOUT", "Gateway timeout"],
};
const genericError = (status) => {
  const [code, message] = GENERIC[status] ?? ["ERROR", `HTTP ${status}`];
  return { status, headers: { "Content-Type": "application/json", ...(status === 429 ? { "Retry-After": "1" } : {}), "x-request-id": "mock-request-id" }, body: { error: { code, message, requestId: "mock-request-id" } } };
};

export function createMockServer({ routes = loadFixtures() } = {}) {
  let recorded = [];
  const seqs = new Map();
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const url = new URL(req.url, "http://mock.local");
      const method = req.method.toUpperCase();
      const send = (status, headers, body) => { res.writeHead(status, headers); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
      if (url.pathname === "/__mock/health") return send(200, { "Content-Type": "application/json" }, { ok: true });
      if (url.pathname === "/__mock/requests") return send(200, { "Content-Type": "application/json" }, recorded);
      if (url.pathname === "/__mock/reset" && method === "POST") { recorded = []; seqs.clear(); return send(200, { "Content-Type": "application/json" }, { ok: true }); }

      const raw = Buffer.concat(chunks).toString("utf8");
      let parsed = raw;
      try { parsed = raw ? JSON.parse(raw) : undefined; } catch { /* keep raw */ }
      recorded.push({ method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body: parsed });

      const route = routes.find((r) => r.method === method && r.re.test(url.pathname));
      if (!route) return send(404, { "Content-Type": "application/json" }, { error: { code: "NOT_FOUND", message: `No mock route for ${method} ${url.pathname}`, requestId: "mock-request-id" } });
      if (!req.headers.authorization && !req.headers["x-api-key"]) { const g = genericError(401); return send(g.status, g.headers, g.body); }

      const scenario = String(req.headers["x-mock-scenario"] ?? "success");
      let out;
      if (scenario.startsWith("seq:")) {
        const [, key, list] = scenario.split(":");
        const items = list.split(",");
        const i = Math.min(seqs.get(key) ?? 0, items.length - 1);
        seqs.set(key, (seqs.get(key) ?? 0) + 1);
        const item = items[i];
        if (item === "conn") { req.socket.destroy(); return; }
        const status = Number(item);
        out = status >= 200 && status < 300 ? route.scenarios.get("success") : route.scenarios.get(`error-${status}`) ?? genericError(status);
      } else if (scenario.startsWith("delay:")) {
        await new Promise((r) => setTimeout(r, Number(scenario.slice(6)) || 0));
        out = route.scenarios.get("success");
      } else if (scenario.startsWith("retry-after:")) {
        const base = route.scenarios.get("error-429") ?? genericError(429);
        const r0 = base.response ?? base;
        out = { response: { ...r0, headers: { ...r0.headers, "Retry-After": String(Number(scenario.slice(12)) || 1) } } };
      } else if (/^error-\d{3}$/.test(scenario)) {
        const st = Number(scenario.slice(6));
        out = route.scenarios.get(scenario) ?? genericError(st);
      } else {
        out = route.scenarios.get(scenario);
        if (!out) return send(501, { "Content-Type": "application/json" }, { error: { code: "MOCK_SCENARIO_NOT_FOUND", message: `No '${scenario}' fixture for ${method} ${route.template}. Available: ${[...route.scenarios.keys()].join(", ")}`, requestId: "mock-request-id" } });
      }
      const r = out.response ?? out;
      send(r.status, r.headers ?? { "Content-Type": "application/json" }, r.body);
    });
  });
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
  const port = Number(arg("--port", process.env.PORT ?? 4010));
  const host = arg("--host", "127.0.0.1");
  createMockServer().listen(port, host, () => console.log(`StampMitra mock API listening on http://${host}:${port}`));
}
