# stampmitra-developer-openapi

[![CI](https://github.com/Bani-Global-Industries-LLP/stampmitra-developer-openapi/actions/workflows/ci.yml/badge.svg)](https://github.com/Bani-Global-Industries-LLP/stampmitra-developer-openapi/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Contract](https://img.shields.io/badge/contract-v1.0.0-informational)
![OpenAPI](https://img.shields.io/badge/OpenAPI-3.1-6ba539)

The public **contract mirror** for the [StampMitra Developer API](https://developer.stampmitra.in/docs) (Indian identity verification and e-Stamp Paper): the OpenAPI 3.1 spec, a Postman collection, and the **shared conformance assets** every official SDK is tested against. It is a spec repo, not an SDK.

- Live reference: https://developer.stampmitra.in/docs - live spec: https://developer.stampmitra.in/openapi.json
- SDKs and install guides: https://developer.stampmitra.in/sdks
- Base URL `https://api-b2b.stampmitra.in`; auth `Authorization: Bearer sk_test_...|sk_live_...` (or `x-api-key`). `sk_test_` is sandbox, `sk_live_` production, same host.

> **The developer portal is the source of truth.** This repo mirrors what the portal publishes (a sync workflow opens a PR when it changes). If the two disagree, the portal wins. Contract version here: **1.0.0**, 31 operations, 8 webhook events.

## Layout

| Path | What |
|---|---|
| `openapi.json` | OpenAPI 3.1 contract: 31 operations, 8 webhook events (`webhooks` section), `x-error-codes`, `x-webhook-signature` |
| `postman.json` | Postman Collection v2.1, generated from `openapi.json` (byte-identical to the portal's) |
| `fixtures/operations/*.json` | Golden request/response pair per operation and documented status: `<method>-<path-slug>.<scenario>.json` with scenario `success`, `success-<2xx>` (extra documented 2xx, e.g. POST 200 + 201) or `error-<status>`. Shape: `{name, operation:{method,path}, scenario, source, description, request:{method,path,query?,headers,body?}, response:{status,headers,body}}`. `source` is `spec-example` (the spec's own example), `schema-derived` (synthesised from the schema) or `illustrative` (hand-written, only where the spec deliberately leaves the shape open, i.e. `x-shape: passthrough`). |
| `fixtures/webhooks/*.json` | One signed delivery per webhook event: `{event, secret, now, headers, rawBody, expected}` |
| `fixtures/webhook-signatures.json` | Signature vectors (valid, tampered, wrong secret, stale, edge cases). Scheme: hex `HMAC-SHA256(secret, "${timestamp}.${rawBody}")`; headers `X-Webhook-Signature`, `X-Webhook-Timestamp`, `X-Webhook-Event-Id`; tolerance 300 s; fixed clock `now` |
| `fixtures/validators.json` | Regexes and valid/invalid vectors for PAN, GSTIN, IFSC, CIN, Udyam, vehicle number, bank account, passport, driving licence, voter ID |
| `fixtures/retry-scenarios.json` | Status sequences (`[503,503,200]`) with expected attempts per method / idempotency / billed-POST rule |
| `scripts/` | `validate-spec`, `check-fixtures`, `build-fixtures`, `build-postman`, `build-webhook-vectors`, `sync-from-portal`, `mock-server`, and their tests |
| `docs/reserving-package-names.md` | Checklist for claiming the SDK package names in all 7 registries |
| `docs/registry-submission.md` | Ordered owner checklist for submitting v0.1.0 to each registry |

Operations are identified by **METHOD + path template** (`POST /v1/verify/pan`). `operationId` values exist but SDKs must not depend on them.

## How the SDKs consume it

None of this needs npm. Pin a **tag or commit**, never a moving branch.

```bash
# 1. git (recommended for CI); or add as a submodule
git clone --depth 1 --branch v1.0.0 https://github.com/Bani-Global-Industries-LLP/stampmitra-developer-openapi.git .spec-repo
# 2. release asset (each v* tag publishes openapi.json, postman.json, fixtures.tgz)
curl -sSLO https://github.com/Bani-Global-Industries-LLP/stampmitra-developer-openapi/releases/download/v1.0.0/fixtures.tgz && tar -xzf fixtures.tgz
# 3. one file at a pinned tag
curl -sSLO https://raw.githubusercontent.com/Bani-Global-Industries-LLP/stampmitra-developer-openapi/v1.0.0/openapi.json
```

Typical SDK CI wiring:

- **Coverage test**: load `openapi.json`, fail if any `METHOD + path` has no SDK method.
- **Table-driven tests**: feed `validators.json`, `webhook-signatures.json` (use its `now` as the clock) and `retry-scenarios.json` to the SDK's validators, webhook helper and retry engine. SDKs may vendor these three files; vectors are only ever **added**, never changed.
- **Mock-server tests**: run the mock and point the SDK `baseUrl` at it (see below).

### Mock server

Zero dependencies, Node >= 20. It serves `fixtures/operations/*` exactly as recorded.

```bash
node scripts/mock-server.mjs --port 4010      # or: npm run mock
curl -s -H 'Authorization: Bearer sk_test_x' -H 'Content-Type: application/json' \
  -d '{"pan":"ABCDE1234F"}' localhost:4010/v1/verify/pan
```

Pick behaviour with the `x-mock-scenario` request header:

| Value | Result |
|---|---|
| *(none)* / `success` | the success fixture |
| `success-<2xx>` | an additional documented 2xx fixture (`success-201` on POSTs that document 200 + 201) |
| `error-<status>` | the documented error fixture; a generic error body for undocumented statuses. A documented 429 has **no** `Retry-After` (the API sends none); a generic one carries `Retry-After: 1` |
| `retry-after:<secs>` | 429 with `Retry-After: <secs>` |
| `seq:<key>:503,503,200` | stateful sequence per key (last item repeats; `conn` drops the connection) |
| `delay:<ms>` | success after a delay, for timeout tests |

`GET /__mock/requests` returns what the server received (to check `Idempotency-Key` reuse across retries), `POST /__mock/reset` clears it, `GET /__mock/health` is a liveness probe. A request without `Authorization: Bearer` or `x-api-key` gets 401.

## Versioning policy

The contract follows SemVer (`info.version`, repo tags `vMAJOR.MINOR.PATCH`); the URL carries only the major (`/v1`). Additive changes (new endpoint, optional field, response field, error code, webhook event) are **minor**; description/example fixes are **patch**; anything that can break a correct client is **major** and ships as `/v2` with at least 6 months' notice. Clients must ignore unknown response fields. SDKs bump their own major when the contract does. Full policy: [CHANGELOG.md](CHANGELOG.md).

## Scripts

```bash
npm ci
npm test                      # everything below, as CI runs it
npm run validate              # openapi.json is valid OpenAPI 3.1 (meta-schema + path-param checks)
npm run check                 # every operation x documented status has a fixture, every body validates against the spec (ajv), vectors self-check
npm run test:mock             # mock server routing + scenarios
npm run test:conformance      # every fixture replayed through the mock server, byte-equal
npm run test:sync             # sync-from-portal never overwrites a newer spec with an older one
npm run sync                  # pull the contract from the portal (see below)
npm run build:postman         # postman.json from openapi.json
npm run build:fixtures        # fixtures/operations + fixtures/webhooks from openapi.json
npm run build:webhook-vectors # fixtures/webhook-signatures.json (existing vectors are never changed)
```

### Syncing from the portal

`npm run sync` fetches `https://developer.stampmitra.in/openapi.json` and regenerates `postman.json`. It **refuses** (exit 3, nothing written) when the portal's spec is older than the local one (lower `info.version`, or the same version with fewer operations/webhooks), which protects the hardened contract while the portal still serves an older one. Use `-- --force` for an intentional rollback, `-- --dry-run` to preview, `-- --from-file <openapi.json>` offline. After a sync run `npm run build:fixtures && npm run build:webhook-vectors && npm test` and add a `CHANGELOG.md` entry.

`.github/workflows/sync.yml` does this daily and opens a PR. PRs created with the default `GITHUB_TOKEN` do not trigger CI; configure the `SYNC_TOKEN` secret (PAT) or a GitHub App token as described in the workflow header. Pushing a `vX.Y.Z` tag runs `release.yml` and creates the GitHub Release with the assets above.

## Security

Fixtures contain placeholders only (`sk_test_EXAMPLEKEY...`, `whsec_test_...`); never commit real keys or personal data. Report vulnerabilities privately to security@stampmitra.in ([SECURITY.md](SECURITY.md)). See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). MIT licensed ([LICENSE](LICENSE)).
