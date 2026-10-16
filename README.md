# stampmitra-developer-openapi

Public source-of-truth **mirror of the StampMitra Developer API contract** plus the **shared conformance assets** used by every official SDK (`stampmitra-developer-{node,python,php,java,go,dotnet,ruby}`).

- API reference: https://developer.stampmitra.in/docs - live spec: https://developer.stampmitra.in/openapi.json
- Base URL: `https://api-b2b.stampmitra.in` - auth: `Authorization: Bearer sk_test_...|sk_live_...` (or `x-api-key`)

> Status: 0.1.0, tracks the pre-hardening snapshot (31 operations). The portal is authoritative; a daily workflow opens a PR when it changes.

## Contents

| Path | What |
|---|---|
| `openapi.json` | OpenAPI 3.1 contract (all 31 operations) |
| `postman.json` | Postman Collection v2.1, generated from `openapi.json` |
| `CHANGELOG.md` | Contract changelog + versioning/deprecation policy |
| `fixtures/operations/*.json` | Golden request/response pairs: one per operation x (success + each documented error status). Named `<method>-<path-slug>.<scenario>.json` (`success`, `error-400`, ...). Shape: `{name, operation:{method,path}, scenario, source, request:{method,path,query?,headers,body?}, response:{status,headers,body}}`. `source` is `spec-example` or `illustrative` (the spec has no example for that body). |
| `fixtures/validators.json` | Regex + valid/invalid vectors (>=5 / >=8) for PAN, GSTIN, IFSC, CIN, Udyam, vehicle no., bank account, passport, DL, voter ID (patterns from the backend DTOs) |
| `fixtures/webhook-signatures.json` | Webhook signature vectors: valid, tampered, stale, wrong-secret, edge cases. Scheme `hex(HMAC-SHA256(secret, "${timestamp}.${rawBody}"))`, headers `X-Webhook-Signature` / `X-Webhook-Timestamp`, tolerance 300 s, fixed clock `now` |
| `fixtures/retry-scenarios.json` | Status sequences (`[503,503,200]`) with expected attempts per method / idempotency / billed-POST rules |
| `scripts/` | `validate-spec`, `check-fixtures`, `build-postman`, `build-fixtures`, `build-webhook-vectors`, `sync-from-portal`, `mock-server` |

Operations are always identified by **METHOD + path template**, never by `operationId` (IDs are still changing).

## Using it from an SDK repo

Pick one; none requires npm.

1. **Git tag (recommended for CI).**
   ```bash
   git clone --depth 1 --branch v0.1.0 https://github.com/Bani-Global-Industries-LLP/stampmitra-developer-openapi.git .contract
   # or as a submodule: git submodule add -b main <url> spec-mirror
   ```
2. **Release asset.** Each `v*` tag publishes `openapi.json`, `postman.json` and `fixtures.tgz`:
   ```bash
   curl -sSLO https://github.com/Bani-Global-Industries-LLP/stampmitra-developer-openapi/releases/download/v0.1.0/fixtures.tgz && tar -xzf fixtures.tgz
   ```
3. **Raw file** at a pinned tag/commit: `https://raw.githubusercontent.com/Bani-Global-Industries-LLP/stampmitra-developer-openapi/v0.1.0/openapi.json`.

Typical SDK CI wiring:
- **Coverage test:** load `openapi.json`, fail if any `METHOD + path` has no SDK method.
- **Mock-server tests:** run `node scripts/mock-server.mjs --port 4010` (Node >= 20, zero deps) and point the SDK `baseUrl` at `http://127.0.0.1:4010`.
- **Table-driven tests:** feed `validators.json`, `webhook-signatures.json` (use its `now` as the clock) and `retry-scenarios.json` to your validators, webhook helper and retry engine.

### Mock server

```bash
node scripts/mock-server.mjs --port 4010
curl -s -H 'Authorization: Bearer sk_test_x' -H 'Content-Type: application/json' -d '{"pan":"ABCDE1234F"}' localhost:4010/v1/verify/pan
```

Select behaviour with the `x-mock-scenario` request header:

| Value | Result |
|---|---|
| *(none)* / `success` | the success fixture |
| `error-<status>` | the documented error fixture; a generic error body for other statuses (429 includes `Retry-After`) |
| `seq:<key>:503,503,200` | stateful sequence per key (last item repeats; `conn` drops the connection) - for retry tests |
| `delay:<ms>` | success after a delay - for timeout tests |

`GET /__mock/requests` returns what the server received (check `Idempotency-Key` reuse), `POST /__mock/reset` clears it. Missing auth returns 401.

## Maintaining

```bash
npm ci
npm test                    # validate-spec + check-fixtures + mock smoke test
npm run sync                # pull openapi.json/postman.json from the portal (use -- --from-file <path> offline)
npm run build:fixtures      # regenerate fixtures/operations from openapi.json
npm run build:postman       # regenerate postman.json
```

`.github/workflows/sync.yml` runs daily and opens a PR (`peter-evans/create-pull-request`) when the portal changed. PRs created with the default `GITHUB_TOKEN` do not trigger CI; close/reopen the PR or configure a PAT/GitHub App token if you want checks to run automatically. Tagging `vX.Y.Z` runs `release.yml` and creates the GitHub Release. See `CHANGELOG.md` for the versioning policy.

## Security

Fixtures contain placeholders only; never commit real keys or data. Report vulnerabilities to security@stampmitra.in (see `SECURITY.md`). MIT licensed.
