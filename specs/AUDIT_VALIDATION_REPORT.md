# Audit Validation Report

**Review date:** 2026-08-27
**Reviewer role:** Senior application security engineer (independent validation pass)
**Subject:** `specs/CYBERSECURITY_AUDIT.md`, `specs/DATABASE_ARCHITECTURE_AUDIT.md`,
`specs/DATABASE_INTEGRATION_TRACEABILITY.md`, `specs/CYBERSECURITY_AND_DATABASE_REMEDIATION_PLAN.md`
**Repository:** `c:\BMW_Work\Workspace\Scripts\WebApp_Demp`
**Repository files modified during this review:** **none**

---

## 1. Executive conclusion

The original audit is **substantially accurate**. Every one of the six Critical
findings was re-verified against source in this pass and **all six are confirmed
as real, reachable, and correctly characterised**. The audit does not appear to
have manufactured findings, and its two self-corrections (the withdrawn
`client/dist/` claim and the `firebase-admin` devDependency correction) were
appropriate.

However, the audit **overstated two High findings** by failing to account for a
mitigating control that exists in middleware, and it **missed at least two
findings**, one of which may be more severe than several it did report.

| Category | Count |
|---|---|
| Confirmed as stated | 12 |
| Confirmed with revision (severity or scope) | 4 |
| Unsupported / not re-verified in this pass | 6 |
| False positive (sub-claim level) | 2 |
| Newly discovered | 3 |
| Unresolved questions | 14 |

**The single most important correction:** the audit's characterisation of
unbounded file uploads is wrong. A global `@fastify/multipart` size limit at
[index.ts:79-81](webapp/server-node/src/index.ts#L79) caps **every** multipart
route at `MAX_UPLOAD_BYTES`. The real defect on the two flagged routes is missing
**content validation**, not missing **size** limits. SEC-H09 should drop from High
to Medium as a result.

**The most important omission:** `saveMedia()` builds a filename from a
fully client-controlled MIME substring with no sanitisation, and joins it to a
directory path. On Windows this is a plausible arbitrary-file-write primitive.
The audit read the surrounding lines and did not notice it.

---

## 2. Repository and architecture overview

Observed facts, established by direct inspection in this pass.

| Property | Observation |
|---|---|
| Root VCS | **No git repository at root.** `git rev-parse` returns *fatal: not a git repository*. Confirms DSO-01 |
| `mobile-app` VCS | Independent repository, branch `main`, working tree dirty (`App.tsx`, `app.json`, `package.json` modified; many `._*` AppleDouble files untracked) |
| Backends | Two: `webapp/server-node` (Fastify 5, TypeScript ESM) and `webapp/server-rust` (Axum) |
| Clients | `webapp/client` (React 18 + Vite), `mobile-app` (Expo / React Native) |
| Auth model | Stateless HMAC-SHA256 token, `base64url(payload).base64url(sig)`, 7-day TTL, **byte-compatible across both backends** ([auth.rs:1-5](webapp/server-rust/src/auth.rs#L1)) |
| Authorization model | `requirePermission(action?, getResource?)` preHandler → `buildActorContext()` → `can()` |
| Database layer | **None.** No driver, no pool, no migrations. Confirmed by absence in both manifests |
| Deployment config | **None found.** No Dockerfile, IaC, or environment manifest |
| Route registration | [index.ts:106-114](webapp/server-node/src/index.ts#L106) registers 9 route modules |

### 2.1 Controls that DO exist (relevant to validating claims)

These were verified present and are load-bearing for several severity revisions:

- **CORS allow-list** — `resolveCorsOrigins()` at [index.ts:75](webapp/server-node/src/index.ts#L75)
- **Global multipart limits** — `fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10, fieldSize: 64KB` at [index.ts:79-81](webapp/server-node/src/index.ts#L79)
- **Static-media hardening** — `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Content-Disposition: inline` on `/uploads/` at [index.ts:85-94](webapp/server-node/src/index.ts#L85)
- **Global response headers** — `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-site` at [index.ts:97-104](webapp/server-node/src/index.ts#L97)
- **Magic-byte upload validation** — `validateUpload()` exists at `webapp/server-node/src/security/uploads.ts:70` and **is applied at [index.ts:167](webapp/server-node/src/index.ts#L167)** for `/tasks/:id/photos` only
- **Fail-closed authorization default** — `default: return false; // deny unknown actions` at [authz.ts:158](webapp/server-node/src/authz.ts#L158)
- **Denial logging** — `log.warn('permission denied', …)` provides IDOR/brute-force detectability

---

## 3. Audit methodology

1. Established repository and branch state before any assessment.
2. Read each Critical and High claim in the original audit.
3. Opened the exact cited file and line range for each; did not rely on the
   audit's own quotation.
4. For each confirmed pattern, separately established **reachability** by
   verifying route registration in `index.ts`.
5. Searched middleware, plugin registration, and shared security utilities for
   compensating controls before accepting any severity.
6. Explicitly attempted to falsify the audit's central authorization claim
   (see §4.1).
7. No exploit was executed. No destructive action was taken. No service was
   contacted. No credential value is reproduced in this report.

---

## 4. Confirmed findings

### 4.1 The decisive verification: `requirePermission()` semantics

This deserves separate treatment because a contradictory note existed in the
reviewer's own working memory, and the entire severity of SEC-C02/C03 depends on
resolving it.

- **Claim A (original audit):** `requirePermission()` with no action performs
  authentication only.
- **Claim B (a stale working note):** it evaluates `can()` with an empty resource
  and therefore denies all non-admins.

**Claim A is correct. Claim B is false.** [authz.ts:190](webapp/server-node/src/authz.ts#L190)
wraps the entire permission evaluation in `if (action) { … }`. When no action is
supplied the block is skipped and the request proceeds with only a session check.
The function's own doc comment states *"skipped when no action given = auth-only"*.

Claim B describes a different scenario — an action supplied *without* a
`getResource`, which yields `resource = {}` and fails farm-scoped checks. That is
a real but separate behaviour and does not apply to the bare-call routes.

**Consequence:** SEC-C02 and SEC-C03 retain Critical severity.

### 4.2 Confirmed without change

| ID | Verification |
|---|---|
| **SEC-C02** | [features.ts:184](webapp/server-node/src/routes/features.ts#L184) `GET /v2/chat/:id/messages` uses bare `requirePermission()`. [chat.ts:181](webapp/server-node/src/chat.ts#L181) `listMessages(conversationId)` takes **no user parameter** and cannot perform a membership check. `assertMember` exists at [chat.ts:126](webapp/server-node/src/chat.ts#L126) and is called by `sendMessage`, `setPin`, `react` — the asymmetry is exactly as reported. Reachable via `featureRoutes` at index.ts:114. **Confirmed Critical.** |
| **SEC-C03** | [chat.ts:227](webapp/server-node/src/chat.ts#L227) `messageInLang(messageId, targetLang)` calls only `requireMessage()`. Route at [features.ts:196](webapp/server-node/src/routes/features.ts#L196) is bare `requirePermission()`. Reaches a paid provider via `activeTranslator()`. **Confirmed Critical.** |
| **SEC-C04** | [farmsFinance.ts:54](webapp/server-node/src/routes/farmsFinance.ts#L54) — filter predicate is `(!q.farmId \|\| e.farmId === q.farmId)`. Omitting `farmId` returns the full ledger. Identical pattern at [farmsFinance.ts:94](webapp/server-node/src/routes/farmsFinance.ts#L94). The file imports only `requireRole` from `../auth.js` — **`authz.ts` is not imported at all**. Registered at index.ts:111. **Confirmed Critical.** |
| **SEC-C05** | [farmsFinance.ts:67](webapp/server-node/src/routes/farmsFinance.ts#L67) — `farmId: b.farmId` taken directly from the request body with no membership check. **Confirmed Critical.** |
| **SEC-H01** | [farmsFinance.ts:51](webapp/server-node/src/routes/farmsFinance.ts#L51) returns the module-level `farms` array unfiltered. The source comment concedes *"moderator their scope — demo: all"*. **Confirmed High.** |
| **SEC-H04** | [webApi.ts:29-31](mobile-app/src/services/webApi.ts#L29) `setWebCredentials` writes `JSON.stringify({email, password})` to AsyncStorage. Restored at [webApi.ts:43-45](mobile-app/src/services/webApi.ts#L43). AsyncStorage is unencrypted. **Confirmed High.** |
| **SEC-H06** | [webApi.ts:18](mobile-app/src/services/webApi.ts#L18) `export const BASE_URL = 'http://localhost:3000';` — cleartext, compile-time constant. **Confirmed High.** |
| **SEC-M12** | [features.ts:311-313](webapp/server-node/src/routes/features.ts#L311) `/ws` reads the token from `request.query`. **Confirmed Medium.** |
| **DEP-01** | `npm ls` returns `@fastify/static@8.3.0`. **Confirmed High**, with a caveat in §5.4. |
| **DSO-01** | `git rev-parse --is-inside-work-tree` fails at root. **Confirmed High.** |
| **DB-SEC-01** | No driver in either manifest; `store.ts` / `store.rs` are the only persistence. **Confirmed Critical.** |
| **SEC-M11** | [chat.ts:110-121](webapp/server-node/src/chat.ts#L110) `createConversation` accepts caller-supplied `memberIds` with only a length check. **Confirmed Medium.** |

---

## 5. Revised findings

### 5.1 SEC-H09 — High → **Medium**

**Original claim:** unguarded `await file.toBuffer()` and non-null assertions
cause 500s and unbounded memory consumption.

**What is true:** the non-null assertions are real — `chatStore.conversations.get(id)!`
at [features.ts:176](webapp/server-node/src/routes/features.ts#L176) and
[features.ts:229](webapp/server-node/src/routes/features.ts#L229). `/v2/evidence`
at [features.ts:244-250](webapp/server-node/src/routes/features.ts#L244) has no
try/catch, so a parser error surfaces as an unhandled rejection → 500.

**What is false:** memory exhaustion. The global multipart registration caps
`fileSize` at `MAX_UPLOAD_BYTES` for every route. `toBuffer()` throws a bounded
`RequestFileTooLargeError` rather than accumulating unbounded data.

**Revised impact:** availability impact is limited to error-handling noise and
information disclosure through stack traces. Not a memory-exhaustion DoS.

### 5.2 SEC-H02 — High retained, **scope corrected**

**Original claim:** `/v2/evidence` and `/v2/chat/:id/media` "bypass
`validateUpload()`" — framed as missing size *and* content validation.

**Corrected:** size **is** enforced globally. What is bypassed is exclusively the
**magic-byte content check**. Both routes derive the stored extension from the
client-declared MIME type:

```ts
const ext = (file.mimetype.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg');
```

`validateUpload()` is invoked only at [index.ts:167](webapp/server-node/src/index.ts#L167).
Severity stays High because it enables content-type spoofing and polyglot storage,
and because it is the precondition for NEW-01.

### 5.3 SEC-H03 — High retained, **stored-XSS sub-claim is a false positive for Node**

Unauthenticated read access to `/uploads/*` is confirmed and remains a genuine
confidentiality failure — evidence photos, expert identity documents, and chat
media are served to anyone with the URL.

However, any implication of *stored XSS in the application origin* is invalidated
for the Node trail by [index.ts:88-93](webapp/server-node/src/index.ts#L88), which
sets `Content-Security-Policy: default-src 'none'; sandbox`, `nosniff`, and
`Content-Disposition: inline`. This is a correctly implemented control the audit
did acknowledge elsewhere but did not credit here.

### 5.4 SEC-C01 — Critical retained, reclassified **configuration-dependent**

[auth.rs:20](webapp/server-rust/src/auth.rs#L20) is confirmed:
`std::env::var("AUTH_SECRET").unwrap_or_else(|_| "REDACTED-DEV-LITERAL".into())`.

**Line-number correction:** the literal is on **line 20**, not line 19 as the
original audit stated.

**Reachability nuance the audit omitted:** the Node backend validates its secret
via `resolveAuthSecret()`, so a token forged with the Rust default is **not**
accepted by Node. Exploitation requires a *running Rust instance*, and no
deployment configuration for the Rust service exists in the repository.

**Why Critical is nonetheless correct:** the default is fail-open. Safety requires
an operator to set an environment variable that nothing enforces or documents; the
insecure path is what runs by default on any developer or staging host. A control
that is secure only when someone remembers is not a control.

---

## 6. Unsupported claims

These are claims in the original audit that this pass did **not** re-verify. They
are not contradicted — they are simply not evidenced within this review, and
should not be treated as validated.

| ID | Claim | Missing evidence |
|---|---|---|
| SEC-H05 | Rust uploads have no size limit | `features.rs` / `routes/mod.rs` multipart handling not re-read this pass |
| SEC-H07 | Rust login has no rate limiting | `routes/mod.rs:188-201` not re-read |
| SEC-H08 | Rust uses `CorsLayer::permissive()` | `main.rs:70` not re-read |
| SEC-H10 | Rust `Mutex::lock().unwrap()` poisoning | `routes/mod.rs:58` not re-read |
| — | "47 Rust endpoints vs 81 Node endpoints" | No endpoint enumeration was performed in this pass; the figures are carried forward unverified |
| — | "72.01% statements / 70.87% branches" | Coverage was measured in a prior session and **not re-measured** here. Presented as current fact in the remediation plan; should be dated |

**These are the audit's weakest links** — not because they are likely wrong, but
because the Rust trail carries the single highest-severity finding and received
proportionally the least re-verification.

---

## 7. False positives

| # | Sub-claim | Invalidating control |
|---|---|---|
| FP-1 | Unbounded memory consumption via `toBuffer()` | Global `fileSize: MAX_UPLOAD_BYTES` limit at [index.ts:80](webapp/server-node/src/index.ts#L80) |
| FP-2 | Stored XSS via `/uploads/` in the Node trail | `default-src 'none'; sandbox` CSP + `nosniff` + `inline` disposition at [index.ts:88-93](webapp/server-node/src/index.ts#L88) |

Neither invalidates a whole finding; both narrow one.

---

## 8. Newly discovered findings

### NEW-01 — Client-controlled path segment reaches a filesystem write (High, Medium confidence)

**File:** [index.ts:50-55](webapp/server-node/src/index.ts#L50), reached from
[features.ts:213](webapp/server-node/src/routes/features.ts#L213) and
[features.ts:246](webapp/server-node/src/routes/features.ts#L246).

```ts
export async function saveMedia(data: Buffer, ext: string): Promise<string> {
  const filename = `${randomUUID()}.${ext}`;
  await writeFile(join(UPLOAD_DIR, filename), data);
```

`ext` originates from `file.mimetype.split('/')[1]` — attacker-controlled, never
sanitised, never allow-listed. It is concatenated into a filename and passed to
`join()`.

Forward-slash traversal is **not** possible, because `split('/')[1]` cannot contain
`/`. **However, `path.join()` on Windows also treats `\` as a separator.** A MIME
value of the form `image/..\..\<name>` yields an `ext` containing backslashes,
and `join()` would normalise the result to a location **outside `UPLOAD_DIR`**.
The development environment for this repository is Windows.

**Not demonstrated.** Whether busboy permits backslashes in a part's
`Content-Type` was not tested, and no exploit was executed. Confidence is Medium
for that reason.

**Safe verification:** a unit test that calls the route with a crafted MIME value
and asserts `resolve(join(UPLOAD_DIR, filename)).startsWith(resolve(UPLOAD_DIR))`.
No exploitation required.

**Why the audit missed it:** it read these exact lines to report SEC-H02 but
stopped at the missing `validateUpload()` call and did not follow `ext` into its sink.

### NEW-02 — Rust token signature comparison is not constant-time, and its comment claims otherwise (Low)

**File:** [auth.rs:41-43](webapp/server-rust/src/auth.rs#L41)

```rust
if sign(payload) != sig {
```

This is an ordinary `String` inequality — short-circuiting, data-dependent. The
doc comment immediately above asserts *"Constant-time signature comparison via the
hmac crate (prevents timing attacks, mirroring the Node implementation)"*. That
statement is **false**: the `hmac` crate's constant-time path is
`Mac::verify_slice()`, which is not used here.

The Node trail genuinely does use `timingSafeEqual`. This is therefore both a
control divergence and an inaccurate security comment — the more dangerous half,
because it will cause a future reviewer to skip the line.

Severity Low: remote timing attacks against HMAC comparison across a network are
impractical in most conditions. It is nonetheless a real weakness and a
documentation defect.

### NEW-03 — Finance amount validation accepts `NaN` and `Infinity` (Medium)

**File:** [farmsFinance.ts:74-77](webapp/server-node/src/routes/farmsFinance.ts#L74)

```ts
if (!b?.type || !b?.category || typeof b.amount !== 'number' || !b?.farmId) …
if (b.amount <= 0) return reply.code(400)…
```

`typeof NaN === 'number'` and `NaN <= 0` is `false`, so **`NaN` passes both
checks**. `Infinity` passes identically. Either value poisons every aggregate in
`/finances/summary` permanently, since the entry cannot be deleted through any API.

Additionally, `type` and `category` are never validated against their declared
unions, and `currency` is accepted unchecked at [farmsFinance.ts:85](webapp/server-node/src/routes/farmsFinance.ts#L85).

The original audit noted "Infinity accepted" in the traceability document but did
not raise it as a finding, assign it an ID, or mention `NaN`.

---

## 9. Coverage gaps in the original audit

Areas the audit did not assess, and which remain unassessed:

1. **Sink analysis for user-controlled data.** The audit catalogued missing
   authorization thoroughly but performed little taint tracing. NEW-01 is the
   direct result.
2. **Log injection and sensitive data in logs.** `log.info('message sent', …)` and
   similar calls were not reviewed for PII or credential leakage.
3. **The `can()` policy matrix itself.** Individual route guards were checked;
   the correctness of the underlying permission table at
   [authz.ts:150-159](webapp/server-node/src/authz.ts#L150) was not.
4. **Rate-limit implementation correctness.** Existence was noted; the algorithm,
   key derivation, and bypass resistance were not examined.
5. **Dependency transitive analysis.** `npm audit` totals were reported; no
   assessment of whether advisory-affected code paths are reachable.
6. **WebSocket message handling** after the handshake — only the handshake auth
   was reviewed.
7. **`mobile-app` uncommitted working-tree changes** to `App.tsx`, `app.json`, and
   `package.json` — not reviewed by either the audit or this pass.

---

## 10. Limitations

- No code was executed and no exploit was attempted; reachability was established
  by static route-registration analysis only.
- The Rust trail received one file of re-verification (`auth.rs`). Four Rust
  findings are carried forward unverified (§6).
- No deployment or production configuration exists in the repository, so all
  "production reachability" assessments are inferences about a hypothetical
  deployment, explicitly flagged as such.
- Coverage percentages and endpoint counts quoted from the original audit were
  not re-measured.
- `mobile-app` has uncommitted modifications; the reviewed state is the working
  tree, not a committed revision.

---

## 11. Recommended next step

**Do not begin Wave 1.** Two actions should precede it:

1. **Verify NEW-01 with the non-destructive path-containment test described
   above.** If it confirms, it is an unauthenticated-adjacent arbitrary-file-write
   and outranks several findings currently ahead of it in the plan.
2. **Complete the Rust re-verification** (SEC-H05, H07, H08, H10). The trail
   holding the highest-severity finding has the thinnest evidence base, and
   decision D-1 — whether to retire that trail — should not be made on
   unverified inputs.

Wave 0 items E-1 through E-5 are supported by confirmed evidence and may proceed
immediately.

---

## 12. Consistency check

Every finding asserted in the original audit response appears as a row in
`specs/AUDIT_EVIDENCE_MATRIX.md`, including all findings carried forward without
re-verification, both false-positive sub-claims, and all three newly discovered
findings. Verified complete.
