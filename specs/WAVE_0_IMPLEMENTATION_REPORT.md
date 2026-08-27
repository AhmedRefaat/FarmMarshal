# Wave 0 — Emergency Remediation Implementation Report

**Scope:** stop token forgery, invalidate compromised authentication material,
contain confirmed cross-tenant exposures, and mitigate the production-reachable
dependency issue.
**Environment:** local development workspace only. No production system,
database or credential was contacted at any point.
**Trails touched:** `webapp/server-node` (primary), `webapp/server-rust`
(signing parity), `webapp/client` (validation only — unchanged).

---

## 1. Starting commit

**No commit hash could be recorded.**

```
> git rev-parse HEAD
fatal: not a git repository (or any of the parent directories): .git
> git status --short
fatal: not a git repository (or any of the parent directories): .git
```

The repository root `c:\BMW_Work\Workspace\Scripts\WebApp_Demp` is **not a git
working tree**. This is finding **VAL-018** and it is recorded here as the
mandated mismatch disclosure:

- There is no baseline commit to reference, diff against, or revert to.
- Rollback cannot be performed with `git revert` / `git checkout` (see §10).
- The `.github/workflows/ci.yml` gate has never executed, because there is no
  remote to run it. Its own header states this.
- `mobile-app/` is a separate git repository and was not modified.

Everything below was verified directly against the working files, not against
a commit.

---

## 2. Findings verified against the current branch

Every ID was re-confirmed by reading the current source before any edit. All
six in-scope findings were **present and exploitable as described**. Two line
numbers in the original audit were stale; the code was not.

| ID | Verified location | Confirmed defect |
|---|---|---|
| **SEC-C01** | `server-rust/src/auth.rs:18-20` `secret()` | `env::var("AUTH_SECRET").unwrap_or_else(\|_\| "agritasks-dev-secret".into())`. Literal on **line 20** (audit said 19). Consumed by `sign()` L26, `issue_token()` L32, `verify()` L40. The Node trail had the same literal as `INSECURE_LEGACY_SECRET` returned as a live dev fallback. Anyone reading the repo could mint an `admin` token. |
| **SEC-C02** | `server-node/src/chat.ts` `listMessages(conversationId)` + `routes/features.ts` `GET /v2/chat/:id/messages` | Function took **no caller id**. Route used bare `requirePermission()` (authentication only). `assertMember` at `chat.ts:126` was called by `sendMessage`/`setPin`/`react` but **not** by any read path. Any authenticated user could read any conversation. |
| **SEC-C03** | `server-node/src/chat.ts` `messageInLang(messageId, targetLang)` | Called `requireMessage()` then `activeTranslator()` with no membership check — an alternate retrieval path that both **leaked message content** and **billed the paid translation vendor** for an unauthorized caller. |
| **SEC-C04** | `server-node/src/routes/farmsFinance.ts` `GET /finances`, `GET /finances/summary` | Guarded by `requireRole('owner')` only. `farmId` was an **optional filter**: `(!q.farmId \|\| e.farmId === q.farmId)`. Omitting it returned every tenant's ledger; supplying another tenant's id returned that tenant's ledger. |
| **SEC-C05** | `server-node/src/routes/farmsFinance.ts` `POST /finances` | `farmId: b.farmId` copied straight from the request body with no ownership check, and no audit record was written. |
| **VAL-009 / DEP-01** | `server-node/src/index.ts` `fastifyStatic` registration on `/uploads/` | Unauthenticated public static serving. `@fastify/static@8.3.0` (direct dependency, **high**) carries GHSA-pr96-94w5-mx2h (traversal), GHSA-x428-ghpx-8j92 (**route-guard bypass via encoded separators**), GHSA-8pvw-jcv7-9cmj (authorization bypass via non-canonical paths). |

**Additional defects found while verifying the above** and fixed in the same
wave because they sit on the identical code paths:

| ID | Location | Defect |
|---|---|---|
| **VAL-007** | `routes/features.ts` `POST /v2/chat/:id/media`, `POST /v2/evidence` | Extension derived from `file.mimetype.split('/')[1]`; `validateUpload()` was never called on either route. |
| **VAL-008** | `index.ts` `saveMedia()` | That client-controlled extension was interpolated into the stored path. |
| **VAL-014** | `server-rust/src/auth.rs` `verify()` | `if sign(payload) != sig` — a short-circuiting `String` comparison, while the doc comment claimed constant-time comparison "via the hmac crate". The comment was false. |
| **VAL-006** | `routes/farmsFinance.ts` `GET /farms` | Returned the full farm array to every owner/moderator ("demo: all"). |
| — | `routes/farmsFinance.ts` | Module kept a **private farm registry** (`farm-1`, `farm-2`) disjoint from the canonical tenancy root in `store.ts` (`f-1`). With two farm models, tenancy was structurally unenforceable here. |
| — | `routes/farmsFinance.ts` `POST /finances` | `typeof b.amount === 'number'` admits `NaN` and `Infinity`; `b.amount <= 0` is false for both. |

Excluded per the validation report: the two refuted false positives
(`toBuffer()` memory exhaustion — bounded by the global `fileSize` limit at
`index.ts:80`; stored XSS on `/uploads/` — refuted by the response headers) and
the two withdrawn claims (`client/dist/` exposure; `firebase-admin` bundling —
it is a devDependency in both manifests).

---

## 3. Files changed

### `webapp/server-node/src/security/config.ts` — rewritten

| Symbol | Change |
|---|---|
| `INSECURE_LEGACY_SECRET` | **Demoted to deny-list only.** Still exported so tests and the deny-list can reference it; never returned as a usable value. |
| `PLACEHOLDER_SECRETS` | **New.** Frozen list: the legacy literal, `changeme`, `change-me`, `secret`, `password`, `todo`, `placeholder`, `your-secret-here`, `xxxxxxxx`. |
| `MIN_AUTH_SECRET_LENGTH` | **New.** `32`. |
| `developmentSecret()` | **New.** `randomBytes(32).toString('hex')`, memoised per process. |
| `isPlaceholder()`, `looksTriviallyWeak()` | **New.** Trim + case-fold compare; `< 8` distinct characters. |
| `resolveAuthSecret()` | **Rewritten.** Missing/blank → ephemeral key in `development`/`test`, `SecurityConfigError` elsewhere. A supplied value is rejected in **every** environment if it is a placeholder, shorter than 32, or low-entropy. |
| `describeAuthSecret()` | **New.** Returns `{ source, env, length }`. Never returns or logs the value. |
| `resolveCorsOrigins`, `allowDemoSeed` | Unchanged. |

### `webapp/server-node/src/security/media.ts` — new file

| Symbol | Purpose |
|---|---|
| `STORED_NAME` | Anchored `UUID.ext` pattern — no separator, traversal segment, NUL byte or encoded variant can satisfy it. |
| `CANONICAL_EXTENSIONS`, `isCanonicalExtension()` | Derived from `ALLOWED_UPLOAD_TYPES`, so the extension allow-list has exactly one definition. |
| `isSafeStoredName()` | Pattern **and** canonical-extension check. Shape alone is insufficient: `<uuid>.exe` matches the pattern but is not something this server ever wrote. |
| `resolveContainedPath(dir, name)` | Pattern check, then `resolve()`, then a `startsWith(root + sep)` containment proof. Returns `null` rather than throwing. |
| `MEDIA_TICKET_TTL_MS` | 5 minutes. |
| `signMediaTicket()`, `verifyMediaTicket()` | HMAC over `${name}:${expiresAt}`, keyed with the auth secret; verified with `timingSafeEqual`. Bound to one filename. |

### `webapp/server-node/src/index.ts`

| Symbol | Change |
|---|---|
| import block | Removed `@fastify/static`. Added `createReadStream`, `stat`, and the `security/media.js` helpers. |
| `saveMedia()` | Rejects a non-canonical extension; resolves through `resolveContainedPath()` and refuses to write outside the upload directory. |
| `GET /uploads/:name` | **New handler replacing `fastifyStatic`.** Canonical-name check → 404; then `authenticate()` **or** a valid media ticket → 401; then `stat()` → 404; sets `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Content-Disposition: inline`, `Cache-Control: private, no-store`; streams the file. |
| `POST /media/ticket` | **New.** Authenticated; mints a short-lived, path-bound ticket for `<img>` / `<Image>` consumers that cannot send an `Authorization` header. |
| `onRequest` hook | **New.** Assigns `request.correlationId = randomUUID()`. |
| `onSend` hook | Now emits `X-Correlation-Id`. |
| CLI entry | Logs `describeAuthSecret()` at boot. |

### `webapp/server-node/src/chat.ts`

| Symbol | Change |
|---|---|
| `listMessages(conversationId, userId)` | `userId` is now a **required** parameter; calls `assertMember()` first. Omitting it is a compile error, not a silent hole. |
| `messageInLang(messageId, targetLang, userId)` | `userId` now **required**; asserts membership **before** `activeTranslator()` is reached. |

### `webapp/server-node/src/routes/features.ts`

| Symbol | Change |
|---|---|
| `mapChatReadError()` | **New.** Read-path mapper: `forbidden` and `not_found` both return **404** with an identical body, so the endpoint cannot be used to enumerate ids. Write paths keep `mapChatError`'s 403. |
| `readValidatedUpload()` | **New.** Single place where a multipart part is buffered, size-limited and content-validated; returns the **server-chosen** extension. |
| `GET /v2/chat/:id/messages` | Passes the caller id; denials mapped non-enumeratively. |
| `POST /v2/chat/messages/:messageId/translate` | Passes the caller id; authorization now precedes the paid provider call. |
| `GET /v2/chat/inbox` | Passes the caller id to `listMessages`. |
| `POST /v2/chat/:id/media` | `assertMember()` **before** any byte is read or stored; routed through `readValidatedUpload()`. |
| `POST /v2/evidence` | Routed through `readValidatedUpload()`. |

### `webapp/server-node/src/routes/farmsFinance.ts` — rewritten

| Symbol | Change |
|---|---|
| private `farms` array | **Removed.** Replaced by the canonical registry (`listFarms()`, `getFarm()` from `store.ts`). |
| `entries` seed | Re-pointed onto canonical `f-1` so demo data remains reachable; ids renamed `fe-*` (they previously collided with farm ids). |
| `financeScope(actor)` | **New.** Returns `{ readable, writable }` derived **only** from verified memberships: admin → all; owner → read+write; moderator → read+write; accountant → read only; worker → neither. |
| `effectiveScope()` | **New.** Returns `null` for an out-of-scope request — a denial, never an empty result set. |
| `GET /farms` | Returns only the caller's farms. |
| `GET /finances`, `GET /finances/summary` | `farmId` is an authorization boundary. Out-of-scope id → **403**. No id → the caller's farms only. |
| `POST /finances` | Body `farmId` is a request, not a claim of ownership: rejected with **403** unless it is in `writable`. `createdById` comes from the authenticated actor. `Number.isFinite` rejects `NaN`/`Infinity`. Writes an `audit()` record with **no amount and no note**. |
| all handlers | `log.warn` denials with the correlation id and no financial detail. |

### `webapp/server-rust/src/security.rs`

| Symbol | Change |
|---|---|
| `INSECURE_LEGACY_SECRET`, `PLACEHOLDER_SECRETS`, `MIN_AUTH_SECRET_LENGTH` | **New.** Identical deny-list and threshold to the Node trail. |
| `SecretError` | **New.** `Missing` / `Placeholder` / `TooShort` / `TriviallyWeak`. The offending value is **not** carried in the error, so it cannot reach a log. |
| `current_env()`, `is_dev_like_env()` | **New.** Reads `APP_ENV` then `NODE_ENV`, defaulting to `development` — matching Node. |
| `generate_ephemeral_secret()` | **New.** Two UUIDv4 values from the OS RNG. |
| `resolve_auth_secret(env, raw)` | **New.** Byte-for-byte the same rules as `resolveAuthSecret()`. |

### `webapp/server-rust/src/auth.rs`

| Symbol | Change |
|---|---|
| `secret()` | **Literal removed.** Now delegates to the cached `init()`. |
| `init()` | **New.** `OnceLock`; resolves once and **panics on invalid configuration** so a misconfigured process never serves traffic. |
| `describe_secret()` | **New.** Provenance and length only. |
| `mac()` | **New.** Shared keyed-MAC constructor. |
| `verify()` | **VAL-014 fixed.** `Mac::verify_slice()` (constant time) replaces the short-circuiting `String` comparison, and the false doc comment is corrected. |
| `mod tests` | **New.** Six tests (see §5). |

### `webapp/server-rust/src/main.rs`

Resolves and validates the signing key immediately after logger init, before
the router is built, and logs `source` / `env` / `length` — never the value.

### `webapp/server-node/package.json`

`@fastify/static` **removed** from `dependencies`; lockfile synced.

---

## 4. Security behaviour, before and after

| Area | Before | After |
|---|---|---|
| **Signing secret** | Both trails silently fell back to a literal committed to this repository. Any reader could forge an `admin` token against any instance where `AUTH_SECRET` was unset. | No usable literal exists. Outside `development`/`test`, a missing, blank, placeholder, short or low-entropy value **prevents startup**. Dev mints a random per-process key, so tokens die on restart. |
| **Secret observability** | None. | One boot line per trail: `source`, `env`, `length`. The value is never logged, never returned, never in an error message. |
| **Chat message read** | Any authenticated user could read any conversation. | `listMessages` requires the caller id and asserts membership. Denial and non-existence are **indistinguishable** (identical 404 body). |
| **Chat translation** | Any authenticated user could read any message *and* bill the translation vendor. | Membership is asserted **before** `activeTranslator()`. A test asserts the provider is never invoked on an unauthorized request. |
| **Chat media upload** | Extension chosen by the client; membership unchecked; bytes written before any authorization. | Membership asserted first; content validated against magic bytes; extension chosen by the server. |
| **Finance read** | `GET /finances` with no `farmId` returned **every tenant's ledger**. With another tenant's `farmId`, it returned that tenant's ledger. | Scope derives from verified membership. Out-of-scope `farmId` → 403. No `farmId` → the caller's farms only. Worker → 403. |
| **Finance write** | `farmId` copied from the body; no ownership check; no audit trail. | Body `farmId` must be in the caller's `writable` set or 403. `createdById` is the authenticated actor. Every mutation writes an audit record (no amounts, no notes). |
| **Farm directory** | Full list to every owner/moderator. | Caller's farms only. |
| **Upload serving** | `@fastify/static` served `uploads/` publicly with **no authorization at all**, on a version with three advisories including guard bypass. | Own handler. Canonical-name check, then authentication **or** a short-lived path-bound ticket. `nosniff`, `default-src 'none'; sandbox`, inline disposition, `no-store`. |
| **Upload storage** | Client-controlled extension interpolated into the path. | Server-chosen canonical extension plus an explicit containment proof. |
| **Rust signature check** | `sign(payload) != sig` — short-circuits on the first differing byte, with a doc comment falsely claiming constant time. | `Mac::verify_slice()`, genuinely constant time. Comment corrected. |
| **Traceability** | None. | `X-Correlation-Id` on every response; every denial logged with it and with no secret, token, message body, financial detail or personal data. |

### Deliberate containment decisions

1. **`@fastify/static` was removed, not upgraded.** GHSA-x428-ghpx-8j92 and
   GHSA-8pvw-jcv7-9cmj describe *guard bypass*, so fronting the plugin with a
   `preHandler` would not have been sound. The two-major-version bump (backlog
   decision **D-7**) is **not approved**, so upgrading was out of Wave 0 policy.
   Removing the plugin from the request path closes the advisory outright.
2. **Media remains reachable, via tickets.** `<img src>` and
   `<Image source={{uri}}>` cannot send an `Authorization` header. Rather than
   silently breaking media, `POST /media/ticket` issues a 5-minute,
   filename-bound HMAC ticket. Functionality is preserved *and* authorized.
   Client adoption is still outstanding — see §8.
3. **Read denials return 404, write denials return 403.** This follows the
   repository's own existing convention (`security.test.ts` documents "404, not
   403, to avoid probing" for tasks) and preserves existing write-path tests.
4. **Signature changes over added checks.** Making `userId` a required
   parameter turns any future omission into a compile error.

---

## 5. Tests added

### `webapp/server-node/test/wave0.test.ts` — new, 33 tests

| Required test | Covering test |
|---|---|
| Startup fails when the auth secret is missing | `startup fails when the auth secret is missing outside development` |
| Startup fails for known placeholder values | `startup fails for known placeholder values in EVERY environment` — every entry, case- and whitespace-varied |
| Valid secret permits startup | `a valid secret permits startup and is returned verbatim` |
| Forged / stale tokens rejected after rotation | `tokens forged with the burned literal are rejected`; `stale tokens signed with a previous key are rejected after rotation` |
| Non-member cannot list conversation messages | `a non-member cannot list conversation messages` |
| Non-member cannot use alternate retrieval | `a non-member cannot use the alternate (translation) retrieval path` |
| Unauthorized request does not invoke translation provider | `an unauthorized request never reaches the paid translation provider` (spy on the provider) |
| Authorized member can access the conversation | `an authorized member can read the intended conversation` |
| Farm A cannot read Farm B finances | `a user cannot read another farm's finances`; `...finance summary` |
| Farm A cannot write Farm B finances | `a user cannot write to another farm's ledger` (also asserts nothing was appended) |
| Caller cannot create ownership via body | `a caller cannot create ownership through request-body manipulation`; `the recorded author is the authenticated actor, not the body value` |
| Authorized finance operation still works | `an authorized finance operation still works end to end` |
| Path traversal rejected | `path traversal attempts are rejected before any filesystem access` — 11 vectors incl. `..\`, absolute, NUL byte, percent-encoded, `....//` |
| Unauthorized upload retrieval rejected | `unauthorized upload retrieval is rejected` |
| Legitimate static assets still work | `a legitimate stored asset is retrievable by an authenticated caller` (both Bearer and ticket) |
| Security logs contain no secrets | `security logging emits a correlation id and no secret value` |

Plus: non-enumeration equivalence (`denied.body === missing.body`), module-boundary
enforcement for both chat functions, ticket non-transferability and expiry,
`saveMedia` extension rejection, unauthenticated finance access, worker least
privilege, and boot-description non-disclosure.

### `webapp/server-rust/src/auth.rs` — new `mod tests`, 6 tests

`production_refuses_missing_secret` · `every_environment_refuses_the_published_literal`
· `refuses_short_and_trivially_weak_secrets` · `accepts_a_strong_operator_supplied_secret`
· `development_mints_a_random_key_not_the_literal` · `legacy_signed_tokens_do_not_verify`

### Existing tests updated

| File | Change |
|---|---|
| `test/security.test.ts` | The dev-fallback test asserted `resolveAuthSecret('development', undefined) === INSECURE_LEGACY_SECRET`. Rewritten to assert an ephemeral, non-legacy, process-stable key. `refuses the published development secret in production` broadened to **every** environment. |
| `test/phases.test.ts` | `listMessages(conv.id)` → `listMessages(conv.id, 'w1')`. `outsiders cannot read or write a thread` extended to assert the **read** path also rejects. |

**No test file contains a real secret.** The only literal secret material is the
burned development literal, present solely to prove it is now rejected.

---

## 6. Commands executed

Commands were discovered from `package.json`, `Cargo.toml`, `vitest.config.ts`
and `.github/workflows/ci.yml`. Nothing was invented.

| # | Command | Directory |
|---|---|---|
| 1 | `git rev-parse HEAD` / `git status --short` | repo root |
| 2 | `npm run check` (`tsc --noEmit`) | `webapp/server-node` |
| 3 | `npx vitest run` | `webapp/server-node` |
| 4 | `npm run test:coverage` (`vitest run --coverage`) | `webapp/server-node` |
| 5 | `npm install` | `webapp/server-node` |
| 6 | `npm audit` / `npm audit --json` / `npm audit --omit=dev` | `webapp/server-node` |
| 7 | `cargo test` | `webapp/server-rust` |
| 8 | `npx tsc --noEmit` | `webapp/client` |
| 9 | `npx vitest run` | `webapp/client` |
| 10 | `npm run build` (`vite build`) | `webapp/client` |

### Commands that do not exist in this repository

Per "do not invent commands", the following were requested but have **no
definition** in any manifest, task file, CI workflow or document:

- **Formatting** — no `format` script, no Prettier/rustfmt config. Style was
  preserved by hand.
- **Linting** — no `lint` script, no ESLint/Clippy configuration.
- **Integration tests** — no separate integration suite; `vitest` covers both
  unit and route-level (`app.inject`) tests in one run.
- **Secret scanning** — no gitleaks/trufflehog configuration. The only control
  is a single `grep` gate in `ci.yml`, which **excludes `security/config.ts`
  and does not cover `server-rust` at all** — it would not have caught SEC-C01.
  See §8.
- **Production build (server)** — the Node server runs via `tsx`; there is no
  build step. The client build is item 10.

---

## 7. Results

| Check | Result |
|---|---|
| `npm run check` (server-node) | **Pass** — 0 errors |
| `npx vitest run` (server-node) | **153 / 153 passed**, 5 files, 0 failed |
| `npm run test:coverage` | **Pass** — thresholds met. Statements 74.34% (2426/3263) · Branches 72.81% (616/846) · Functions 70.33% (166/236) · Lines 74.34% |
| `cargo test` (server-rust) | **20 / 20 passed**, 0 failed. Compiles clean; only pre-existing unused-import warnings remain |
| `npx tsc --noEmit` (client) | **Pass** — 0 errors |
| `npx vitest run` (client) | **2 / 2 passed** |
| `npm run build` (client) | **Pass** — built in 1.17s |
| `npm audit --omit=dev` (server-node) | **found 0 vulnerabilities** |
| `npm audit` (server-node, incl. dev) | 6 remaining — all in the `vitest`/`vite`/`vite-node`/`esbuild`/`@vitest/mocker`/`@vitest/coverage-v8` **devDependency** chain. See §8 |

Node test count moved from a **119-test** baseline to **153** (+34). Rust moved
from **14** to **20** (+6). **No previously passing test was disabled, skipped
or weakened.**

---

## 8. Remaining risks

| # | Risk | Severity | Note |
|---|---|---|---|
| 1 | **Media rendering is broken in the clients until they adopt `POST /media/ticket`.** `mobile-app/src/services/chatService.ts:85,148` builds `${BASE_URL}${mediaUrl}` for a bare `<Image>`; the web client renders `<img src>`. These now receive **401**. | High (functional) | Deliberate and documented, not silent. The server-side path is complete; only client adoption remains. Fix in the next wave. |
| 2 | The **Rust trail still serves `uploads/` via `ServeDir` as an unauthenticated fallback** for all unmatched routes. | High | Not fixed here: the Node trail is the production-reachable one (client and mobile both target it) and Rust has no deployment configuration. Fixing it requires tower middleware — architectural work outside Wave 0. |
| 3 | 6 advisories remain in the **dev-only** `vitest`/`vite`/`esbuild` chain (GHSA-67mh-4wv8-2f99 et al.). | Low | Not production-reachable. The fix is `vitest@4`, a breaking major bump — outside the "safe, compatible patch" policy for this wave. |
| 4 | **No token revocation.** Rotation is all-or-nothing and forces a global re-login. | Medium | Key-id / dual-key and `jti` deny-list are noted in the runbook roadmap. |
| 5 | The **CI secret-scanning gate is inadequate** — one `grep` that excludes `security/config.ts` and never looks at `server-rust`. It would not have detected SEC-C01. | Medium | Needs a real scanner. Also, CI has **never run** (no remote). |
| 6 | `SEC-M06` — `requirePermission()` with no action performs **authentication only**. Correct where used here (the finance handlers make the authorization decision explicitly and that is commented), but it is an easy footgun elsewhere. | Medium | Audit every remaining call site in a later wave. |
| 7 | **SEC-H05 / H07 / H08 / H10 were never re-verified** in this wave. | Unknown | Out of Wave 0 scope. |
| 8 | The **SEV-1 busboy backslash question** from the audit remains unanswered. | Unknown | Open question; carried forward. |
| 9 | Payments/subscription controls remain **documented only**, not implemented. | Unknown | Carried forward. |
| 10 | The finance store is still an **in-memory array**. Tenant scoping is enforced in the route layer; there is no database-level row policy. | Medium | Correct for the current architecture; revisit with the Postgres migration. |

---

## 9. Manual operational actions still required

These **cannot** be done in code and Wave 0 is not operationally complete
without them.

1. **Rotate `AUTH_SECRET` in every environment.** Generate it outside the
   repository (`openssl rand -hex 32`), store it in the secret manager, and
   deliver it to **both** the Node and Rust processes. Full procedure:
   [specs/SECRET_ROTATION_RUNBOOK.md](specs/SECRET_ROTATION_RUNBOOK.md).
2. **Treat every token issued before rotation as forged.** The old key was
   public; a valid signature proves nothing for that period.
3. **Restart both backends** and confirm the boot line reports
   `source=environment` with the expected length. If it says
   `ephemeral-development`, the variable did not reach the process.
4. **Notify users that they must sign in again.** All sessions are invalidated
   by design.
5. **Review authentication and finance access logs** for the exposure window,
   using the new `X-Correlation-Id`.
6. **Initialise a git repository and configure a remote** so a baseline commit
   exists, CI can actually run, and rollback by revert becomes possible
   (VAL-018).
7. **Configure real secret scanning** in CI to replace the single grep gate.

---

## 10. Rollback steps

**`git revert` is not available** — there is no git repository (§1). Rollback
must be performed manually, and doing so **reopens all six critical findings**.

Ordered, lowest-risk first:

| Step | Action | Effect |
|---|---|---|
| A | Set a valid `AUTH_SECRET` in every environment | Reverses nothing, but removes any startup failure caused by configuration. **Try this before rolling back code.** |
| B | Restore `webapp/server-node/src/routes/farmsFinance.ts` | Reopens SEC-C04 and SEC-C05 |
| C | Revert `chat.ts` + `routes/features.ts` | Reopens SEC-C02, SEC-C03, VAL-007 |
| D | Re-add `@fastify/static` to `package.json`, `npm install`, restore the `fastifyStatic` registration in `index.ts`, delete `src/security/media.ts` | Reopens VAL-008, VAL-009 and DEP-01 |
| E | Restore `security/config.ts`, `server-rust/src/auth.rs`, `server-rust/src/security.rs`, `server-rust/src/main.rs` | **Reopens SEC-C01 — do not do this.** The old secret is public; restoring the fallback restores universal token forgery |

Partial rollback is supported: the finance, chat, upload and secret changes are
independent. **If any rollback is performed, rotate `AUTH_SECRET` again
afterwards.**

A safer alternative to step D, if media access must be restored immediately:
keep the new handler and temporarily widen only the ticket TTL. Do **not**
restore unauthenticated static serving.

---

## 11. Evidence that no secret values were committed

| Check | Evidence |
|---|---|
| No new secret generated in the repository | The only generated keys are **runtime-only**: `randomBytes(32)` in `developmentSecret()` and `Uuid::new_v4()` in `generate_ephemeral_secret()`. Neither is written to disk, serialized or logged. |
| No secret in source | Both trails read `AUTH_SECRET` from the environment. The legacy literal remains **only** as a deny-list entry in `PLACEHOLDER_SECRETS` — it is never returned as a usable secret, and supplying it now **prevents startup in every environment**. |
| No secret in logs | `describeAuthSecret()` / `describe_secret()` return `{ source, env, length }`. `SecurityConfigError` and `SecretError` messages describe the defect and never carry the value. `SecretError` structurally cannot hold it — the variants have no payload. |
| No secret in tests | The only literal is the burned `INSECURE_LEGACY_SECRET`, used solely to prove rejection. Test-only strong values are throwaway strings never used by any environment. |
| No secret in this report or the runbook | Neither document contains a secret value. The runbook instructs operators to generate one **outside** the repository. |
| Asserted, not just claimed | `wave0.test.ts` → `the boot description never exposes the secret value` and `security logging emits a correlation id and no secret value`, which captures `process.stdout` during a denial and asserts the output contains no legacy secret, no bearer token and no `AUTH_SECRET=`. |
| No token/credential logging introduced | Every new `log.warn` emits only a correlation id, an actor id, a requested resource id and a reason code. No message bodies, no amounts, no notes, no headers. |

---

## 12. Acceptance criteria

| Criterion | Status |
|---|---|
| No hardcoded signing secret or insecure fallback remains | **Met** — both trails |
| Startup rejects unsafe authentication configuration | **Met** — `SecurityConfigError` (Node), panic in `auth::init()` (Rust) |
| Chat endpoints enforce membership before data access **and** before provider calls | **Met** — asserted by test |
| Finance endpoints enforce tenant and farm boundaries | **Met** — read and write, with least privilege per persona |
| Production-reachable static-file risk patched or safely contained | **Met** — plugin removed from the request path; `npm audit --omit=dev` reports 0 |
| Denied-access tests pass | **Met** |
| Existing authorized behaviour passes regression tests | **Met** — 153/153 Node, 20/20 Rust, 2/2 client, client build green |
| No secrets in source, logs, tests or reports | **Met** — §11 |
| All executed verification results recorded | **Met** — §6, §7 |
| Operational rotation still outstanding | **Open by design** — §9, operator action |
