# Partner Integration SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a zero-dependency TypeScript SDK for submitting insurance claims, uploading documents and tracking claim status, plus a Fastify mock API server, docs, 3 examples and ≥ 20 tests.

**Architecture:** npm workspaces monorepo. `packages/sdk` is a layered pipeline (Resource → HttpClient → RetryPolicy / AuthManager → Transport over `node:http`). `packages/mock-server` is a Fastify app that imports the SDK's shared validation rules and claim lifecycle, so client and server rules never diverge. Root-level integration tests run the SDK against the real mock server.

**Tech Stack:** Node ≥ 20.6, TypeScript 5 (strict), npm workspaces, Vitest, tsx, tsup, ESLint 9 + typescript-eslint, Fastify 5 + @fastify/multipart (mock server only).

**Spec:** `docs/superpowers/specs/2026-10-26-partner-integration-sdk-design.md` (read it alongside this plan; section numbers below like "spec §4.3" refer to it).

## Global Constraints

- Node `>=20.6` (`engines` in every package.json); env files loaded with `--env-file=.env`, never `dotenv`.
- `packages/sdk` has **zero runtime `dependencies`**; only `node:*` built-ins.
- Mock server runtime deps: `fastify`, `@fastify/multipart` only.
- No `any`: `@typescript-eslint/no-explicit-any: "error"`; tsconfig `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- All packages are ESM (`"type": "module"`); `moduleResolution: "Bundler"`, extensionless relative imports.
- The SDK **never reads `process.env`**. Only examples and the mock server read env.
- The API key is never logged; when shown it is masked as `pk_test_****123` (first two `_`-separated segments + `_`, then `****`, then the last 3 chars).
- Package names: `@insurance/partner-sdk`, `@insurance/mock-server` (private).
- Default base URLs: `sandbox` → `http://localhost:4000`, `production` → `https://api.insurance.example.com`; all API paths prefixed `/api/v1`.
- Retry defaults: `maxRetries = 3`, `baseDelayMs = 200`, `maxDelayMs = 5000`, jitter uniform in `[0, baseDelayMs)`. Timeout default `30000` ms per attempt.
- Token refresh margin: 60 s. Poll interval default 5000 ms, minimum 1000 ms.
- Document limit: `10_485_760` bytes; MIME `application/pdf`, `image/jpeg`, `image/png`.
- Claim ids `CLM-0001`, document ids `DOC-0001` (zero-padded to 4, sequential).

## Review Focus

Spec-implied inputs no other test pins down, most likely to bite first. Each one has a test in the task that owns it:

1. **Non-JSON or empty error body** (e.g. an HTML 502 from a proxy): the SDK must throw `ApiError(status 502, code 'HTTP_502')`, not crash in `JSON.parse`. → Task 4 + Task 6.
2. **`unsubscribe()` while a poll request is in flight** (Ctrl+C mid-request in example 3): the callback must never fire after unsubscribe, and no new timer is scheduled. → Task 9.
3. **The partner's callback throws inside `onStatusChange`:** polling continues, the thrown error goes to `onError`, and there's no unhandled rejection. → Task 9.
4. **`treatmentDate` equal to today** (local date): accepted, not "in the future". → Task 2.
5. **Upload path does not exist, or the file is empty (0 bytes):** `ValidationError` before any network call (`{ file: 'file not found' }` / `{ size: 'must be greater than 0' }`). → Task 8.

---

## File Structure

```
package.json  tsconfig.base.json  tsconfig.json  eslint.config.js  vitest.config.ts
.gitignore  .env.example  README.md
packages/sdk/
  package.json  tsconfig.json  tsup.config.ts  README.md
  src/index.ts               public exports
  src/types.ts               public domain types + ValidationResult
  src/errors.ts              SDKError, ValidationError, AuthError, NetworkError, ApiError
  src/config.ts              resolveConfig, maskApiKey, ENVIRONMENT_URLS
  src/InsuranceSDK.ts
  src/validation/rules.ts    enums, patterns, limits, lifecycle constants
  src/validation/validateClaim.ts
  src/validation/validateDocument.ts
  src/http/Transport.ts      Transport types + NodeTransport
  src/http/multipart.ts      buildMultipart
  src/http/RetryPolicy.ts
  src/http/AuthManager.ts
  src/http/mapResponseError.ts
  src/http/HttpClient.ts
  src/resources/ClaimsResource.ts
  src/resources/DocumentsResource.ts
  src/resources/uploadSource.ts
  src/resources/StatusPoller.ts
  test/helpers/fakeTransport.ts
  test/*.test.ts
packages/mock-server/
  package.json  tsconfig.json
  src/main.ts  src/server.ts  src/config.ts  src/random.ts  src/store.ts  src/lifecycle.ts
  src/auth/jwt.ts
  src/plugins/requestId.ts  src/plugins/chaos.ts  src/plugins/authGuard.ts
  src/routes/auth.ts  src/routes/claims.ts  src/routes/documents.ts  src/routes/control.ts
  test/helpers.ts  test/*.test.ts
tests/integration/sdk-e2e.test.ts
examples/01-simple-claim.ts  examples/02-claim-with-documents.ts  examples/03-poll-status.ts
examples/shared.ts  examples/fixtures/sample-receipt.pdf
```

---

### Task 1: Workspace scaffold, shared rules, types and errors

**Files:**
- Create: root `package.json`, `tsconfig.base.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Create: `packages/sdk/package.json`, `packages/sdk/tsconfig.json`, `packages/sdk/src/{index,types,errors}.ts`, `packages/sdk/src/validation/rules.ts`
- Create: `packages/mock-server/package.json`, `packages/mock-server/tsconfig.json`
- Test: `packages/sdk/test/errors.test.ts`, `packages/sdk/test/rules.test.ts`, `packages/mock-server/test/sdkImport.test.ts`

**Interfaces:**
- Produces (`rules.ts`): `CLAIM_TYPES`, `CURRENCIES`, `DOCUMENT_TYPES`, `CLAIM_STATUSES` (8 statuses in spec §3.1 order), `CLAIM_TRANSITIONS: Readonly<Record<ClaimStatus, readonly ClaimStatus[]>>`, `TERMINAL_STATUSES = ['CLOSED'] as const`, `ALLOWED_CONTENT_TYPES`, `MAX_DOCUMENT_BYTES = 10_485_760`, `MAX_PAGE_SIZE = 100`, `POLICY_ID_PATTERN = /^POL-\d+$/`, `ICD10_PATTERN = /^[A-Z]\d{2}(\.\d{1,4})?$/`, `DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/`. All arrays `as const`.
- Produces (`types.ts`): the spec §3.3 types, with unions derived from the constants (`type ClaimStatus = (typeof CLAIM_STATUSES)[number]`, etc.), plus `type ValidationResult = { ok: true } | { ok: false; fields: Record<string, string> }`.
- Produces (`errors.ts`):
  ```ts
  class SDKError extends Error { readonly code: string; readonly requestId?: string;
    constructor(message: string, options: { code: string; requestId?: string; cause?: unknown }) }
  class ValidationError extends SDKError { readonly fields: Record<string, string>;
    constructor(fields: Record<string, string>, options?: { message?: string; requestId?: string }) } // code 'VALIDATION_ERROR'; default message `Validation failed: ${Object.keys(fields).join(', ')}`
  type AuthErrorCode = 'UNAUTHORIZED' | 'TOKEN_EXPIRED' | 'INVALID_API_KEY';
  class AuthError extends SDKError { constructor(message: string, options?: { code?: AuthErrorCode; requestId?: string }) } // default 'UNAUTHORIZED'
  type NetworkErrorCode = 'NETWORK_ERROR' | 'TIMEOUT';
  class NetworkError extends SDKError { readonly retryable: boolean;
    constructor(message: string, options?: { code?: NetworkErrorCode; cause?: unknown; retryable?: boolean }) } // defaults 'NETWORK_ERROR', true
  class ApiError extends SDKError { readonly status: number; readonly body?: unknown;
    constructor(message: string, options: { status: number; code: string; body?: unknown; requestId?: string }) }
  ```
  Each sets `this.name` to its class name and calls `Object.setPrototypeOf(this, new.target.prototype)`.
- `index.ts` re-exports everything from `types`, `errors`, `validation/rules` (later tasks add more).

- [ ] **Step 1: Scaffold the workspace**

Root `package.json`: `"private": true`, `"type": "module"`, `"workspaces": ["packages/*"]`, `"engines": {"node": ">=20.6"}`, devDependencies `typescript@^5.6`, `vitest@^2.1`, `tsx@^4.19`, `tsup@^8.3`, `eslint@^9`, `typescript-eslint@^8`, `@types/node@^20`. Scripts:
```json
"test": "vitest run", "typecheck": "tsc -p tsconfig.json --noEmit", "lint": "eslint .",
"build": "npm run build -w @insurance/partner-sdk",
"mock": "tsx --env-file=.env packages/mock-server/src/main.ts",
"example:1": "tsx --env-file=.env examples/01-simple-claim.ts",
"example:2": "tsx --env-file=.env examples/02-claim-with-documents.ts",
"example:3": "tsx --env-file=.env examples/03-poll-status.ts"
```
`tsconfig.base.json`: target `ES2022`, module `ESNext`, moduleResolution `Bundler`, the strict flags from Global Constraints, `types: ["node"]`, `paths: {"@insurance/partner-sdk": ["./packages/sdk/src/index.ts"]}` with `baseUrl: "."`. Root `tsconfig.json` extends it and includes `packages/*/src`, `packages/*/test`, `tests`, `examples`. `vitest.config.ts`: `resolve.alias` for `@insurance/partner-sdk` → `packages/sdk/src/index.ts`; `test.include: ['packages/*/test/**/*.test.ts', 'tests/**/*.test.ts']`. `eslint.config.js`: typescript-eslint recommended + `no-explicit-any: 'error'`, ignore `**/dist`. `.gitignore`: `node_modules`, `dist`, `.env`. `.env.example`: exactly the block in spec §6. `packages/sdk/package.json`: name `@insurance/partner-sdk`, version `0.1.0`, no `dependencies`. `packages/mock-server/package.json`: name `@insurance/mock-server`, private, dependencies `fastify@^5.1`, `@fastify/multipart@^9.0`, `@insurance/partner-sdk: "*"`. Run `npm install`.

- [ ] **Step 2: Write the failing tests**

```ts
// packages/sdk/test/errors.test.ts
it.each([
  ['ValidationError', () => new ValidationError({ amount: 'must be positive' })],
  ['AuthError', () => new AuthError('nope', { code: 'TOKEN_EXPIRED' })],
  ['NetworkError', () => new NetworkError('down')],
  ['ApiError', () => new ApiError('gone', { status: 404, code: 'NOT_FOUND' })],
])('%s is an SDKError and Error with correct name', (name, make) => {
  const e = make(); expect(e).toBeInstanceOf(SDKError); expect(e).toBeInstanceOf(Error); expect(e.name).toBe(name);
});
it('ValidationError exposes fields and default message', () => {
  const e = new ValidationError({ policyId: 'required', amount: 'must be positive' });
  expect(e.fields).toEqual({ policyId: 'required', amount: 'must be positive' });
  expect(e.code).toBe('VALIDATION_ERROR'); expect(e.message).toBe('Validation failed: policyId, amount');
});
it('NetworkError defaults to retryable NETWORK_ERROR', ...) // retryable true, code 'NETWORK_ERROR'
it('ApiError keeps status, code, body, requestId', ...)

// packages/sdk/test/rules.test.ts
it('CLAIM_TRANSITIONS matches the lifecycle graph', () => {
  expect(CLAIM_TRANSITIONS).toEqual({
    SUBMITTED: ['DOCUMENTS_VERIFIED'], DOCUMENTS_VERIFIED: ['UNDER_ASSESSMENT'],
    UNDER_ASSESSMENT: ['PENDING_INFO', 'APPROVED', 'REJECTED'], PENDING_INFO: ['DOCUMENTS_VERIFIED'],
    APPROVED: ['PAYMENT_INITIATED'], PAYMENT_INITIATED: ['CLOSED'], REJECTED: ['CLOSED'], CLOSED: [],
  });
  expect(TERMINAL_STATUSES).toEqual(['CLOSED']);
});

// packages/mock-server/test/sdkImport.test.ts
it('resolves the SDK workspace package', () => { expect(CLAIM_STATUSES).toHaveLength(8); });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run packages/sdk/test packages/mock-server/test`
Expected: FAIL (modules not found).

- [ ] **Step 4: Implement `rules.ts`, `types.ts`, `errors.ts`, `index.ts` per Interfaces**

- [ ] **Step 5: Run tests, typecheck and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all PASS, 0 lint errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json tsconfig.json eslint.config.js vitest.config.ts .gitignore .env.example packages
git commit -m "chore: scaffold monorepo with shared rules, types and errors"
```

---

### Task 2: Claim and document validators

**Files:**
- Create: `packages/sdk/src/validation/validateClaim.ts`, `packages/sdk/src/validation/validateDocument.ts`
- Modify: `packages/sdk/src/index.ts` (export both validators and `inferContentType`)
- Test: `packages/sdk/test/validation.test.ts`

**Interfaces:**
- Consumes: Task 1 rules and `ValidationResult`.
- Produces:
  - `validateClaim(input: unknown, today?: Date): ValidationResult`. `today` defaults to `new Date()`; "not in the future" compares against `today`'s **local** calendar date as `YYYY-MM-DD`.
  - `validateDocument(input: { type: unknown; contentType: string | undefined; size: number }): ValidationResult`. Field keys are `type`, `contentType`, `size`.
  - `inferContentType(filename: string): string | undefined`: `.pdf` → `application/pdf`, `.jpg`/`.jpeg` → `image/jpeg`, `.png` → `image/png` (case-insensitive).
- Messages are exactly spec §3.2: `required`, `must match POL-<digits>`, `must be one of OUTPATIENT, INPATIENT, DENTAL, MATERNITY, EMERGENCY` (the list joined with `, `), `must be a valid ICD-10 code`, `must be YYYY-MM-DD`, `must not be in the future`, `must be positive`, `must have at most 2 decimals`. Document: `type` → `must be one of …`; `contentType` → `required` / `must be one of application/pdf, image/jpeg, image/png`; `size` → `must be greater than 0` / `must be at most 10 MB`.
- "Real calendar date": round-trip through `Date.UTC` and compare y/m/d (so `2024-02-30` fails with `must be YYYY-MM-DD`). "≤ 2 decimals": `Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-9`. For string fields, a missing, non-string or empty value is `required`. For `amount`, `undefined`/`null` is `required`, and any other non-finite-number value (e.g. `'100'`, `NaN`) is `must be positive`.

- [ ] **Step 1: Write the failing tests**

```ts
const valid = { policyId: 'POL-123', claimType: 'OUTPATIENT', diagnosisCode: 'J06.9',
  treatmentDate: '2024-03-15', amount: 15000, currency: 'THB' };
const today = new Date(2024, 5, 10); // local 2024-06-10

it('accepts a valid claim', () => expect(validateClaim(valid, today)).toEqual({ ok: true }));
it('reports every missing field as required', () =>
  expect(validateClaim({}, today)).toEqual({ ok: false, fields: { policyId: 'required', claimType: 'required',
    diagnosisCode: 'required', treatmentDate: 'required', amount: 'required', currency: 'required' } }));
it.each([
  ['policyId', 'ABC-1', 'must match POL-<digits>'],
  ['claimType', 'SPA', 'must be one of OUTPATIENT, INPATIENT, DENTAL, MATERNITY, EMERGENCY'],
  ['diagnosisCode', 'j06.9', 'must be a valid ICD-10 code'],
  ['treatmentDate', '15/03/2024', 'must be YYYY-MM-DD'],
  ['treatmentDate', '2024-02-30', 'must be YYYY-MM-DD'],
  ['treatmentDate', '2024-06-11', 'must not be in the future'],
  ['amount', -5, 'must be positive'], ['amount', 0, 'must be positive'],
  ['amount', 10.005, 'must have at most 2 decimals'], ['amount', Number.NaN, 'must be positive'],
  ['currency', 'EUR', 'must be one of THB, USD, VND, SGD'],
])('%s=%s → %s', (field, value, message) =>
  expect(validateClaim({ ...valid, [field]: value }, today)).toEqual({ ok: false, fields: { [field]: message } }));
it('accepts treatmentDate equal to today (local date)', () =>          // Review Focus #4
  expect(validateClaim({ ...valid, treatmentDate: '2024-06-10' }, today)).toEqual({ ok: true }));
it('accepts amount with 2 decimals', () => expect(validateClaim({ ...valid, amount: 150.25 }, today).ok).toBe(true));
it('accepts a valid document', () =>
  expect(validateDocument({ type: 'medical_receipt', contentType: 'application/pdf', size: 1 })).toEqual({ ok: true }));
it('rejects bad type, MIME, oversize and empty files', () => {
  expect(validateDocument({ type: 'selfie', contentType: 'text/plain', size: 10_485_761 })).toEqual({ ok: false,
    fields: { type: 'must be one of medical_receipt, medical_report, prescription, id_card, other',
      contentType: 'must be one of application/pdf, image/jpeg, image/png', size: 'must be at most 10 MB' } });
  expect(validateDocument({ type: 'other', contentType: 'image/png', size: 0 }))
    .toEqual({ ok: false, fields: { size: 'must be greater than 0' } });
});
it('infers content type from extension', () => {
  expect(inferContentType('a.PDF')).toBe('application/pdf'); expect(inferContentType('b.jpeg')).toBe('image/jpeg');
  expect(inferContentType('c.txt')).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run packages/sdk/test/validation.test.ts` → FAIL (not defined).
- [ ] **Step 3: Implement the validators per Interfaces**
- [ ] **Step 4: Run to verify pass** — same command → PASS; `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** — `git add packages/sdk && git commit -m "feat(sdk): add claim and document validators"`.

---

### Task 3: RetryPolicy

**Files:**
- Create: `packages/sdk/src/http/RetryPolicy.ts`
- Test: `packages/sdk/test/RetryPolicy.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface RetryPolicyOptions { maxRetries?: number; baseDelayMs?: number; maxDelayMs?: number; random?: () => number }
  class RetryPolicy {
    constructor(options?: RetryPolicyOptions)
    readonly maxRetries: number
    /** failure: an HTTP status, or a thrown error. attempt is 0-based (0 = first attempt just failed). */
    shouldRetry(failure: number | unknown, attempt: number): boolean
    delayFor(attempt: number): number   // min(base * 2^attempt, max) + floor(random() * base)
  }
  ```
  Retryable: status `503`, or `failure instanceof NetworkError && failure.retryable`. Returns `false` when `attempt >= maxRetries`.

- [ ] **Step 1: Write the failing tests**

```ts
const p = new RetryPolicy({ random: () => 0 });
it('backs off exponentially and caps at maxDelayMs', () =>
  expect([0, 1, 2, 3, 4, 5].map((a) => p.delayFor(a))).toEqual([200, 400, 800, 1600, 3200, 5000]));
it('adds jitter below baseDelayMs', () => expect(new RetryPolicy({ random: () => 0.999 }).delayFor(0)).toBe(399));
it('retries 503 and retryable NetworkError', () => {
  expect(p.shouldRetry(503, 0)).toBe(true); expect(p.shouldRetry(new NetworkError('x'), 0)).toBe(true);
  expect(p.shouldRetry(new NetworkError('x', { retryable: false }), 0)).toBe(false);
});
it.each([400, 401, 403, 404, 409, 500, 502])('never retries %i', (s) => expect(p.shouldRetry(s, 0)).toBe(false));
it('stops after maxRetries', () => { expect(p.shouldRetry(503, 2)).toBe(true); expect(p.shouldRetry(503, 3)).toBe(false); });
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run packages/sdk/test/RetryPolicy.test.ts` → FAIL.
- [ ] **Step 3: Implement `RetryPolicy`**
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git add packages && git commit -m "feat(sdk): add retry policy with exponential backoff"`.

---

### Task 4: Transport and multipart body

**Files:**
- Create: `packages/sdk/src/http/Transport.ts`, `packages/sdk/src/http/multipart.ts`
- Test: `packages/sdk/test/NodeTransport.test.ts` (uses a real `node:http` server on port 0 in `beforeAll`)

**Interfaces:**
- Produces (`Transport.ts`):
  ```ts
  type HttpMethod = 'GET' | 'POST' | 'PATCH';
  interface TransportRequest { method: HttpMethod; url: string; headers: Record<string, string>;
    body?: string | MultipartBody; timeoutMs: number;
    onUploadProgress?: (sentBytes: number, totalBytes: number) => void }
  interface TransportResponse { status: number; headers: Record<string, string>; body: unknown }
  interface Transport { send(req: TransportRequest): Promise<TransportResponse> }
  class NodeTransport implements Transport
  ```
  `NodeTransport.send` picks `http`/`https` by URL scheme. A string body gets `content-length` set. A multipart body gets `content-type: multipart/form-data; boundary=<b>` and `content-length: <contentLength>`, and is piped from `createStream()`, with `onUploadProgress(sent, total)` called per chunk. Response headers are lowercased, with array values joined by `, `. Body: if `content-type` contains `json` and the text parses, the parsed value; else if the text is non-empty, the raw string; else `undefined` (never throws on bad JSON). Errors: socket/DNS errors → `NetworkError('Network request failed: <msg>', { code: 'NETWORK_ERROR', cause })`. No response within `timeoutMs` (a timer covering the whole exchange, which destroys the request) → `NetworkError('Request timed out after <n>ms', { code: 'TIMEOUT' })`. HTTP statuses always resolve.
- Produces (`multipart.ts`):
  ```ts
  interface MultipartBody { kind: 'multipart'; boundary: string; contentLength: number; replayable: boolean; createStream(): Readable }
  interface MultipartFile { fieldName: string; filename: string; contentType: string; size: number; open(): Readable }
  function buildMultipart(fields: Record<string, string>, file: MultipartFile, replayable: boolean): MultipartBody
  ```
  Boundary `----insurance-sdk-<16 random hex>`. Text fields come first, then the file part. `contentLength` = byte length of the preamble + `file.size` + the epilogue (`\r\n--<b>--\r\n`).

- [ ] **Step 1: Write the failing tests** (test server routes: `/json` echoes method, headers and body as JSON with status 201; `/html` returns 502 `text/html` `<h1>Bad Gateway</h1>`; `/empty` returns 500 with no body; `/hang` never responds; `/upload` collects the raw body and returns `{ length, contentType, raw }`)

```ts
it('sends JSON and parses JSON responses', async () => {
  const res = await t.send({ method: 'POST', url: `${base}/json`, headers: { 'content-type': 'application/json' }, body: '{"a":1}', timeoutMs: 1000 });
  expect(res.status).toBe(201); expect(res.body).toMatchObject({ method: 'POST', body: '{"a":1}' });
});
it('returns non-JSON bodies as raw strings without throwing', async () => { // Review Focus #1
  const res = await t.send({ method: 'GET', url: `${base}/html`, headers: {}, timeoutMs: 1000 });
  expect(res).toMatchObject({ status: 502, body: '<h1>Bad Gateway</h1>' });
});
it('returns undefined body for empty responses', ...)            // status 500, body undefined
it('maps connection refused to retryable NetworkError', async () => {
  await expect(t.send({ method: 'GET', url: 'http://127.0.0.1:1', headers: {}, timeoutMs: 1000 }))
    .rejects.toMatchObject({ name: 'NetworkError', code: 'NETWORK_ERROR', retryable: true });
});
it('times out with NetworkError TIMEOUT', async () => {
  await expect(t.send({ method: 'GET', url: `${base}/hang`, headers: {}, timeoutMs: 100 }))
    .rejects.toMatchObject({ code: 'TIMEOUT' });
});
it('streams multipart with exact content-length and progress ending at total', async () => {
  const data = Buffer.alloc(200_000, 7);
  const body = buildMultipart({ type: 'medical_receipt' },
    { fieldName: 'file', filename: 'r.pdf', contentType: 'application/pdf', size: data.length, open: () => Readable.from([data]) }, true);
  const progress: number[] = [];
  const res = await t.send({ method: 'POST', url: `${base}/upload`, headers: {}, body, timeoutMs: 2000,
    onUploadProgress: (sent, total) => { expect(total).toBe(body.contentLength); progress.push(sent); } });
  expect(res.body).toMatchObject({ length: body.contentLength });
  expect((res.body as { raw: string }).raw).toContain('name="type"\r\n\r\nmedical_receipt');
  expect(progress.at(-1)).toBe(body.contentLength);
  expect(progress).toEqual([...progress].sort((a, b) => a - b));
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run packages/sdk/test/NodeTransport.test.ts` → FAIL.
- [ ] **Step 3: Implement `buildMultipart` and `NodeTransport` per Interfaces**
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git add packages && git commit -m "feat(sdk): add node:http transport with streaming multipart progress"`.

---

### Task 5: AuthManager (single-flight refresh)

**Files:**
- Create: `packages/sdk/src/http/AuthManager.ts`
- Test: `packages/sdk/test/AuthManager.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface TokenResponse { accessToken: string; expiresIn: number }   // expiresIn in seconds
  class AuthManager {
    constructor(options: { fetchToken: () => Promise<TokenResponse>; now?: () => number })
    getToken(): Promise<string>
    invalidate(failedToken: string): void
  }
  ```
  Implements spec §4.3 exactly: a token is reused while `expiresAt - 60_000 > now()`. The refresh is single-flight with `refreshPromise ??= fetchToken().then(store).finally(clear)`. Failures are not cached. `invalidate` compares before clearing. `AuthManager` does no HTTP of its own; `HttpClient` (Task 6) supplies `fetchToken`.

- [ ] **Step 1: Write the failing tests** (`fetchToken` is a `vi.fn` returning `tok-1`, `tok-2`, … each with `expiresIn: 3600`; `now` is a mutable variable)

```ts
it('caches the token until 60s before expiry', async () => {
  expect(await auth.getToken()).toBe('tok-1'); now += 3_539_000; expect(await auth.getToken()).toBe('tok-1');
  now += 2_000; expect(await auth.getToken()).toBe('tok-2'); expect(fetchToken).toHaveBeenCalledTimes(2);
});
it('3 concurrent calls with an expired token trigger exactly 1 refresh', async () => {
  const tokens = await Promise.all([auth.getToken(), auth.getToken(), auth.getToken()]);
  expect(tokens).toEqual(['tok-1', 'tok-1', 'tok-1']); expect(fetchToken).toHaveBeenCalledTimes(1);
});
it('3 concurrent invalidations of the same stale token trigger exactly 1 refresh', async () => {
  const stale = await auth.getToken();
  const retried = await Promise.all([0, 1, 2].map(async () => { auth.invalidate(stale); return auth.getToken(); }));
  expect(retried).toEqual(['tok-2', 'tok-2', 'tok-2']); expect(fetchToken).toHaveBeenCalledTimes(2);
});
it('invalidate is a no-op when a newer token is already cached', async () => {
  const t1 = await auth.getToken(); auth.invalidate(t1); const t2 = await auth.getToken();
  auth.invalidate(t1); expect(await auth.getToken()).toBe(t2); expect(fetchToken).toHaveBeenCalledTimes(2);
});
it('a failed refresh rejects all waiters and is not cached', async () => {
  fetchToken.mockRejectedValueOnce(new AuthError('bad key', { code: 'INVALID_API_KEY' }));
  const results = await Promise.allSettled([auth.getToken(), auth.getToken(), auth.getToken()]);
  expect(results.every((r) => r.status === 'rejected' && r.reason instanceof AuthError)).toBe(true);
  expect(fetchToken).toHaveBeenCalledTimes(1);
  expect(await auth.getToken()).toBe('tok-1'); expect(fetchToken).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run packages/sdk/test/AuthManager.test.ts` → FAIL.
- [ ] **Step 3: Implement `AuthManager`**
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git add packages && git commit -m "feat(sdk): add auth manager with single-flight token refresh"`.

---

### Task 6: HttpClient and response-error mapping

**Files:**
- Create: `packages/sdk/src/http/mapResponseError.ts`, `packages/sdk/src/http/HttpClient.ts`
- Create: `packages/sdk/test/helpers/fakeTransport.ts`
- Test: `packages/sdk/test/HttpClient.test.ts`

**Interfaces:**
- Consumes: `Transport`, `MultipartBody` (Task 4), `RetryPolicy` (Task 3), `AuthManager`, `TokenResponse` (Task 5), errors (Task 1).
- Produces:
  ```ts
  function mapResponseError(res: TransportResponse): SDKError
  interface RequestOptions {
    method: HttpMethod; path: string;                          // path relative to /api/v1, e.g. '/claims'
    query?: Record<string, string | number | undefined>;       // undefined values are omitted
    json?: unknown; multipart?: MultipartBody;
    onUploadProgress?: (sentBytes: number, totalBytes: number) => void;
    auth?: boolean;                                            // default true
  }
  interface HttpClientOptions { baseUrl: string; apiKey: string; timeoutMs: number; transport: Transport;
    retry: RetryPolicy; sleep?: (ms: number) => Promise<void>; now?: () => number }
  class HttpClient { constructor(options: HttpClientOptions); request<T>(options: RequestOptions): Promise<T> }
  ```
  - `HttpClient` owns an `AuthManager` whose `fetchToken` is `this.request<TokenResponse>({ method: 'POST', path: '/auth/token', json: { apiKey }, auth: false })`.
  - URL: `${baseUrl}/api/v1${path}` + query built with `URLSearchParams`. Headers: `accept: application/json`; for JSON, `content-type: application/json`; for auth requests, `authorization: Bearer <token>`.
  - Loop (spec §4.5): a 401 on an authed request, the first time for this request, calls `auth.invalidate(sentToken)` and retries **without consuming a retry attempt**. If `multipart.replayable === false`, neither the 401 re-auth nor the 503/network retry happens. Otherwise `retry.shouldRetry(statusOrError, attempt)` → `await sleep(retry.delayFor(attempt))`.
  - `mapResponseError`: `requestId` = `res.headers['x-request-id']`. If the body is an object with a string `code`/`message`, use them; otherwise `code = 'HTTP_<status>'` and `message = 'Request failed with status <status>'`. 400 → `ValidationError(body.fields ?? {}, { message, requestId })`. 401/403 → `AuthError` with `code` if it's an `AuthErrorCode`, else `'UNAUTHORIZED'`. Anything else → `ApiError({ status, code, body, requestId })`.
- Produces (`test/helpers/fakeTransport.ts`):
  ```ts
  type FakeReply = TransportResponse | Error;
  function fakeTransport(handler: (req: TransportRequest, callIndex: number) => FakeReply | Promise<FakeReply>):
    Transport & { calls: TransportRequest[] }
  function json(status: number, body?: unknown, headers?: Record<string, string>): TransportResponse
  function withTokenEndpoint(handler: (req: TransportRequest, apiCallIndex: number) => FakeReply | Promise<FakeReply>):
    (req: TransportRequest) => Promise<FakeReply>   // answers POST …/auth/token with tok-N, forwards everything else
  ```

- [ ] **Step 1: Write the failing tests** (`client` is built with `sleep: async () => {}`, a real `RetryPolicy({ random: () => 0 })` and a fake transport)

```ts
it('fetches a token once and sends it as Bearer', ...)  // two requests → 1 token call; authorization 'Bearer tok-1'
it('builds URL with query and skips undefined params', ...) // url === 'http://api.test/api/v1/claims?status=APPROVED&page=2'
it('retries 503 → 503 → 200 and succeeds', async () => {
  // handler returns json(503), json(503), json(200, { id: 'CLM-0001' })
  await expect(client.request({ method: 'GET', path: '/claims/CLM-0001' })).resolves.toEqual({ id: 'CLM-0001' });
  expect(apiCalls()).toBe(3);
});
it('throws ApiError 503 after retries are exhausted', ...) // 4 api calls, ApiError status 503 code 'SERVICE_UNAVAILABLE'
it('retries a network error then succeeds', ...)            // NetworkError, then json(200)
it('throws NetworkError when the network keeps failing', ...) // rejects instanceof NetworkError, 4 calls
it('on 401 refreshes once and retries without using a retry attempt', ...) // RetryPolicy({ maxRetries: 0 }); 401 then 200 → resolves; 2 token calls
it('throws AuthError when the retried request is also 401', ...) // code 'TOKEN_EXPIRED' from body
it('maps invalid API key on token endpoint to AuthError INVALID_API_KEY', ...)
it('maps 400 to ValidationError with server fields and requestId', ...) // fields { amount: 'must be positive' }, requestId 'req-1'
it.each([[404, 'NOT_FOUND'], [409, 'INVALID_TRANSITION']])('maps %i to ApiError %s', ...)
it('maps a non-JSON 502 body to ApiError HTTP_502', ...) // Review Focus #1: json(502, '<h1>Bad Gateway</h1>') → status 502, code 'HTTP_502'
it('does not retry a non-replayable multipart body', ...)  // replayable false, 503 → ApiError after 1 api call
it('3 concurrent requests that all get 401 cause exactly 1 refresh', async () => {
  // first 3 api calls return 401 with tok-1; later calls return 200
  await Promise.all([1, 2, 3].map(() => client.request({ method: 'GET', path: '/claims' })));
  expect(tokenCalls()).toBe(2);
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run packages/sdk/test/HttpClient.test.ts` → FAIL.
- [ ] **Step 3: Implement `mapResponseError`, `HttpClient` and the fake transport helper**
- [ ] **Step 4: Run to verify pass** → PASS; `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** — `git add packages && git commit -m "feat(sdk): add http client with auth, retry and typed error mapping"`.

---

### Task 7: Config, InsuranceSDK entry point, ClaimsResource (create/get/list), build

**Files:**
- Create: `packages/sdk/src/config.ts`, `packages/sdk/src/InsuranceSDK.ts`, `packages/sdk/src/resources/ClaimsResource.ts`, `packages/sdk/tsup.config.ts`
- Modify: `packages/sdk/src/index.ts`, `packages/sdk/package.json` (build script, `exports`, `files`)
- Test: `packages/sdk/test/config.test.ts`, `packages/sdk/test/claims.test.ts`

**Interfaces:**
- Consumes: `HttpClient` (Task 6), `validateClaim` (Task 2), `NodeTransport` (Task 4), `RetryPolicy` (Task 3).
- Produces:
  ```ts
  // config.ts
  const ENVIRONMENT_URLS: { readonly sandbox: 'http://localhost:4000'; readonly production: 'https://api.insurance.example.com' };
  interface InsuranceSDKOptions { apiKey: string; environment: 'sandbox' | 'production'; baseUrl?: string;
    timeout?: number; maxRetries?: number; transport?: Transport }
  interface ResolvedConfig { apiKey: string; baseUrl: string; timeoutMs: number; maxRetries: number; transport: Transport }
  function resolveConfig(options: InsuranceSDKOptions): ResolvedConfig   // throws ValidationError
  function maskApiKey(apiKey: string): string                             // 'pk_test_dev_123' → 'pk_test_****123'
  // ClaimsResource.ts
  class ClaimsResource { constructor(http: HttpClient)
    create(input: CreateClaimInput): Promise<Claim>; get(id: string): Promise<Claim>; list(params?: ListClaimsParams): Promise<Page<Claim>> }
  // InsuranceSDK.ts
  class InsuranceSDK { constructor(options: InsuranceSDKOptions); readonly claims: ClaimsResource }
  ```
  - `resolveConfig` errors: `apiKey` → `required` / `must start with pk_`; `environment` → `must be sandbox or production`; `timeout` → `must be a positive integer`; `maxRetries` → `must be a non-negative integer`. A trailing `/` on `baseUrl` is stripped. It never touches `process.env`.
  - `maskApiKey`: the first two `_`-separated segments plus `_` (`pk_test_`), then `****`, then the last 3 characters.
  - `ClaimsResource`: `create` validates (throws `ValidationError(fields)` with no network call) → `POST /claims`. `get`: an empty or non-string id → `ValidationError({ id: 'required' })`; the path uses `encodeURIComponent(id)`. `list`: `page` must be an integer ≥ 1 (`must be an integer >= 1`), `pageSize` an integer 1–100 (`must be an integer between 1 and 100`), and `status` in `CLAIM_STATUSES` (`must be one of …`) → `GET /claims` with query.
  - `package.json`: `"exports": {".": {"types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs"}}`, `"files": ["dist"]`, `"build": "tsup"`. `tsup.config.ts`: entry `src/index.ts`, formats `esm`/`cjs`, `dts: true`, `clean: true`.
  - `index.ts` additionally exports `InsuranceSDK`, `InsuranceSDKOptions`, `maskApiKey`, `Transport`, `TransportRequest`, `TransportResponse`, `NodeTransport`.

- [ ] **Step 1: Write the failing tests**

```ts
// config.test.ts
it.each([
  [{ environment: 'sandbox' }, { apiKey: 'required' }],
  [{ apiKey: 'abc', environment: 'sandbox' }, { apiKey: 'must start with pk_' }],
  [{ apiKey: 'pk_test_1', environment: 'staging' }, { environment: 'must be sandbox or production' }],
  [{ apiKey: 'pk_test_1', environment: 'sandbox', timeout: 0 }, { timeout: 'must be a positive integer' }],
])('rejects invalid options %#', (opts, fields) => {
  expect(() => resolveConfig(opts as InsuranceSDKOptions)).toThrow(expect.objectContaining({ fields }));
});
it('does not read INSURANCE_API_KEY from the environment', () => {
  vi.stubEnv('INSURANCE_API_KEY', 'pk_test_env');
  expect(() => new InsuranceSDK({ environment: 'sandbox' } as InsuranceSDKOptions)).toThrow(ValidationError);
});
it('resolves environment URLs, baseUrl override and defaults', ...) // production URL; 'http://x:1/' → 'http://x:1'; timeoutMs 30000, maxRetries 3
it('masks API keys', () => expect(maskApiKey('pk_test_dev_123')).toBe('pk_test_****123'));

// claims.test.ts (sdk built with transport: fakeTransport(withTokenEndpoint(...)), baseUrl 'http://api.test')
it('create posts the input and returns the claim', ...) // url 'http://api.test/api/v1/claims', JSON.parse(body) equals input, returns Claim
it('create rejects invalid input without any network call', async () => {
  await expect(sdk.claims.create({ ...valid, amount: -1 })).rejects.toMatchObject({ fields: { amount: 'must be positive' } });
  expect(transport.calls).toHaveLength(0);
});
it('get fetches by encoded id', ...)                 // url ends '/claims/CLM%2F1' for 'CLM/1'
it('get rejects an empty id', ...)                   // ValidationError { id: 'required' }, 0 calls
it('list sends filters as query and returns a page', ...) // '?status=UNDER_ASSESSMENT&page=1&pageSize=20'
it('list rejects pageSize 101 and unknown status', ...)
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run packages/sdk/test/config.test.ts packages/sdk/test/claims.test.ts` → FAIL.
- [ ] **Step 3: Implement `config.ts`, `ClaimsResource`, `InsuranceSDK`, the exports and the tsup config**
- [ ] **Step 4: Run tests, typecheck and build**

Run: `npm test && npm run typecheck && npm run build && ls packages/sdk/dist`
Expected: PASS; `dist` contains `index.js`, `index.cjs`, `index.d.ts`.

- [ ] **Step 5: Commit** — `git add packages && git commit -m "feat(sdk): add InsuranceSDK entry point and claims resource"`.

---

### Task 8: DocumentsResource (upload sources, validation, progress)

**Files:**
- Create: `packages/sdk/src/resources/uploadSource.ts`, `packages/sdk/src/resources/DocumentsResource.ts`
- Modify: `packages/sdk/src/InsuranceSDK.ts` (add `readonly documents: DocumentsResource`)
- Test: `packages/sdk/test/documents.test.ts` (writes temp files to `os.tmpdir()`)

**Interfaces:**
- Consumes: `buildMultipart`, `MultipartFile` (Task 4), `HttpClient` (Task 6), `validateDocument`, `inferContentType` (Task 2).
- Produces:
  ```ts
  interface ResolvedSource { file: MultipartFile; replayable: boolean }
  function resolveUploadSource(source: UploadSource, options: UploadOptions): Promise<ResolvedSource> // throws ValidationError
  class DocumentsResource { constructor(http: HttpClient)
    upload(claimId: string, source: UploadSource, options: UploadOptions): Promise<ClaimDocument>
    list(claimId: string): Promise<ClaimDocument[]> }
  ```
  - Path (string): `fs.promises.stat`. `ENOENT` or not a regular file → `ValidationError({ file: 'file not found' })`. `filename = options.filename ?? path.basename`, `size = stat.size`, `open = () => fs.createReadStream(path)`, replayable. Buffer: `filename` required (`{ filename: 'required' }`), size = length, replayable. Stream: `filename` required, `size` required (`{ size: 'required for stream uploads' }`), not replayable, and `open` returns the same stream.
  - `contentType = options.contentType ?? inferContentType(filename)`, then `validateDocument({ type, contentType, size })` → throw on failure. An empty `claimId` → `{ claimId: 'required' }`.
  - Sends `POST /claims/:id/documents` with `buildMultipart({ type }, file, replayable)`. Progress: `percent = Math.floor(sent / total * 100)`. Emit only when `percent > lastEmitted` (this also covers retries restarting from 0). If the request succeeds and 100 was never emitted, emit 100 before resolving.

- [ ] **Step 1: Write the failing tests**

```ts
it('uploads from a file path with inferred name, size and type', ...) // multipart.contentLength > size; resolves ClaimDocument
it('rejects a path that does not exist without network', ...)        // Review Focus #5: { file: 'file not found' }, 0 calls
it('rejects an empty file', ...)                                      // Review Focus #5: { size: 'must be greater than 0' }
it('requires filename for Buffer sources', ...)                       // { filename: 'required' }
it('requires size for stream sources and marks them non-replayable', ...)
it('rejects files over 10 MB before sending', ...)                    // Buffer.alloc(10_485_761), name 'a.pdf' → { size: 'must be at most 10 MB' }
it('rejects unsupported content types', ...)                          // 'notes.txt' → { contentType: 'required' }
it('reports monotonic integer progress ending at 100', async () => {
  // fake transport calls req.onUploadProgress with (0,200), (50,200), (50,200), (20,200), (200,200) then returns 201
  const seen: number[] = [];
  await sdk.documents.upload('CLM-0001', Buffer.from('x'), { type: 'medical_receipt', filename: 'a.pdf', onProgress: (p) => seen.push(p) });
  expect(seen).toEqual([0, 25, 100]);
});
it('lists documents for a claim', ...)
```

Note: for `notes.txt`, `inferContentType` returns `undefined`, so the message is `contentType: 'required'`. With an explicit `contentType: 'text/plain'` the message is `must be one of …`. Assert both.

- [ ] **Step 2: Run to verify failure** — `npx vitest run packages/sdk/test/documents.test.ts` → FAIL.
- [ ] **Step 3: Implement `resolveUploadSource` and `DocumentsResource`; wire them into `InsuranceSDK`**
- [ ] **Step 4: Run to verify pass** → PASS; `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** — `git add packages && git commit -m "feat(sdk): add document uploads with progress tracking"`.

---

### Task 9: StatusPoller and `claims.onStatusChange`

**Files:**
- Create: `packages/sdk/src/resources/StatusPoller.ts`
- Modify: `packages/sdk/src/resources/ClaimsResource.ts` (add `onStatusChange`), `packages/sdk/src/index.ts` (export `StatusChangeOptions`, `Unsubscribe`)
- Test: `packages/sdk/test/StatusPoller.test.ts` (`vi.useFakeTimers()`)

**Interfaces:**
- Consumes: `ClaimsResource.get` (Task 7).
- Produces:
  ```ts
  type Unsubscribe = () => void;
  interface StatusChangeOptions { intervalMs?: number; onError?: (error: SDKError) => void }
  type StatusChangeCallback = (newStatus: ClaimStatus, claim: Claim) => void;
  class StatusPoller { constructor(fetchClaim: (id: string) => Promise<Claim>)
    subscribe(claimId: string, callback: StatusChangeCallback, options?: StatusChangeOptions): Unsubscribe }
  // ClaimsResource
  onStatusChange(claimId: string, callback: StatusChangeCallback, options?: StatusChangeOptions): Unsubscribe
  ```
  - Synchronous validation: an empty id → `ValidationError({ claimId: 'required' })`; `intervalMs < 1000` or not an integer → `{ intervalMs: 'must be an integer >= 1000' }`.
  - The first fetch runs immediately and records the baseline (no callback). Each later fetch is scheduled with `setTimeout(intervalMs)` **after** the previous one settles (no overlap). The callback runs only when the status differs from the last seen status.
  - After each fetch, check the `stopped` flag before invoking the callback or scheduling the next fetch.
  - Callback exceptions are caught and passed to `onError` (wrapped as `SDKError('Status change callback threw', { code: 'CALLBACK_ERROR', cause })` if not already an `SDKError`), and polling continues.
  - Fetch errors go to `onError`. `AuthError`, or `ApiError` with status 404, stops polling. Any other error keeps polling. A non-`SDKError` thrown value is wrapped the same way with code `'UNKNOWN_ERROR'`.
  - Timers are not `unref`'d.

- [ ] **Step 1: Write the failing tests** (`fetchClaim` is a `vi.fn` returning claims from a scripted status list)

```ts
it('does not fire for the baseline and fires once per change', async () => {
  // statuses: SUBMITTED, SUBMITTED, DOCUMENTS_VERIFIED, DOCUMENTS_VERIFIED, UNDER_ASSESSMENT
  poller.subscribe('CLM-0001', cb, { intervalMs: 1000 });
  await vi.advanceTimersByTimeAsync(4000);
  expect(cb.mock.calls.map((c) => c[0])).toEqual(['DOCUMENTS_VERIFIED', 'UNDER_ASSESSMENT']);
});
it('never overlaps requests when a fetch is slower than the interval', ...) // fetch resolves after 3000ms; at most 1 pending
it('reports errors to onError and keeps polling', ...)     // NetworkError once, then status change still delivered
it('stops on 404 and AuthError', ...)                      // after an ApiError 404: no more fetch calls
it('unsubscribe stops further polls', ...)                 // unsubscribe after the first change; advance 10s; fetch count unchanged
it('does not fire the callback when unsubscribed during an in-flight fetch', async () => { // Review Focus #2
  // second fetch is a deferred promise; unsubscribe(); then resolve it with a new status
  expect(cb).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
it('a throwing callback goes to onError and polling continues', ...) // Review Focus #3: onError gets code 'CALLBACK_ERROR'; next change still delivered
it('validates claimId and intervalMs synchronously', ...)
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run packages/sdk/test/StatusPoller.test.ts` → FAIL.
- [ ] **Step 3: Implement `StatusPoller` and `ClaimsResource.onStatusChange`**
- [ ] **Step 4: Run to verify pass** — `npm test` → all PASS.
- [ ] **Step 5: Commit** — `git add packages && git commit -m "feat(sdk): add polling-based claim status tracking"`.

---

### Task 10: Mock server foundation (config, chaos, JWT, auth endpoint)

**Files:**
- Create: `packages/mock-server/src/{config,random,store,server,main}.ts`, `src/auth/jwt.ts`, `src/plugins/{requestId,chaos}.ts`, `src/routes/auth.ts`
- Test: `packages/mock-server/test/jwt.test.ts`, `packages/mock-server/test/auth.test.ts`, `packages/mock-server/test/chaos.test.ts`

**Interfaces:**
- Consumes: SDK exports via `@insurance/partner-sdk` (`Claim`, `ClaimDocument`, `ClaimStatus`).
- Produces:
  ```ts
  interface MockConfig { port: number; apiKeys: string[]; jwtSecret: string; jwtTtlSec: number; chaos: boolean;
    failureRate: number; delayMinMs: number; delayMaxMs: number; seed: number | undefined; now: () => number }
  function loadConfig(env: NodeJS.ProcessEnv): MockConfig            // defaults per spec §5.1; now = Date.now
  function createRandom(seed: number | undefined): () => number       // mulberry32 when seeded, else Math.random
  function signToken(payload: { sub: string }, secret: string, ttlSec: number, nowMs: number): string   // HS256, iat/exp in seconds
  function verifyToken(token: string, secret: string, nowMs: number): { ok: true; sub: string } | { ok: false; reason: 'invalid' | 'expired' }
  class Store { claims: Map<string, Claim>; documents: Map<string, ClaimDocument[]>; nextClaimId(): string; nextDocumentId(): string; reset(): void }
  function buildServer(overrides?: Partial<MockConfig>): Promise<FastifyInstance>   // config = { ...loadConfig({}), ...overrides }; decorates app with `store`
  ```
  - `requestId` plugin: an `onSend` hook sets `x-request-id: req-<incrementing n>`.
  - `chaos` plugin (spec §5.2): an `onRequest` hook applies only to URLs starting with `/api/v1`, and only when `config.chaos`. It awaits a delay of `delayMinMs + random() * (delayMaxMs - delayMinMs)`, then if `random() < failureRate` replies `503 { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable' }`.
  - `POST /api/v1/auth/token`: a body without a non-empty string `apiKey` → `400 { code: 'VALIDATION_ERROR', message, fields: { apiKey: 'required' } }`. A key not in `apiKeys` → `401 { code: 'INVALID_API_KEY' }`. Otherwise `200 { accessToken, tokenType: 'Bearer', expiresIn: jwtTtlSec }`, where `sub` is `maskApiKey(apiKey)`.
  - `main.ts`: `loadConfig(process.env)` → `buildServer` → `listen({ port, host: '0.0.0.0' })`. It logs `Mock API listening on http://localhost:<port>`, the chaos settings, and the sample `curl` command from spec §5.2.

- [ ] **Step 1: Write the failing tests** (use `app.inject`)

```ts
// jwt.test.ts
it('signs and verifies a token', ...)           // verifyToken(sign(...)) → { ok: true, sub }
it('reports expired tokens', ...)               // ttl 1s, verify at now + 1001ms → { ok: false, reason: 'expired' }
it('rejects tampered tokens', ...)              // flip a signature char → reason 'invalid'; malformed 'abc' → 'invalid'
// auth.test.ts (buildServer({ chaos: false, apiKeys: ['pk_test_dev_123'] }))
it('issues a token for a known key', ...)       // 200, tokenType 'Bearer', expiresIn 3600, accessToken is a 3-part string
it('rejects an unknown key with 401 INVALID_API_KEY', ...)
it('rejects a missing apiKey with 400 field errors', ...)  // fields { apiKey: 'required' }
it('sets x-request-id on responses', ...)
// chaos.test.ts
it('returns 503 SERVICE_UNAVAILABLE when failureRate is 1', ...)  // chaos true, delay 0..0
it('never applies chaos to /__mock routes', ...)   // failureRate 1; register a test route '/__mock/ping' in the test → 200
it('is deterministic with a seed', ...)            // two servers, seed 42, failureRate 0.5: identical 20-request status sequences
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run packages/mock-server/test` → FAIL.
- [ ] **Step 3: Implement config, random, jwt, store, plugins, the auth route, buildServer and main**
- [ ] **Step 4: Run to verify pass, then smoke-run the server**

Run: `npx vitest run packages/mock-server/test` → PASS.
Run: `cp .env.example .env && timeout 3 npm run mock` → logs `Mock API listening on http://localhost:4000` (this proves tsx resolves `@insurance/partner-sdk` through tsconfig `paths`).

- [ ] **Step 5: Commit** — `git add packages && git commit -m "feat(mock-server): add server foundation, chaos and token endpoint"`.

---

### Task 11: Mock server claims, documents and control routes

**Files:**
- Create: `packages/mock-server/src/plugins/authGuard.ts`, `src/lifecycle.ts`, `src/routes/{claims,documents,control}.ts`, `packages/mock-server/test/helpers.ts`
- Modify: `packages/mock-server/src/server.ts` (register `@fastify/multipart` with `limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 }`, plus the routes)
- Test: `packages/mock-server/test/claims.test.ts`, `test/documents.test.ts`, `test/control.test.ts`

**Interfaces:**
- Consumes: `validateClaim`, `validateDocument`, `CLAIM_STATUSES`, `CLAIM_TRANSITIONS`, `MAX_PAGE_SIZE`, `DOCUMENT_TYPES` from the SDK; `Store`, `verifyToken`, `MockConfig` from Task 10.
- Produces:
  - `canTransition(from: ClaimStatus, to: ClaimStatus): boolean`; `allowedNext(from: ClaimStatus): readonly ClaimStatus[]`.
  - `authGuard`: a `preHandler` applied to the claims and documents routes. A missing or non-`Bearer` header, or a bad token → `401 { code: 'UNAUTHORIZED' }`; an expired token → `401 { code: 'TOKEN_EXPIRED' }`. Uses `config.now()`.
  - The routes behave exactly as in the spec §5.2 table. A create stores `status: 'SUBMITTED'`, `statusHistory: [{ status: 'SUBMITTED', at }]`, `createdAt = updatedAt = at` (ISO from `config.now()`). The list is newest first; the query is validated with the same messages as Task 7's `ClaimsResource.list`, and a page beyond `totalPages` returns `data: []`. Upload: a missing claim → 404 `NOT_FOUND`; no file part → `400 fields { file: 'required' }`; a bad `type` → 400 with `validateDocument`'s message; a MIME type not allowed → `415 UNSUPPORTED_MEDIA_TYPE`; `file.truncated` or fastify's `RequestFileTooLargeError` → `413 FILE_TOO_LARGE`. The file stream is drained to count `size`. The `type` field must come before the file part (the SDK does this).
  - `PATCH /__mock/claims/:id/status`: an unknown `status` → 400 `fields { status: 'must be one of …' }`; a missing claim → 404; a disallowed move → `409 { code: 'INVALID_TRANSITION', message: 'Cannot move from X to Y', allowed }`; otherwise it appends `{ status, at, note? }`, updates `updatedAt` and returns 200. `POST /__mock/reset` → `store.reset()`, 204.
  - `test/helpers.ts`: `getToken(app): Promise<string>` and `multipartPayload(fields: Record<string, string>, file?: { filename: string; contentType: string; data: Buffer }): { payload: Buffer; headers: Record<string, string> }`.

- [ ] **Step 1: Write the failing tests**

```ts
// claims.test.ts
it('rejects missing token with 401 UNAUTHORIZED', ...)
it('rejects expired token with 401 TOKEN_EXPIRED', ...)  // sign with now, buildServer({ now: () => t0 + 3_601_000 })
it('creates a SUBMITTED claim with history', ...)       // 201, id 'CLM-0001', statusHistory length 1
it('returns field errors from shared validation', ...)  // 400 { code: 'VALIDATION_ERROR', fields: { amount: 'must be positive' } }
it('gets a claim and 404s unknown ids', ...)
it('paginates and filters by status', ...)             // 3 claims, move 1 to DOCUMENTS_VERIFIED; ?status=SUBMITTED&pageSize=1 → total 2, totalPages 2, data length 1
it('returns empty data for a page beyond the last', ...)
// documents.test.ts
it('uploads a PDF and lists it', ...)                  // 201 ClaimDocument { id 'DOC-0001', size: data.length, contentType 'application/pdf' }
it('rejects unsupported media with 415', ...)
it('rejects files over 10 MB with 413 FILE_TOO_LARGE', ...)
it('404s uploads for unknown claims', ...)
// control.test.ts
it('walks the full happy path to CLOSED', ...)         // SUBMITTED → … → APPROVED → PAYMENT_INITIATED → CLOSED, each 200
it('allows PENDING_INFO back to DOCUMENTS_VERIFIED', ...)
it('rejects invalid transitions with 409 and allowed list', ...) // SUBMITTED → APPROVED → allowed ['DOCUMENTS_VERIFIED']
it('resets the store', ...)
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run packages/mock-server/test` → FAIL.
- [ ] **Step 3: Implement `lifecycle`, `authGuard`, the routes and the test helpers**
- [ ] **Step 4: Run to verify pass** — `npm test && npm run typecheck && npm run lint` → PASS.
- [ ] **Step 5: Commit** — `git add packages && git commit -m "feat(mock-server): add claims, documents and control endpoints"`.

---

### Task 12: End-to-end integration tests (SDK ↔ mock server)

**Files:**
- Test: `tests/integration/sdk-e2e.test.ts`

**Interfaces:**
- Consumes: `buildServer` (Tasks 10–11) via relative import `../../packages/mock-server/src/server`; `InsuranceSDK` via `@insurance/partner-sdk`.

- [ ] **Step 1: Write the tests** (`beforeAll`: `app = await buildServer({ chaos: false, apiKeys: ['pk_test_e2e'] })`, `await app.listen({ port: 0, host: '127.0.0.1' })`; the SDK uses `baseUrl: http://127.0.0.1:<port>`)

```ts
it('creates, fetches and lists a claim', ...)
it('rejects an unknown API key with AuthError INVALID_API_KEY', ...)
it('get of an unknown claim throws ApiError NOT_FOUND with requestId', ...)
it('uploads a real file from disk with progress reaching 100', ...)  // examples/fixtures/sample-receipt.pdf; last progress 100; documents.list length 1
it('onStatusChange observes a transition made through the control endpoint', async () => {
  // subscribe with intervalMs 1000; PATCH /__mock/claims/:id/status DOCUMENTS_VERIFIED via fetch; await vi.waitFor(() => expect(cb).toHaveBeenCalledWith('DOCUMENTS_VERIFIED', expect.objectContaining({ id })), { timeout: 3000 }); unsubscribe()
});
it('recovers from seeded transient 503s via retries', ...) // separate server: chaos true, failureRate 0.5, seed 7, delay 0..0; 10 sequential claims.get calls all resolve
it('refreshes an expired token transparently', ...)        // server with jwtTtlSec 61 and mutable now: advance now 62s → next call still succeeds
```

- [ ] **Step 2: Run** — `npx vitest run tests/integration` → PASS (7 tests). If one fails, fix the owning package's code (not the test) and note the fix in the commit message.
- [ ] **Step 3: Commit** — `git add tests && git commit -m "test: add end-to-end SDK and mock server integration tests"`.

---

### Task 13: Example scripts

**Files:**
- Create: `examples/shared.ts`, `examples/01-simple-claim.ts`, `examples/02-claim-with-documents.ts`, `examples/03-poll-status.ts`, `examples/fixtures/sample-receipt.pdf`

**Interfaces:**
- Consumes: the public SDK API only (`@insurance/partner-sdk`).
- Produces (`shared.ts`):
  - `createSdk(): InsuranceSDK`: reads `INSURANCE_API_KEY` (if missing, prints `Set INSURANCE_API_KEY in .env (see .env.example)` and exits 1) and `INSURANCE_BASE_URL ?? 'http://localhost:4000'`, and passes both explicitly.
  - `sampleClaim(): CreateClaimInput`: the spec example values with today's date.
  - `reportError(error: unknown): void`: an `instanceof` chain over the 4 error types, printing `fields`, the masked context and `requestId`.
- Behaviour per spec §7:
  - Example 2: `process.argv[2]` is required. It must exist (`fs.existsSync`), otherwise print `Usage: npm run example:2 -- <filePath> [documentType]` and `Try: npm run example:2 -- examples/fixtures/sample-receipt.pdf`, then exit 1. `argv[3]` defaults to `medical_receipt`. It renders the progress bar as `\r[#####-----] 50%` on stdout.
  - Example 3: an optional `argv[2]` claim id. It prints the curl command for the claim and polls with `intervalMs: 2000`, logging `[HH:MM:SS] CLM-0001: SUBMITTED → DOCUMENTS_VERIFIED`. `process.on('SIGINT')` → `unsubscribe()`, print `Stopped watching CLM-0001 after N status change(s).`, exit 0.
- Fixture: a minimal valid one-page PDF (under 1 KB) with the text "Sample medical receipt".

- [ ] **Step 1: Write the scripts and the fixture**
- [ ] **Step 2: Typecheck** — `npm run typecheck` → PASS.
- [ ] **Step 3: Run against the mock server**

Run: `npm run mock` in the background with `CHAOS=on`, then:
- `npm run example:1` → prints the created claim (`status: 'SUBMITTED'`), then `ValidationError` fields for the invalid claim.
- `npm run example:2` → prints the usage message, exit code 1.
- `npm run example:2 -- examples/fixtures/sample-receipt.pdf` → progress reaches `100%`, and the documents list has 1 entry.
- `npm run example:3` → prints the claim id and curl. Run the printed curl with `DOCUMENTS_VERIFIED`; the script logs the transition within about 2 s. Send SIGINT (`kill -INT`); the script prints the summary and exits 0.

- [ ] **Step 4: Commit** — `git add examples && git commit -m "docs: add example integration scripts"`.

---

### Task 14: Documentation

**Files:**
- Create: `README.md` (root), `packages/sdk/README.md`
- Modify: public SDK source files, adding TSDoc to each exported class, method, option and type (`InsuranceSDK`, the resources, the errors, `InsuranceSDKOptions`, `UploadOptions`, `StatusChangeOptions`).

**Interfaces:**
- Consumes: everything public. The docs must match the actual signatures from Tasks 1–9.

Content is fixed by spec §8.1 (root README) and §8.2 (SDK README: Part A API reference; Part B integration guide, sections 1–11 in that order). Diagrams are Mermaid: the architecture pipeline and the lifecycle graph from spec §3.1. Every code sample in Part B must use only exported names, and must pass the API key explicitly from `process.env.INSURANCE_API_KEY`.

- [ ] **Step 1: Write both READMEs and the TSDoc comments**
- [ ] **Step 2: Verify the quickstart verbatim from a clean state**

Run: `rm -rf node_modules .env && npm install && cp .env.example .env`, then `npm run mock` in the background, then `npm run example:1`.
Expected: the claim is created, matching the README's stated output.

- [ ] **Step 3: Verify the full suite**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass; the test count reported by Vitest is ≥ 20 (target ~38+).

- [ ] **Step 4: Commit** — `git add README.md packages && git commit -m "docs: add README quickstart, API reference and integration guide"`.
