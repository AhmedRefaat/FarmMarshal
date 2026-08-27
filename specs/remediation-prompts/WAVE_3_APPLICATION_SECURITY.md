# Wave 3 — Application Security Hardening

> **Implementation prompt.** Planning artefact — no production file modified in
> producing it.

---

## 1. Role

You are a senior application security engineer covering server, browser, and
mobile surfaces. Your mandate is to close the input, file, session, and client-side
gaps that remain after the authorization and persistence foundations are in place.

---

## 2. Objective

1. Enforce input validation at every boundary.
2. Complete file and media security end to end.
3. Apply browser security controls.
4. Protect mobile local data and transport.
5. Implement session lifecycle and revocation.
6. Add rate limiting, request limits, and safe error handling.

---

## 3. Verified findings in scope

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| **VAL-007** | High (rescoped) | Two upload routes bypass `validateUpload()` | [features.ts:211](webapp/server-node/src/routes/features.ts#L211), [:244](webapp/server-node/src/routes/features.ts#L244) |
| **VAL-008** | High, medium confidence | Client-controlled MIME substring reaches `join()` | [index.ts:50-55](webapp/server-node/src/index.ts#L50) |
| **VAL-009** | High (confidentiality only) | `/uploads/*` served without authorization | [index.ts:85-94](webapp/server-node/src/index.ts#L85) |
| **VAL-010** | Medium | `NaN` and `Infinity` pass finance validation | [farmsFinance.ts:74-77](webapp/server-node/src/routes/farmsFinance.ts#L74) |
| **VAL-011** | Medium (was High) | Non-null assertions and unhandled parser errors → 500 | [features.ts:176](webapp/server-node/src/routes/features.ts#L176), [:229](webapp/server-node/src/routes/features.ts#L229) |
| **VAL-012** | High | Plaintext password in AsyncStorage | [webApi.ts:28-31](mobile-app/src/services/webApi.ts#L28) |
| **VAL-013** | High | Hardcoded cleartext HTTP origin; no `eas.json` | [webApi.ts:18](mobile-app/src/services/webApi.ts#L18) |
| **VAL-015** | Medium | WebSocket token in query string | [features.ts:311-313](webapp/server-node/src/routes/features.ts#L311) |
| **SEC-M01** | Medium | No token revocation; 7-day TTL | `auth.ts` |
| **SEC-M05** | Medium | No password reset or account lockout | Carried forward |
| **API-01 / API-02** | Medium | No OpenAPI contract; no runtime schema validation | Carried forward |
| **WEB-03 / WEB-06** | Medium | No HSTS; no application CSP | Carried forward |

---

## 4. Files and components in scope

| File | Change |
|---|---|
| [webapp/server-node/src/index.ts](webapp/server-node/src/index.ts) | `saveMedia` containment; security headers; error handler |
| [webapp/server-node/src/routes/features.ts](webapp/server-node/src/routes/features.ts) | Upload validation; error handling; WS ticket |
| [webapp/server-node/src/security/uploads.ts](webapp/server-node/src/security/uploads.ts) | Extension allow-list; canonical extension derivation |
| [webapp/server-node/src/routes/farmsFinance.ts](webapp/server-node/src/routes/farmsFinance.ts) | Numeric and currency validation |
| [webapp/server-node/src/auth.ts](webapp/server-node/src/auth.ts) | Session lifecycle, revocation, refresh |
| `webapp/server-node/src/routes/media.ts` (new) | Authorized media delivery |
| [mobile-app/src/services/webApi.ts](mobile-app/src/services/webApi.ts) | Secure storage; HTTPS enforcement |
| `mobile-app/eas.json` (new) | Build configuration |
| [webapp/client/src/api.ts](webapp/client/src/api.ts) | Token handling alignment |

---

## 5. Explicit exclusions

| Excluded | Reason |
|---|---|
| **"Unbounded memory via `toBuffer()`"** | **False positive.** Refuted by the global `fileSize` limit at [index.ts:80](webapp/server-node/src/index.ts#L80) |
| **"Stored XSS via `/uploads/`"** | **False positive.** Refuted by `default-src 'none'; sandbox`, `nosniff`, and `Content-Disposition: inline` at [index.ts:88-93](webapp/server-node/src/index.ts#L88) |
| Claim regarding `client/dist/` | Withdrawn by the audit's own correction |
| Claim that `firebase-admin` ships to clients | Withdrawn — it is a devDependency in both manifests |
| IoT, payments, object storage | Wave 4 |
| Dependency upgrades | Wave 4 |
| Authorization model changes | Wave 1 — completed |

> Do not reintroduce excluded items. They were examined and refuted with evidence.

---

## 6. Prerequisites

| # | Prerequisite | Blocking |
|---|---|---|
| 1 | Waves 0, 1, 2 complete | **Yes** |
| 2 | Durable storage available | **Yes** — sessions and rate-limit state need it |
| 3 | **SEV-1 answered: does busboy permit backslashes in a part's `Content-Type`?** | **Yes for VAL-008 severity** — but implement containment regardless |
| 4 | **D-4: media storage target** | Partial — affects task 3.3 |
| 5 | TLS terminator identified | Yes — HSTS must be set where TLS terminates |
| 6 | Mobile release channel available for testing | Yes |

> SEV-1 determines whether VAL-008 is arbitrary file write or a benign extension
> quirk. **Implement path containment now either way** — the fix is small and the
> question does not need to be answered first to justify it.

---

## 7. Required implementation sequence

```
3.1  Path containment + extension allow-list      ← highest severity
3.2  Upload validation on the two bypassing routes
3.3  Authorized media delivery
3.4  Numeric, currency, and general input validation
3.5  Error handling and correct status codes
3.6  Session lifecycle and revocation
3.7  Rate limiting and request limits
3.8  Browser security controls
3.9  Mobile local-data protection and transport
```

### Task 3.1 — Path containment

**Symbol:** `saveMedia`, [index.ts:50-55](webapp/server-node/src/index.ts#L50)

The extension is derived from a client-controlled MIME string and interpolated
into a filename that is then passed to `join()`.

1. **Never derive the stored extension from client input.** Map from the
   *verified* magic-byte type in `security/uploads.ts` to a canonical extension.
2. Apply a strict allow-list; reject anything unmapped.
3. Resolve the final path and assert it remains under `UPLOAD_DIR` — defence in
   depth even after the allow-list.
4. Apply the same treatment at [features.ts:213](webapp/server-node/src/routes/features.ts#L213)
   and [:246](webapp/server-node/src/routes/features.ts#L246).

### Task 3.2 — Upload validation coverage

`validateUpload()` at [uploads.ts:70](webapp/server-node/src/security/uploads.ts#L70)
already performs magic-byte checking correctly. Two routes never call it. Call it
on **every** upload path and add a test that fails if a new route omits it.

### Task 3.3 — Authorized media delivery

Static serving has no authorization. Anyone with a UUID reads any file. The
existing headers already prevent script execution — this is a **confidentiality**
fix only.

Replace static serving with an authenticated route that resolves the media record,
checks tenancy through the Wave 1 authorization layer, and streams the file.
Preserve the existing `nosniff`, CSP, and `Content-Disposition` headers.

### Task 3.4 — Input validation

- `typeof b.amount !== 'number'` passes `NaN` and `Infinity`. Use
  `Number.isFinite`, and add an upper bound.
- Validate `currency` against ISO 4217; store integer minor units.
- Replace free-form `type` and `category` with allow-lists.
- Adopt a runtime schema validator at every route boundary (API-02) and generate
  the OpenAPI contract from it (API-01).

### Task 3.5 — Error handling

Replace non-null assertions with explicit 404s. Wrap multipart parsing so a
size-limit rejection returns **413**, not 500. Add a global error handler that
never returns stack traces or internal identifiers.

### Task 3.6 — Session lifecycle

Tokens are stateless with a 7-day TTL and no revocation — **a compromised token
cannot be invalidated**. Introduce short-lived access tokens plus a revocable
refresh token backed by the Wave 2 store, `jti` tracking, logout, revoke-all, and
invalidation on password change. Add lockout with backoff and a password-reset
flow with single-use, expiring, hashed tokens (SEC-M05).

### Task 3.7 — Rate limiting

Per-IP and per-account limits on login, reset, uploads, and paid-provider calls —
the translation route in particular, since it bills externally. Enforce request
body and header size limits.

### Task 3.8 — Browser controls

HSTS with `includeSubDomains` at the TLS terminator; an application CSP distinct
from the uploads CSP; `Referrer-Policy`; `Permissions-Policy`; and a review of
token storage in the client.

### Task 3.9 — Mobile

Remove plaintext credential storage entirely — store a refresh token in
`expo-secure-store`, never the password. Replace the hardcoded
`http://localhost:3000` with per-environment configuration; enforce HTTPS in
release builds; create `eas.json`; disable Android cleartext traffic; consider
certificate pinning.

---

## 8. Security invariants

| # | Invariant |
|---|---|
| **I-1** | No client-supplied value influences a filesystem path |
| **I-2** | Every stored file passed magic-byte validation |
| **I-3** | Media requires the same authorization as its parent resource |
| **I-4** | Numeric input is finite, bounded, and typed |
| **I-5** | Error responses never disclose internal detail |
| **I-6** | A session can be revoked and takes effect immediately |
| **I-7** | Passwords are never persisted on a device |
| **I-8** | Release builds refuse cleartext transport |
| **I-9** | Wave 0, 1, and 2 invariants continue to hold |

---

## 9. Exact expected code changes by file and symbol

| File | Symbol | Change |
|---|---|---|
| `index.ts` | `saveMedia` | Extension from verified type; path containment |
| `index.ts` | `fastifyStatic` | Removed for uploads; replaced by an authorized route |
| `index.ts` | global error handler | New; sanitised responses |
| `security/uploads.ts` | `EXTENSION_MAP` (new) | Verified-type → canonical extension |
| `security/uploads.ts` | `validateUpload` | Returns the canonical extension |
| `features.ts` | media and evidence uploads | Call `validateUpload`; handle errors |
| `features.ts` | `conversations.get(id)!` | Explicit 404 |
| `features.ts` | `/ws` | Short-lived ticket instead of a query-string token |
| `farmsFinance.ts` | amount, currency, type, category | Full validation |
| `auth.ts` | token issue and verify | Access + refresh; `jti`; revocation |
| `routes/media.ts` | new | Authorized streaming |
| `webApi.ts` | `setWebCredentials`, `restoreApiSession` | Secure store; no password |
| `eas.json` | new | Per-environment configuration |

---

## 10. Secure structured logging

| Event | Level | Fields |
|---|---|---|
| Upload rejected: type | warn | route, declared type, verified type, actor |
| **Path containment triggered** | **error + alert** | route, actor — this indicates an attack |
| Media access denied | warn | media id, actor, owning farm |
| Validation rejected | info | route, field name, reason class |
| Lockout triggered | **warn + alert** | account ref, source class |
| Session revoked | info + audit | actor, reason, `jti` |
| Rate limit exceeded | warn | route, actor or IP class |

**Never log:** file contents, filenames verbatim, passwords, tokens, reset tokens,
or full request bodies.

---

## 11. Tests to write before or with the changes

- Traversal attempts via the MIME field — `../`, `..\`, absolute paths, null bytes,
  double encoding — all rejected, with the resolved path asserted inside `UPLOAD_DIR`
- Every upload route rejects a renamed executable and a polyglot file
- A test that **enumerates upload routes and fails if any omits `validateUpload`**
- Media requested by a non-member → 403
- Finance: `NaN`, `Infinity`, `-0`, `1e308`, `"5"` → 400
- Currency: unknown code → 400
- Unknown conversation → 404, not 500
- Oversized upload → 413, not 500
- Error responses contain no stack trace
- Logout invalidates immediately; revoke-all works; password change invalidates
- Lockout after N failures with backoff
- Reset token: single use, expiring, hashed at rest
- Rate limits return 429 with `Retry-After`
- WebSocket ticket: single use, short expiry, not in the URL
- Mobile: no password in storage; release build rejects `http://`

---

## 12. Commands to run

```powershell
cd webapp/server-node
npm run check
npm run test
npm run test:coverage
npm run test:integration

cd ../client
npx tsc --noEmit
npx vitest run
npm run build

cd ../../mobile-app
npx tsc --noEmit
npx vitest run
npx expo-doctor
```

---

## 13. Expected output

| Command | Expected |
|---|---|
| `npm run check` | Exit 0 |
| `npm run test` | Exit 0; all prior tests plus the new suites |
| `npm run test:coverage` | Exit 0; **raise `src/security/**` thresholds in this wave** — that is where the fixes live |
| `npm run build` | Exit 0 |
| `npx expo-doctor` | No cleartext or configuration warnings |

---

## 14. Verification checklist

- [ ] SEV-1 answered and recorded, **or** containment shipped regardless
- [ ] No client value reaches a path
- [ ] Every upload route validates content
- [ ] Media requires authorization
- [ ] `NaN` and `Infinity` rejected
- [ ] No non-null assertion on a lookup remains
- [ ] Sessions revocable; logout effective immediately
- [ ] Lockout and reset implemented
- [ ] Rate limits on login, reset, upload, and paid providers
- [ ] HSTS and application CSP present
- [ ] No password on any device
- [ ] `eas.json` present; cleartext disabled in release builds
- [ ] OpenAPI contract generated from runtime schemas

---

## 15. Regression checklist

- [ ] All Wave 0, 1, 2 tests pass
- [ ] Legitimate uploads of each supported type still succeed
- [ ] Media renders correctly for authorized users
- [ ] Finance entry creation works for valid input
- [ ] **Login and session refresh work across web and mobile — session changes are the most user-visible risk in this wave**
- [ ] Chat and WebSocket reconnection work
- [ ] Rate limits do not trip under normal use

---

## 16. Rollback plan

| Task | Rollback |
|---|---|
| 3.1–3.2 | Revert; **Wave 0 containment does not cover these routes** — assess exposure before reverting |
| 3.3 | Restore static serving temporarily; confidentiality gap returns |
| 3.4–3.5 | Low risk; revert freely |
| 3.6 | **Highest user-visible risk.** Ship behind a flag; support both token forms during transition |
| 3.7 | Raise limits or disable per route |
| 3.9 | Mobile rollback requires a new build — **stage to internal testers first** |

---

## 17. Evidence to capture

Under `specs/evidence/wave-3/`:

1. SEV-1 answer with the busboy behaviour test
2. Traversal test results with resolved paths
3. Upload validation coverage proof across all routes
4. Media authorization test results
5. Input validation boundary results
6. Session revocation timing demonstration
7. Rate limit and lockout demonstrations
8. Security header capture from a live response
9. Mobile storage inspection showing no credentials
10. Full command output redirected to files

---

## 18. Acceptance criteria

1. All invariants in §8 hold.
2. No path is influenced by client input.
3. All uploads content-validated; media authorized.
4. Input validation complete at every boundary.
5. Sessions revocable with lockout and reset.
6. Rate limits active on all sensitive routes.
7. Browser and mobile controls verified on real builds.
8. Security review sign-off.

---

## 19. Stop conditions

| Condition | Action |
|---|---|
| Traversal test succeeds after the fix | **Stop.** Treat as Critical; contain immediately |
| Any upload route found without validation after task 3.2 | **Stop.** The enumeration test is wrong |
| Session change locks out real users | **Stop.** Roll back the flag |
| Mobile release build still permits cleartext | **Stop.** Do not release |
| Rate limiting trips legitimate traffic | **Stop.** Re-tune before proceeding |
| Anyone reintroduces an excluded false positive | **Stop.** Point to the validation evidence |

---

## 20. Handover to Wave 4

| Deliverable | Consumed by |
|---|---|
| Authorized media route | Object storage migration |
| Rate limiting | Webhook and device endpoint protection |
| Session lifecycle | Device identity model |
| OpenAPI contract | Contract testing; Rust parity if D-1 retained both |
| Validation patterns | Device command payload validation |
| Idempotency handling | Payment webhook processing |

**Open questions carried forward:** media storage target (D-4), certificate
pinning rotation strategy, whether refresh tokens should rotate on every use.
