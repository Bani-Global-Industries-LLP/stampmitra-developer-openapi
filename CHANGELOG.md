# API contract changelog

This changelog tracks the **StampMitra Developer API contract** (`openapi.json`), not the scripts in this repo. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Tags `vX.Y.Z` in this repo are contract versions.

## Versioning policy

- **Contract SemVer.** The contract version is `MAJOR.MINOR.PATCH`; the URL prefix carries only the major (`/v1`). The `info.version` field in the spec carries the full contract SemVer (currently `1.2.1`).
- **`/v1` is stable.** Within `/v1` we do not remove or rename operations, fields or enum values, tighten validation on existing inputs, or change the meaning of a field.
- **Additive = minor.** New operations, optional request fields, new response fields, new enum values in responses, new error codes. Clients must ignore unknown response fields and tolerate unknown enum values (all official SDKs do).
- **Fixes = patch.** Description/example corrections, documentation, schema fixes that bring the spec in line with real behaviour.
- **Breaking = major.** Anything that can break a correct client. Shipped as a new URL major (`/v2`) alongside `/v1`; announced at least 6 months before `/v1` retirement via the developer portal, email to account owners and this changelog.
- **Deprecation policy.** A deprecated operation/field is marked `deprecated: true` in the spec, documented here, and kept working for at least 6 months (12 months for operations used by active live keys) before removal in the next major. Deprecations are never removed in a minor/patch release.
- **Errors.** Error envelope `{error:{code,message,requestId,field?}}` and HTTP-status semantics are part of the contract. New `code` values may appear; clients must branch on HTTP status first.
- **Spec snapshots here** are mirrors of what the portal publishes; if the portal and this repo disagree, the portal wins and the daily sync PR will correct this repo.

## [Unreleased]

### Changed (documentation only)

- `POST /v1/estamp/duty/calculate` and the `EstampOrderQuote` schema: sandbox quotes use the same rates as live (per paper: Rs 99 procurement, Rs 5 API charge, convenience fee 5% of a paper's duty above Rs 1,000). A client's own agreed rates are not applied in sandbox.

### Changed (documentation and examples only)

- Contract version `1.2.1` (documentation only, no new fields, no shape changes). Customers keep one **Service wallet**: the balance that pays for verification calls and for the e-Stamp service charges (99 procurement + 5 API charge per paper, plus 18% GST). `GET /v1/estamp/wallet` still returns `stampDuty` and nested `serviceFee`; the value of `serviceFee` is the Service wallet balance. The `/v1/service-fee-wallet*` operations are documented as "Kept for compatibility: this is your Service wallet." `PAYMENT_REQUIRED` on order creation keeps `error.details.wallet` `STAMP_DUTY` or `SERVICE_FEE`; `SERVICE_FEE` means the Service wallet could not cover the order.
- The request examples of `POST /v1/estamp/orders` and `POST /v1/estamp/orders/validate` now send `panCardImage` on every stamp, and the `panCardImage` description says to send it with the order.
- `POST /v1/orders` (generic, legacy) says to use `POST /v1/estamp/orders` for e-Stamp; its example no longer shows an e-Stamp `details` shape.

## [1.2.0] - 2026-11-24

Mirror of the portal contract `info.version` 1.2.0: **62 operations on 61 paths** (was 31), **110 component schemas** (was 51), 8 webhook events (unchanged). Additive within `/v1`, except the documentation notes under "Changed".

### Added
- **31 operations.** All are typed (request and response schemas, spec examples, `x-required-scope`, `x-idempotent` / `x-retry-safe`).
  - e-Stamp catalogue (5): `GET /v1/estamp/states/availability`, `GET /v1/estamp/states/{stateCode}`, `GET /v1/estamp/states/{stateCode}/requirements` (query `articleCode`, `denomination`, `category`), `GET /v1/estamp/states/{stateCode}/districts`, `GET /v1/estamp/states/{stateCode}/districts/{districtCode}/sros`.
  - e-Stamp orders (7): `POST /v1/estamp/orders/validate` (dry run, not billed, no `Idempotency-Key`; 200, plus 201), `POST /v1/estamp/orders` (**requires** `Idempotency-Key`; 201), `GET /v1/estamp/orders` (query `page`, `limit`, `cursor`), `GET /v1/estamp/orders/{id}`, `POST /v1/estamp/orders/{id}/cancel`, `GET /v1/estamp/orders/{id}/export`, `GET /v1/estamp/orders/{id}/stamps`.
  - PAN card document (1): `POST /v1/estamp/orders/{orderId}/documents`, **`multipart/form-data`** (`file`: PDF, JPEG or PNG up to 10 MB; optional `type`, only `pan_card`), `Idempotency-Key` supported, 201.
  - Stamps (5): `GET /v1/estamp/stamps/{stampId}`, `POST /v1/estamp/stamps/{stampId}/cancel`, `POST /v1/estamp/stamps/{stampId}/replace`, `POST /v1/estamp/stamps/{stampId}/pan-card` (link a PAN card image by `https://` URL; **202 Accepted**, processed asynchronously), `GET /v1/estamp/stamps/{stampId}/certificate`.
  - Wallets (11, new tag `Wallets`): `GET /v1/estamp/wallet` (both wallets); Stamp Duty wallet `GET /v1/stamp-duty-wallet`, `POST /v1/stamp-duty-wallet/topup`, `GET .../transactions`, `GET .../invoices`, `GET .../invoices/{id}`; Service Fee wallet the same under `/v1/service-fee-wallet`. Top-ups return 200 or 201 and take no `Idempotency-Key` (`x-retry-safe: false`).
  - Account (2): `GET /v1/account/balance`, `GET /v1/account/usage`.
- **59 component schemas** for the above (orders, stamps, wallets, invoices, transactions, state/district/SRO catalogue, `EstampFieldIssue`, `WalletTopupRequest`, ...).
- **Stamp Duty top-up fee.** `POST /v1/stamp-duty-wallet/topup` takes `{baseAmount}` and adds a **6% processing fee plus 18% GST on that fee**; the wallet is credited `baseAmount` in full and a GST tax invoice is issued (`topupId` is the invoice id). Response `StampDutyWalletTopup`: `baseAmount`, `gstAmount`, `totalCharged` (JSON numbers) and `processingFeePercent` (`"6.00"`), `processingFeeAmount`, `creditAmount` (strings), plus `topupId`, `razorpayOrderId`, `razorpayKeyId`, and in sandbox `sandbox`, `credited`, `balance`, `currency`, `notice`. Invoices (`GET .../invoices[/{id}]`) carry `invoiceNumber`, `baseAmount`, `gstAmount`, `totalCharged`, `creditedAmount`, `gstin`, `gstinVerified`, `legalBusinessName`, `status`, `paidAt`. Show the payer the returned figures; the rate can change. The Service Fee wallet top-up (`ServiceFeeWalletTopup`) adds GST on `baseAmount` and returns every amount as a string.
- **26 error codes** in `x-error-codes` (36 in total): `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_INVALID`, `IDEMPOTENCY_KEY_REUSED` (422), `IDEMPOTENCY_IN_PROGRESS` (409), `SERVICE_UNAVAILABLE`, `FILE_TOO_LARGE`, `UNSUPPORTED_FILE_TYPE`, `FILE_CONTENT_MISMATCH`, `AMOUNT_BELOW_MINIMUM`, `AMOUNT_ABOVE_MAXIMUM`, `AMOUNT_NOT_MULTIPLE`, `SANDBOX_ESTAMP_ORDER_LIMIT` (429), and the per-field order codes `REQUIRED`, `INVALID_TYPE`, `INVALID_VALUE`, `OUT_OF_RANGE`, `TOO_LONG`, `TOO_MANY`, `UNKNOWN_FIELD`, `PARTY_MUST_BE_OBJECT`, `INVALID_UNIT`, `HTTPS_URL_REQUIRED`, `MIXED_STATE`, `STATE_INACTIVE`, `INVALID_PAN_CARD_LINK`, `PAYER_NOT_A_PARTY`. The `Error` schema gained optional `error.details` (`errors[]` of `EstampFieldIssue` on a rejected order body, `wallet` = `STAMP_DUTY` or `SERVICE_FEE` on a 402).
- Response headers documented in `components.headers`: `X-RateLimit-Limit/Remaining/Reset`, `X-Wallet-State`, `X-Wallet-Balance-Low`.
- Fixtures: golden request/response pair for every new operation and documented status (411 operation fixtures, was 212), `multipart` request fixtures (`request.multipart.parts`), 19 new retry scenarios (order create with key, validate, multipart upload, PAN card link 202, cancel/replace/top-up never retried, `Retry-After` on 503/429/409).
- Mock server: records `multipart/form-data` bodies as `{multipart:[{name, filename?, contentType?, size, value?}]}`; conformance replays multipart fixtures as real multipart requests; smoke tests for the 202 route, literal-vs-`{param}` routing (`states/availability`, `orders/validate`), the multipart upload and the wallets.

### Changed
- **`Retry-After` is now sent on every 429 and 503, and on 409 `IDEMPOTENCY_IN_PROGRESS`** (1.0.0 said the API sends none on 429). Fixtures for those responses carry `Retry-After: 1`; `scripts/check-fixtures.mjs` follows the spec's wording instead of forbidding the header. Clients still fall back to computed backoff when it is absent.
- 409 shared response now documents `IDEMPOTENCY_IN_PROGRESS` (retry the identical request after `Retry-After`); the same key with a different body is 422 `IDEMPOTENCY_KEY_REUSED`.
- Verification POSTs (`/v1/verify/*`) and `POST /v1/webhooks/events/{id}/replay` no longer document a 201 (200 only), so the 12 `success-201` fixtures of those operations are gone. Clients must keep accepting any 2xx.
- Verification results (`GstinVerificationResult`, `VoterIdVerificationResult`, `DrivingLicenseVerificationResult`, `PassportVerificationResult`, `CinVerificationResult`, `UdyamVerificationResult`, `PanToUdyamResult`) gained a `verificationId` (`^VRF-[0-9A-HJKMNP-TV-Z]{12}$`); examples refreshed. `PanToUdyamRequest` descriptions reworded.
- `postman.json`: multipart operations emit a `formdata` body (matches the portal's collection byte for byte); `scripts/build-postman.mjs` updated accordingly.
- `scripts/sync-guard-test.mjs` derives its "newer" version from the mirrored one instead of a hard-coded 1.1.0.
- `fixtures/retry-scenarios.json`: `$comment` and the note of `get-429-no-retry-after-header` reworded for the new `Retry-After` behaviour (sequences and expected attempts of existing scenarios are unchanged).

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
