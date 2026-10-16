# API contract changelog

This changelog tracks the **StampMitra Developer API contract** (`openapi.json`), not the scripts in this repo. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Tags `vX.Y.Z` in this repo are contract versions.

## Versioning policy

- **Contract SemVer.** The contract version is `MAJOR.MINOR.PATCH`; the URL prefix carries only the major (`/v1`). The `info.version` field in the spec is the coarse API major (`"1"`).
- **`/v1` is stable.** Within `/v1` we do not remove or rename operations, fields or enum values, tighten validation on existing inputs, or change the meaning of a field.
- **Additive = minor.** New operations, optional request fields, new response fields, new enum values in responses, new error codes. Clients must ignore unknown response fields and tolerate unknown enum values (all official SDKs do).
- **Fixes = patch.** Description/example corrections, documentation, schema fixes that bring the spec in line with real behaviour.
- **Breaking = major.** Anything that can break a correct client. Shipped as a new URL major (`/v2`) alongside `/v1`; announced at least 6 months before `/v1` retirement via the developer portal, email to account owners and this changelog.
- **Deprecation policy.** A deprecated operation/field is marked `deprecated: true` in the spec, documented here, and kept working for at least 6 months (12 months for operations used by active live keys) before removal in the next major. Deprecations are never removed in a minor/patch release.
- **Errors.** Error envelope `{error:{code,message,requestId,field?}}` and HTTP-status semantics are part of the contract. New `code` values may appear; clients must branch on HTTP status first.
- **Spec snapshots here** are mirrors of what the portal publishes; if the portal and this repo disagree, the portal wins and the daily sync PR will correct this repo.

## [Unreleased]

## [0.1.0] - 2026-10-16

### Added
- Initial mirror of the `/v1` contract (OpenAPI 3.1): 31 operations - 11 verification (`pan`, `gstin`, `rc`, `voter-id`, `driving-license`, `passport`, `cin`, `udyam`, `pan-to-gstin`, `pan-to-udyam`, `bank-account`), 16 e-Stamp/orders/payments (`services`, `estamp/*`, `orders`, `payments/intents`), 2 usage and logs (`usage/summary`, `logs`), 2 webhook events (`webhooks/events`, `webhooks/events/{id}/replay`).
- Postman collection v2.1 generated from the spec (`scripts/build-postman.mjs`).
- Conformance assets for SDKs: per-operation golden fixtures (success + every documented error status), validator vectors, webhook signature vectors, retry/idempotency scenarios, mock server.

### Notes
- This snapshot is the pre-hardening contract. Operation IDs and several schemas (e-Stamp, orders, payments, webhook events responses are `{type: object}`) are expected to change as the portal hardening pass lands; SDKs key operations by `METHOD + path`, not `operationId`. Fixtures for operations without spec examples are marked `"source": "illustrative"`.
- Webhook signature scheme (from the platform source): `X-Webhook-Signature` = hex `HMAC-SHA256(secret, "${X-Webhook-Timestamp}.${rawBody}")`, plus `X-Webhook-Event-Id`. The portal docs page does not yet state the header names.
