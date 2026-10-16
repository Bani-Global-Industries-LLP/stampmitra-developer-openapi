# API contract changelog

This changelog tracks the **StampMitra Developer API contract** (`openapi.json`), not the scripts in this repo. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Tags `vX.Y.Z` in this repo are contract versions.

## Versioning policy

- **Contract SemVer.** The contract version is `MAJOR.MINOR.PATCH`; the URL prefix carries only the major (`/v1`). The `info.version` field in the spec carries the full contract SemVer (currently `1.0.0`).
- **`/v1` is stable.** Within `/v1` we do not remove or rename operations, fields or enum values, tighten validation on existing inputs, or change the meaning of a field.
- **Additive = minor.** New operations, optional request fields, new response fields, new enum values in responses, new error codes. Clients must ignore unknown response fields and tolerate unknown enum values (all official SDKs do).
- **Fixes = patch.** Description/example corrections, documentation, schema fixes that bring the spec in line with real behaviour.
- **Breaking = major.** Anything that can break a correct client. Shipped as a new URL major (`/v2`) alongside `/v1`; announced at least 6 months before `/v1` retirement via the developer portal, email to account owners and this changelog.
- **Deprecation policy.** A deprecated operation/field is marked `deprecated: true` in the spec, documented here, and kept working for at least 6 months (12 months for operations used by active live keys) before removal in the next major. Deprecations are never removed in a minor/patch release.
- **Errors.** Error envelope `{error:{code,message,requestId,field?}}` and HTTP-status semantics are part of the contract. New `code` values may appear; clients must branch on HTTP status first.
- **Spec snapshots here** are mirrors of what the portal publishes; if the portal and this repo disagree, the portal wins and the daily sync PR will correct this repo.

## [Unreleased]

## [1.0.0] - 2026-10-16

### Changed
- Mirror replaced with the **hardened** portal contract (`info.version` 1.0.0): shared `components/responses` and `components/parameters` (`Idempotency-Key`), full response schemas, `x-error-codes`, `x-required-scope`/`x-idempotent` markers, and an 8-event `webhooks` section with `X-Webhook-Signature` / `X-Webhook-Timestamp` / `X-Webhook-Event-Id`. Verification, duty and parties POSTs now document `Idempotency-Key`.
- The API sends **no `Retry-After` on 429**; fixtures no longer carry one (the mock adds it only for undocumented/`retry-after:<n>` scenarios).
- Fixtures regenerated from the spec (197 spec examples, 15 hand-written `illustrative` bodies only where the spec leaves the shape open); POSTs documenting both 200 and 201 have `success` and `success-201`. Added `fixtures/webhooks/*` (one signed delivery per event).
- `postman.json` builder now matches the portal's (header parameters, shared responses).

### Added
- `scripts/mock-conformance-test.mjs`: replays every fixture through the mock server, byte-equal.
- `sync-from-portal` refuses to overwrite a newer spec with an older one (exit 3, `--force` to override), plus `scripts/sync-guard-test.mjs`.
- 8 webhook signature vectors built from the spec's example payloads and 2 retry scenarios (429 without Retry-After, keyed verification retry). Existing vectors are unchanged.
- `docs/reserving-package-names.md`.
- `sync.yml`: `SYNC_TOKEN` / GitHub App token option so sync PRs trigger CI.

## [0.1.0] - 2026-10-16

### Added
- Initial mirror of the `/v1` contract (OpenAPI 3.1): 31 operations - 11 verification (`pan`, `gstin`, `rc`, `voter-id`, `driving-license`, `passport`, `cin`, `udyam`, `pan-to-gstin`, `pan-to-udyam`, `bank-account`), 16 e-Stamp/orders/payments (`services`, `estamp/*`, `orders`, `payments/intents`), 2 usage and logs (`usage/summary`, `logs`), 2 webhook events (`webhooks/events`, `webhooks/events/{id}/replay`).
- Postman collection v2.1 generated from the spec (`scripts/build-postman.mjs`).
- Conformance assets for SDKs: per-operation golden fixtures (success + every documented error status), validator vectors, webhook signature vectors, retry/idempotency scenarios, mock server.

### Notes
- (Historical; superseded by 1.0.0, never tagged.) This snapshot is the pre-hardening contract. Operation IDs and several schemas (e-Stamp, orders, payments, webhook events responses are `{type: object}`) are expected to change as the portal hardening pass lands; SDKs key operations by `METHOD + path`, not `operationId`. Fixtures for operations without spec examples are marked `"source": "illustrative"`.
- Webhook signature scheme (from the platform source): `X-Webhook-Signature` = hex `HMAC-SHA256(secret, "${X-Webhook-Timestamp}.${rawBody}")`, plus `X-Webhook-Event-Id`. The portal docs page does not yet state the header names.
