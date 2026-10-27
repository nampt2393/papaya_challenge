# Partner Integration SDK — Design Spec

- **Date:** 2026-10-26
- **Source requirements:** `AI_Challenge_13.md`
- **Status:** Draft, awaiting review

## 1. Goal and context

Insurance partners (hospitals, brokers, corporates) need to submit claims, upload
documents and track claim status from their own **server-side Node.js**
applications without learning the raw claims API. We deliver:

1. A zero-runtime-dependency TypeScript SDK (`@insurance/partner-sdk`).
2. A mock HTTP API server to develop and test against.
3. Documentation (quickstart, API reference, integration guide) and 3 runnable examples.
4. A test suite (≥ 20 tests; target ~35).

**Success looks like:** a reviewer clones the repo, runs `npm install`,
`cp .env.example .env`, `npm run mock`, then `npm run example:1` and sees a
claim created within minutes, plus green `npm test` and `npm run typecheck`.

### Decisions made during brainstorming

| Topic | Decision |
|---|---|
| Runtime | Node.js only (≥ 20.6). No browser support. |
| Dependencies | SDK: zero runtime deps. Mock server: `fastify` + `@fastify/multipart`. |
| Repo layout | npm workspaces monorepo. |
| SDK internals | Layered pipeline: Resource → HttpClient → RetryPolicy / AuthManager → Transport. |
| Status changes | Manual, via mock-only control endpoint. No automatic progression. |
| Status tracking | Polling; example 3 runs until Ctrl+C. |
| API key | Stored in `.env` for development; SDK requires `apiKey` explicitly (never reads env itself). |

### Out of scope (YAGNI)

Browser/edge runtimes, webhooks/websockets, npm publishing, idempotency keys,
persistent storage, real file storage in the mock server, claim update/delete endpoints.

## 2. Repository layout

```
.
├── package.json                 # workspaces: packages/*, scripts (mock, test, examples)
├── tsconfig.base.json           # strict: true, noUncheckedIndexedAccess, exactOptionalPropertyTypes
├── eslint.config.js             # @typescript-eslint/no-explicit-any: error
├── .env.example                 # committed
├── .gitignore                   # includes .env
├── README.md                    # project overview + quickstart
├── packages/
│   ├── sdk/                     # @insurance/partner-sdk
│   │   ├── src/ …               # see §4
│   │   ├── test/ …
│   │   └── README.md            # API reference + integration guide
│   └── mock-server/             # @insurance/mock-server (private)
│       ├── src/ …               # see §5
│       └── test/ …
└── examples/
    ├── 01-simple-claim.ts
    ├── 02-claim-with-documents.ts
    ├── 03-poll-status.ts
    └── fixtures/sample-receipt.pdf
```

The mock server depends on the SDK via the workspace and imports
`validation/rules.ts` and the claim-lifecycle types, so client and server
validation rules have a single source of truth.

## 3. Domain model

### 3.1 Claim status lifecycle

```
SUBMITTED          → DOCUMENTS_VERIFIED
DOCUMENTS_VERIFIED → UNDER_ASSESSMENT
UNDER_ASSESSMENT   → PENDING_INFO | APPROVED | REJECTED
PENDING_INFO       → DOCUMENTS_VERIFIED
APPROVED           → PAYMENT_INITIATED
PAYMENT_INITIATED  → CLOSED
REJECTED           → CLOSED
```

- New claims start at `SUBMITTED`.
- `CLOSED` is the only terminal status.
- The SDK exports `ClaimStatus` (string-literal union), `CLAIM_STATUSES`,
  `CLAIM_TRANSITIONS` (`Record<ClaimStatus, readonly ClaimStatus[]>`) and
  `TERMINAL_STATUSES`.

### 3.2 Validation rules (shared, `validation/rules.ts`)

**CreateClaimInput**

| Field | Rule | Error message |
|---|---|---|
| `policyId` | required, `^POL-\d+$` | `required` / `must match POL-<digits>` |
| `claimType` | required, one of `OUTPATIENT`, `INPATIENT`, `DENTAL`, `MATERNITY`, `EMERGENCY` | `required` / `must be one of …` |
| `diagnosisCode` | required, ICD-10 `^[A-Z]\d{2}(\.\d{1,4})?$` | `required` / `must be a valid ICD-10 code` |
| `treatmentDate` | required, `YYYY-MM-DD`, real calendar date, not in the future | `required` / `must be YYYY-MM-DD` / `must not be in the future` |
| `amount` | required, finite number > 0, ≤ 2 decimal places | `required` / `must be positive` / `must have at most 2 decimals` |
| `currency` | required, one of `THB`, `USD`, `VND`, `SGD` | `required` / `must be one of …` |

**Document upload**

| Field | Rule |
|---|---|
| `type` | one of `medical_receipt`, `medical_report`, `prescription`, `id_card`, `other` |
| MIME | `application/pdf`, `image/jpeg`, `image/png` (inferred from extension when given a path/filename; overridable via `contentType`) |
| Size | ≤ 10 MB (10 485 760 bytes), checked client-side before sending |

Validators are pure functions returning
`{ ok: true } | { ok: false; fields: Record<string, string> }`. The first failing
rule per field wins (one message per field).

### 3.3 Public types (`types.ts`, abridged)

```ts
type ClaimType = 'OUTPATIENT' | 'INPATIENT' | 'DENTAL' | 'MATERNITY' | 'EMERGENCY';
type Currency = 'THB' | 'USD' | 'VND' | 'SGD';
type DocumentType = 'medical_receipt' | 'medical_report' | 'prescription' | 'id_card' | 'other';

interface CreateClaimInput {
  policyId: string; claimType: ClaimType; diagnosisCode: string;
  treatmentDate: string; amount: number; currency: Currency;
}
interface StatusHistoryEntry { status: ClaimStatus; at: string; note?: string }
interface Claim extends CreateClaimInput {
  id: string;                 // CLM-0001
  status: ClaimStatus;
  statusHistory: StatusHistoryEntry[];
  createdAt: string; updatedAt: string;   // ISO 8601
}
interface ListClaimsParams { status?: ClaimStatus; page?: number; pageSize?: number }
interface Page<T> { data: T[]; page: number; pageSize: number; total: number; totalPages: number }
interface ClaimDocument {
  id: string; claimId: string; type: DocumentType;
  filename: string; contentType: string; size: number; uploadedAt: string;
}
type UploadSource = Buffer | NodeJS.ReadableStream | string;   // string = file path
interface UploadOptions {
  type: DocumentType;
  filename?: string;          // required when source is Buffer/stream
  contentType?: string;       // inferred from filename if omitted
  size?: number;              // required when source is a stream (for progress + size check)
  onProgress?: (percent: number) => void;
}
```

## 4. SDK design (`packages/sdk/src`)

```
index.ts                  public exports only
InsuranceSDK.ts           entry point; wires components
config.ts                 options, defaults, environment → baseUrl
types.ts                  public types (§3.3)
errors.ts                 SDKError + ValidationError, AuthError, NetworkError, ApiError
validation/rules.ts       enums, regexes, limits, lifecycle (shared with mock server)
validation/validateClaim.ts
validation/validateDocument.ts
http/Transport.ts         Transport interface + NodeTransport
http/AuthManager.ts       token lifecycle
http/RetryPolicy.ts       backoff decisions (pure)
http/HttpClient.ts        composes retry + auth + transport + error mapping
resources/ClaimsResource.ts
resources/DocumentsResource.ts
resources/StatusPoller.ts
```

### 4.1 Configuration

```ts
interface InsuranceSDKOptions {
  apiKey: string;                          // required, explicit
  environment: 'sandbox' | 'production';
  baseUrl?: string;                        // overrides environment URL
  timeout?: number;                        // default 30_000 ms, per attempt
  maxRetries?: number;                     // default 3
  transport?: Transport;                   // advanced / testing
}
```

- `sandbox` → `http://localhost:4000`; `production` → `https://api.insurance.example.com`.
  All paths are prefixed with `/api/v1`.
- The SDK **never reads environment variables**. Partners pass
  `apiKey: process.env.INSURANCE_API_KEY` themselves.
- Constructor validates options synchronously and throws `ValidationError`
  (e.g. `{ apiKey: 'required' }`, `{ apiKey: 'must start with pk_' }`,
  `{ timeout: 'must be a positive integer' }`) for JS callers that bypass types.
- The API key is never logged; when referenced in error messages it is masked
  (`pk_test_****123`).

### 4.2 Transport

```ts
interface TransportRequest {
  method: 'GET' | 'POST' | 'PATCH';
  url: string;
  headers: Record<string, string>;
  body?: string | MultipartBody;
  timeoutMs: number;
  onUploadProgress?: (sentBytes: number, totalBytes: number) => void;
}
interface TransportResponse { status: number; headers: Record<string, string>; body: unknown }
interface Transport { send(req: TransportRequest): Promise<TransportResponse> }
```

`NodeTransport` uses `node:http` / `node:https`:
- JSON bodies sent with `Content-Type: application/json` and `Content-Length`.
- Multipart bodies are streamed (preamble → file stream → epilogue) with a
  precomputed `Content-Length`; each chunk written increments `sentBytes`,
  driving `onUploadProgress`.
- Socket errors, DNS failures and per-attempt timeouts reject with `NetworkError`
  (`retryable: true`). HTTP status codes are returned untouched; parsing JSON
  bodies is done here, interpreting status is not.

### 4.3 AuthManager

- `getToken()`: returns the cached JWT until its refresh point; otherwise calls
  `POST /auth/token { apiKey }` and caches
  `{ accessToken, refreshAt = now + expiresIn - margin }`, where
  `margin = min(60 s, 10% of expiresIn)`. *(Amended: a flat 60 s margin made
  every request refetch a token when `expiresIn` ≤ 60 s.)*
- Single-flight: concurrent callers during a refresh await one shared promise
  (`refreshPromise ??= fetchToken().finally(() => refreshPromise = undefined)`).
  On success all waiters receive the same new token. On failure all waiters
  reject with the same error, and the promise is cleared so the next call
  attempts a fresh refresh (failures are never cached).
- `invalidate(failedToken)`: compare-before-clear, called by HttpClient on 401.
  Clears the cache only if the cached token is still `failedToken`; if a
  concurrent caller has already stored a newer token, it does nothing. This
  guarantees that N concurrent requests rejected with the same stale token
  trigger exactly one refresh:
  ```ts
  invalidate(failedToken: string): void {
    if (this.token?.value === failedToken) this.token = undefined;
  }
  ```
- Token endpoint 401 (`INVALID_API_KEY`) → `AuthError`, never retried.
- The token request itself goes through the retry policy (503/network).
- Clock is injectable for tests.

### 4.4 RetryPolicy (pure)

- Retries: HTTP 503 and `NetworkError`. Never retries 400, 401, 403, 404, 409 or other 4xx/5xx.
- Non-idempotent requests (POST claim create, document upload) are retried after a
  `NetworkError` only when `requestSent` is false (no connection was established);
  otherwise a timeout after the server committed the claim would create a hidden
  duplicate. The token request is idempotent and always retried. (Amended after final review.)
- `delayFor(attempt) = min(baseDelay · 2^attempt, maxDelay) + jitter`,
  defaults `baseDelay = 200 ms`, `maxDelay = 5 000 ms`, jitter uniform in `[0, baseDelay)`.
- `maxRetries` default 3 (so up to 4 attempts). Sleep and random are injectable.
- Uploads from a non-replayable stream source are **not** retried, including
  the 401 re-auth retry (a file path or Buffer is replayable and is retried).
  The SDK obtains a fresh token before starting a stream upload to minimise this:
  `getToken({ forceRefresh: true })` skips the cache but joins any refresh already
  in flight, and runs before the stream is read, so a failed token request leaves
  the stream untouched.

### 4.5 HttpClient

`request<T>(opts): Promise<T>` performs:

```
for attempt in 0..maxRetries:
  token = await auth.getToken()
  res   = await transport.send(req + Authorization: Bearer token)   (NetworkError may throw)
  if res.status == 401 and not yet re-authed: auth.invalidate(token); continue   // next getToken() joins/starts single refresh
  if retryable(res/err) and attempt < maxRetries: sleep(delayFor(attempt)); continue
  map → return body as T, or throw typed error
```

A 2xx response is returned only when its body is parsed JSON (an object or array).
Otherwise it throws `ApiError { code: 'INVALID_RESPONSE', status, body }` (`body` is the raw text,
or the parsed value for a JSON scalar), never
retried. This covers a `baseUrl` that points at a website, or a proxy page answering
`200`. The token request also fails with `INVALID_RESPONSE` when `accessToken` is not a non-empty
string, so the SDK never sends `Bearer undefined`. *(Amended: a non-JSON 2xx body used to be
returned as a string typed as `T`.)*

Status → error mapping:

| Response | Error |
|---|---|
| 2xx | — (return body) |
| 400 `VALIDATION_ERROR` | `ValidationError(fields)` |
| 401 / 403 (after one re-auth) | `AuthError` |
| 503 after retries exhausted | `ApiError(status: 503, code: 'SERVICE_UNAVAILABLE')` |
| network failure after retries | `NetworkError` |
| any other non-2xx | `ApiError(status, code, message, body)` |

### 4.6 Errors (`errors.ts`)

```ts
class SDKError extends Error { code: string; requestId?: string }
class ValidationError extends SDKError { fields: Record<string, string> }   // code 'VALIDATION_ERROR'
class AuthError extends SDKError {}                                         // code 'UNAUTHORIZED' | 'TOKEN_EXPIRED' | 'INVALID_API_KEY'
class NetworkError extends SDKError { cause?: unknown; retryable: boolean } // code 'NETWORK_ERROR' | 'TIMEOUT'
class ApiError extends SDKError { status: number; body?: unknown }           // e.g. 'NOT_FOUND', 'INVALID_TRANSITION'
```

Each sets `name` and uses `Object.setPrototypeOf(this, new.target.prototype)`
so `instanceof` works in both ESM and CJS builds. `requestId` is taken from the
mock server's `x-request-id` response header.

### 4.7 Resources

**`sdk.claims`**

| Method | Behaviour |
|---|---|
| `create(input): Promise<Claim>` | `validateClaim` → throw `ValidationError` without network if invalid → `POST /claims` |
| `get(id): Promise<Claim>` | validates `id` non-empty → `GET /claims/:id` (404 → `ApiError` `NOT_FOUND`) |
| `list(params?): Promise<Page<Claim>>` | validates `page ≥ 1`, `1 ≤ pageSize ≤ 100`, `status ∈ ClaimStatus` → `GET /claims?…` |
| `onStatusChange(id, cb, opts?): Unsubscribe` | see StatusPoller |

**`sdk.documents`**

| Method | Behaviour |
|---|---|
| `upload(claimId, source, opts): Promise<ClaimDocument>` | resolve source (path → `fs.stat` + read stream; Buffer → length; stream → `opts.size`), infer content type, `validateDocument` → `POST /claims/:id/documents` multipart (`file`, `type`). Converts byte progress into integer `onProgress(percent)` calls, monotonic, deduplicated, final call is `100`. The multipart body converts each chunk to bytes (strings as UTF-8; chunks that are not `Buffer`, `Uint8Array` or string fail with `ValidationError({ file })`) and counts the bytes it sends: if they exceed the announced size, or end short of it, the upload is aborted before the closing boundary with `ValidationError({ size })`, so the server stores nothing. *(Amended: a wrong stream `size` used to hang until the timeout.)* |
| `list(claimId): Promise<ClaimDocument[]>` | `GET /claims/:id/documents` |

### 4.8 StatusPoller

```ts
onStatusChange(
  claimId: string,
  callback: (newStatus: ClaimStatus, claim: Claim) => void,
  options?: { intervalMs?: number; onError?: (error: SDKError) => void },
): () => void   // unsubscribe
```

- Default `intervalMs` 5 000 (minimum 1 000).
- First fetch records the baseline status (no callback). Each subsequent fetch
  calls `callback` only when `status` differs from the last seen value.
- Uses `setTimeout` chaining (no overlapping requests).
- Each poll goes through `HttpClient` (so transient errors are already retried);
  errors that survive retries go to `onError` and polling continues.
  `AuthError` and `ApiError` 404 stop polling after reporting to `onError`.
- Polling does **not** stop automatically, even at `CLOSED`; the caller
  unsubscribes. Timers are not `unref`'d, so they keep the process alive
  (example 3 runs until Ctrl+C); `unsubscribe()` clears the pending timer.

## 5. Mock server design (`packages/mock-server/src`)

```
server.ts          buildServer(config) → Fastify instance; main() listens on MOCK_PORT
config.ts          reads env with defaults
store.ts           in-memory Maps (claims, documents), sequential ids, reset()
auth/jwt.ts        HS256 sign/verify using node:crypto
plugins/chaos.ts   onRequest hook: delay + transient 503
plugins/authGuard.ts  preHandler for /api/v1/claims*
plugins/requestId.ts  sets x-request-id on every response
routes/auth.ts
routes/claims.ts
routes/documents.ts
routes/control.ts
lifecycle.ts       canTransition(from, to) using shared CLAIM_TRANSITIONS
```

### 5.1 Configuration (env, with defaults)

| Variable | Default | Meaning |
|---|---|---|
| `MOCK_PORT` | `4000` | listen port |
| `MOCK_API_KEYS` | `pk_test_dev_123` | comma-separated accepted keys |
| `MOCK_JWT_SECRET` | `dev-secret-change-me` | HS256 secret |
| `MOCK_JWT_TTL_SEC` | `3600` | token lifetime |
| `CHAOS` | `on` | `off` disables delay + failures |
| `MOCK_FAILURE_RATE` | `0.1` | fraction of requests returning 503 |
| `MOCK_DELAY_MIN_MS` / `MOCK_DELAY_MAX_MS` | `200` / `500` | simulated latency |
| `MOCK_SEED` | unset | seeds the PRNG for reproducible chaos |

`buildServer(config)` accepts the same settings programmatically (used by tests).

### 5.2 Endpoints

All `/api/v1` responses are JSON. Errors use `{ code, message, fields? }`.

| Method & path | Auth | Success | Errors |
|---|---|---|---|
| `POST /api/v1/auth/token` `{ apiKey }` | no | `200 { accessToken, tokenType: 'Bearer', expiresIn }` | `400` missing apiKey, `401 INVALID_API_KEY` |
| `POST /api/v1/claims` | yes | `201 Claim` (status `SUBMITTED`) | `400 VALIDATION_ERROR` |
| `GET /api/v1/claims/:id` | yes | `200 Claim` | `404 NOT_FOUND` |
| `GET /api/v1/claims?status&page&pageSize` | yes | `200 Page<Claim>` (newest first; defaults page 1, size 20, max 100) | `400 VALIDATION_ERROR` |
| `POST /api/v1/claims/:id/documents` multipart `file`, `type` | yes | `201 ClaimDocument` | `400`, `404`, `413 FILE_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE` |
| `GET /api/v1/claims/:id/documents` | yes | `200 ClaimDocument[]` | `404` |
| `PATCH /__mock/claims/:id/status` `{ status, note? }` | no | `200 Claim` (history appended) | `400`, `404`, `409 INVALID_TRANSITION` with `allowed: ClaimStatus[]` |
| `POST /__mock/reset` | no | `204` | — |

- Auth guard: missing/malformed header → `401 UNAUTHORIZED`; bad signature →
  `401 UNAUTHORIZED`; expired → `401 TOKEN_EXPIRED`.
- Chaos applies to `/api/v1/*` only; `/__mock/*` is never delayed or failed.
  503 body: `{ code: 'SERVICE_UNAVAILABLE', message }`.
- Uploaded file bytes are consumed and discarded; only metadata is stored.
- On start the server logs its URL and a sample control command:
  `curl -X PATCH localhost:4000/__mock/claims/CLM-0001/status -H 'content-type: application/json' -d '{"status":"DOCUMENTS_VERIFIED"}'`

## 6. Environment and configuration for development

`.env.example` (committed; `.env` is git-ignored):

```
# Used by examples (passed explicitly to the SDK)
INSURANCE_API_KEY=pk_test_dev_123
INSURANCE_BASE_URL=http://localhost:4000

# Mock server
MOCK_PORT=4000
MOCK_API_KEYS=pk_test_dev_123
MOCK_JWT_SECRET=dev-secret-change-me
MOCK_JWT_TTL_SEC=3600
CHAOS=on
```

Env files are loaded with Node's built-in `--env-file=.env` via `tsx` in npm
scripts (no `dotenv`). Example scripts read `process.env.INSURANCE_API_KEY` and
pass it explicitly:

```ts
const apiKey = process.env.INSURANCE_API_KEY;
if (!apiKey) { console.error('Set INSURANCE_API_KEY in .env (see .env.example)'); process.exit(1); }
const sdk = new InsuranceSDK({ apiKey, environment: 'sandbox', baseUrl: process.env.INSURANCE_BASE_URL ?? 'http://localhost:4000' });
```

## 7. Examples

Run via root scripts, e.g. `npm run example:1`.

1. **`01-simple-claim.ts [--scenario <name>]`** — `success` (default) creates a
   valid claim and fetches it. The error scenarios show how each failure is
   reported: `validation` (`ValidationError.fields`, no request sent), `auth`
   (wrong API key → `AuthError`), `not-found` (`ApiError` 404), `network`
   (closed port → `NetworkError` after retries); `all` runs every scenario. An
   error scenario exits 0 when the expected error occurs, 1 otherwise; an
   unknown scenario prints usage and exits 1. *(Amended: the flag was added
   after implementation.)*
2. **`02-claim-with-documents.ts <filePath> [documentType]`** — file path is a
   **required CLI argument** (`npm run example:2 -- ./receipt.pdf medical_receipt`).
   `documentType` defaults to `medical_receipt`. If the path is missing or does
   not exist, print usage (mentioning `examples/fixtures/sample-receipt.pdf`)
   and exit 1. Creates a claim, uploads the file with a console progress bar,
   then lists the claim's documents.
3. **`03-poll-status.ts [claimId]`** — if no id is given, creates a claim. Prints
   the `curl` command for changing its status, subscribes with
   `onStatusChange` (2 s interval) and logs every transition with timestamps.
   Runs indefinitely; on `SIGINT` (Ctrl+C) it unsubscribes, prints a summary and exits 0.

All examples demonstrate `instanceof` error handling for the four error types.

## 8. Documentation

### 8.1 Root `README.md`
Overview, prerequisites (Node ≥ 20.6), quickstart (install → `cp .env.example .env`
→ `npm run mock` → `npm run example:1`), repo layout, architecture and lifecycle
diagrams, mock-server configuration and control endpoints, scripts reference.

### 8.2 `packages/sdk/README.md`
**Part A — API reference:** constructor options, every public method
(signature, parameters, return type, errors thrown, example), exported types
and constants, error classes and their properties.

**Part B — Integration guide:**
1. *Installation and setup* — Node version, ESM/CJS import styles, TypeScript config.
2. *Managing credentials* — keep keys in env/secret manager, server-side only,
   never commit; sandbox (`pk_test_`) vs production keys; key rotation.
3. *Configuring environments* — sandbox vs production, `baseUrl`, timeouts, retries.
4. *Submitting claims* — validating early, mapping your data to `CreateClaimInput`,
   amount/currency/date formatting.
5. *Uploading documents* — path vs Buffer vs stream, size/MIME limits,
   progress reporting, which uploads are retried.
6. *Tracking status* — lifecycle diagram, choosing a poll interval, handling
   `onError`, unsubscribing (e.g. on shutdown), polling many claims.
7. *Pagination* — iterating all pages with a loop helper pattern.
8. *Error handling patterns* — a recommended `try/catch` decision tree per error
   type, what is already retried for you, surfacing `ValidationError.fields`
   to end users, logging `requestId`.
9. *Testing your integration* — running against the mock server, forcing
   status transitions, disabling/seeding chaos, injecting a custom `Transport`
   for unit tests.
10. *Go-live checklist* — production key, environment switch, timeouts, error
    monitoring, graceful shutdown of pollers.
11. *Troubleshooting / FAQ* — common errors (`INVALID_API_KEY`, `TOKEN_EXPIRED`,
    `413`, `415`, `INVALID_TRANSITION`) and their fixes.

Public API also carries TSDoc comments for IDE hover help.

## 9. Testing strategy

Vitest, run with `npm test` from the root. Target ~38 tests (requirement ≥ 20).

**SDK unit tests (fake `Transport`, injectable clock/sleep/random):**
- Validation: each claim field rule (missing, bad format), document type/MIME/size.
- Config: missing/invalid `apiKey`, environment → baseUrl.
- RetryPolicy: delay growth and cap, retryable vs non-retryable statuses.
- AuthManager: caches token; refreshes near expiry; 401 → invalidate → one
  retry → success; second 401 → `AuthError`; invalid API key → `AuthError`.
- Concurrency:
  - 3 concurrent calls with an expired cached token → exactly 1 `/auth/token` request.
  - 3 concurrent calls that all receive 401 for the same token → exactly 1 refresh;
    all 3 succeed on retry with the new token.
  - Refresh fails with `INVALID_API_KEY` → all 3 calls reject with `AuthError`;
    a subsequent call triggers a new refresh attempt.
- HttpClient: 503 → 503 → 200 succeeds; retries exhausted → `ApiError(503)`;
  network failure → retry → success; persistent network failure → `NetworkError`;
  400 → `ValidationError` with fields; 404/409 → `ApiError`.
- Resources: create/get/list success (incl. query string); client-side
  validation prevents network call; upload from path/Buffer with monotonic
  progress ending at 100; documents list.
- StatusPoller: no callback for baseline, fires once per change, `onError` on
  failure and continues, `unsubscribe` stops further polls (fake timers).

**Mock server tests (`fastify.inject`, chaos off):** auth token issue/reject,
expired token, body validation, pagination/filter, upload limits, transition
graph (valid 200, invalid 409).

**Integration test:** start `buildServer({ chaos: off })` on a random port; run
SDK end to end: create → upload → PATCH transition → `onStatusChange` observes
it. One seeded-chaos test verifies retries against the real server.

**Static checks:** `npm run typecheck` (`tsc --noEmit`, strict) and
`npm run lint` (`no-explicit-any` as error).

## 10. Toolchain

TypeScript 5 (strict), tsup (ESM + CJS + `.d.ts`) for the SDK, Vitest, tsx,
ESLint with typescript-eslint, Node ≥ 20.6, npm workspaces.
