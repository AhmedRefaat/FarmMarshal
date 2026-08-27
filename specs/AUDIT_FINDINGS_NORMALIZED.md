# Audit Findings — Normalized

**Date:** 2026-08-27
**Scope:** Findings validated in `specs/AUDIT_VALIDATION_REPORT.md`.
Only findings with direct evidence gathered in this pass are listed. Findings
carried forward without re-verification are recorded in
`specs/AUDIT_EVIDENCE_MATRIX.md` and excluded here by design.

**Priority scale:** P0 = before any further feature work · P1 = current cycle ·
P2 = next cycle · P3 = backlog.

---

## VAL-001 — Rust backend ships a hardcoded fallback signing secret

- **Severity:** Critical (configuration-dependent)
- **Priority:** P0
- **Evidence:** [webapp/server-rust/src/auth.rs:19-21](webapp/server-rust/src/auth.rs#L19) — `secret()` returns an env var *or* a committed literal. Value redacted as REDACTED. Consumed by `sign()` (line 27) and `verify()` (line 41); `issue_token()` at line 33 mints tokens with it.
- **Risk:** Anyone reading the repository can mint a token for `{"userId":"u-admin","role":"admin"}` and authenticate to any Rust instance where `AUTH_SECRET` is unset. Full administrative compromise of that instance. Tokens are byte-compatible with Node, but Node's `resolveAuthSecret()` rejects the default, so blast radius is limited to Rust hosts.
- **Recommendation:** Port `resolveAuthSecret()` semantics — refuse to start when the secret is absent, equal to the known literal, or shorter than 32 bytes, outside development. Rotate the secret everywhere and treat the committed value as permanently burned.
- **Dependencies:** None. Independent of decision D-1.
- **Verification requirement:** Unit tests asserting startup failure for each of the three rejection conditions, plus a test that a token signed with the legacy literal fails `verify()`.

---

## VAL-002 — Chat message read has no membership check

- **Severity:** Critical
- **Priority:** P0
- **Evidence:** [features.ts:184](webapp/server-node/src/routes/features.ts#L184) registers `GET /v2/chat/:id/messages` with bare `requirePermission()`, which skips authorization entirely ([authz.ts:190](webapp/server-node/src/authz.ts#L190)). [chat.ts:181-186](webapp/server-node/src/chat.ts#L181) `listMessages(conversationId)` accepts no user identifier. `assertMember()` at [chat.ts:126](webapp/server-node/src/chat.ts#L126) is called by `sendMessage`, `setPin`, and `react` — but not here. Reachable: `featureRoutes` registered at [index.ts:114](webapp/server-node/src/index.ts#L114).
- **Risk:** Any authenticated user — including the lowest-privileged worker — reads any conversation by iterating conversation identifiers. Exposes expert consultations, manager discussions, and shared media URLs. Classic BOLA.
- **Recommendation:** Call `assertMember(id, session.userId)` before `listMessages`, and change `listMessages` to require a `userId` so the omission becomes a compile error.
- **Dependencies:** None.
- **Verification requirement:** Test asserting a non-member receives 403 on a conversation containing at least one message.

---

## VAL-003 — Message translation endpoint has no membership check

- **Severity:** Critical
- **Priority:** P0
- **Evidence:** [chat.ts:227-241](webapp/server-node/src/chat.ts#L227) `messageInLang()` calls only `requireMessage()`. Route at [features.ts:196](webapp/server-node/src/routes/features.ts#L196) uses bare `requirePermission()`.
- **Risk:** Two compounding effects. First, a second unauthenticated-by-role path to any message body, independent of VAL-002 — fixing one does not fix the other. Second, each miss invokes `activeTranslator()`, an external paid provider, giving any authenticated user an unmetered cost-amplification primitive.
- **Recommendation:** Resolve the parent conversation from the message and assert membership before translating. Add per-user rate limiting on the translate path.
- **Dependencies:** None.
- **Verification requirement:** Test for 403 on a non-member; test asserting the translation provider is never invoked when authorization fails.

---

## VAL-004 — Finance ledger reads are not tenant-scoped

- **Severity:** Critical
- **Priority:** P0
- **Evidence:** [farmsFinance.ts:54-65](webapp/server-node/src/routes/farmsFinance.ts#L54) — predicate `(!q.farmId || e.farmId === q.farmId)` treats the tenant key as an optional filter. Same construct at [farmsFinance.ts:94-96](webapp/server-node/src/routes/farmsFinance.ts#L94). The module imports only `requireRole`; `authz.ts` is never imported. Registered at [index.ts:111](webapp/server-node/src/index.ts#L111).
- **Risk:** `GET /finances` with no query parameters returns every tenant's financial history to any user holding the `owner` role. `/finances/summary` aggregates across tenants identically. Direct competitor-visible financial disclosure.
- **Recommendation:** Derive permitted farms from `buildActorContext()`, intersect with any requested `farmId`, and return 403 rather than an empty set on a non-member request.
- **Dependencies:** None.
- **Verification requirement:** Cross-tenant read test for both routes, asserting that omitting `farmId` yields only the caller's own farms.

---

## VAL-005 — Finance ledger writes accept a caller-supplied tenant key

- **Severity:** Critical
- **Priority:** P0
- **Evidence:** [farmsFinance.ts:67-92](webapp/server-node/src/routes/farmsFinance.ts#L67) — `farmId: b.farmId` is copied from the request body; no membership check precedes `entries.push(entry)`.
- **Risk:** Any `owner` or `moderator` injects ledger rows into another tenant's books. No audit record is written, so a fabricated entry is indistinguishable from a legitimate one. Integrity failure with fraud potential.
- **Recommendation:** Validate `b.farmId` against the actor's memberships before constructing the entry; write an audit record for every ledger mutation.
- **Dependencies:** Shares its fix surface with VAL-004 and VAL-010.
- **Verification requirement:** Test asserting a write to a non-member farm returns 403 and appends nothing.

---

## VAL-006 — Farm directory returns all tenants

- **Severity:** High
- **Priority:** P0
- **Evidence:** [farmsFinance.ts:51](webapp/server-node/src/routes/farmsFinance.ts#L51) returns the module-level `farms` array with no filtering. Source comment: *"moderator their scope — demo: all"*.
- **Risk:** Tenant enumeration. Supplies the `farmId` values that make VAL-005 straightforward to exploit.
- **Recommendation:** Retire this route in favour of the correctly scoped `GET /v2/farms`.
- **Dependencies:** Client migration to the v2 route.
- **Verification requirement:** Test asserting the response contains only farms the caller owns or belongs to.

---

## VAL-007 — Two upload routes bypass content validation

- **Severity:** High *(scope corrected — size limits DO apply)*
- **Priority:** P1
- **Evidence:** [features.ts:211-217](webapp/server-node/src/routes/features.ts#L211) and [features.ts:244-250](webapp/server-node/src/routes/features.ts#L244) both derive the stored extension from `file.mimetype` and call `saveMedia()` without invoking `validateUpload()`. That helper exists at `webapp/server-node/src/security/uploads.ts:70` and is used only at [index.ts:167](webapp/server-node/src/index.ts#L167).
- **Mitigating control present:** the global multipart registration at [index.ts:79-81](webapp/server-node/src/index.ts#L79) enforces `fileSize`, `files: 1`, `fields: 10`, and `fieldSize`. **Size is not the gap.** Magic-byte verification is.
- **Risk:** Content-type spoofing and polyglot file storage. Directly enables VAL-008.
- **Recommendation:** Route both handlers through `validateUpload()` and derive the extension from the *verified* type, never from client input.
- **Dependencies:** Fix jointly with VAL-008.
- **Verification requirement:** Test uploading a file whose declared MIME contradicts its magic bytes; assert 400.

---

## VAL-008 — Client-controlled MIME substring reaches a filesystem path *(NEWLY DISCOVERED)*

- **Severity:** High (Medium confidence — not demonstrated)
- **Priority:** P0 to *verify*, then re-prioritise
- **Evidence:** [index.ts:50-55](webapp/server-node/src/index.ts#L50) — `saveMedia()` builds `` `${randomUUID()}.${ext}` `` and calls `join(UPLOAD_DIR, filename)`. `ext` arrives unsanitised from `file.mimetype.split('/')[1]` at the two routes in VAL-007.
- **Risk:** `split('/')[1]` cannot contain a forward slash, so POSIX traversal is blocked. **On Windows, `path.join()` also honours `\` as a separator**, so a MIME value carrying backslashes could normalise the write target outside `UPLOAD_DIR`. This repository is developed on Windows. If confirmed, it is an authenticated arbitrary-file-write.
- **Stated assumption:** busboy's tolerance for backslashes in a part's `Content-Type` header is **unverified**. No exploit was attempted.
- **Recommendation:** Allow-list the extension against the set returned by `validateUpload()`. Independently, assert path containment inside `saveMedia()` as a defensive invariant.
- **Dependencies:** None to verify; fix pairs with VAL-007.
- **Verification requirement:** Non-destructive unit test asserting `resolve(join(UPLOAD_DIR, filename)).startsWith(resolve(UPLOAD_DIR))` for adversarial MIME inputs.

---

## VAL-009 — Uploaded media is served without authorization

- **Severity:** High *(confidentiality only — stored-XSS sub-claim withdrawn)*
- **Priority:** P1
- **Evidence:** [index.ts:85-94](webapp/server-node/src/index.ts#L85) registers `/uploads/` as a static route with no `preHandler`.
- **Mitigating control present:** the same registration sets `Content-Security-Policy: default-src 'none'; sandbox`, `X-Content-Type-Options: nosniff`, and `Content-Disposition: inline`. Script execution in the application origin is effectively prevented; **the XSS component of the original claim does not hold for the Node trail.**
- **Risk:** Anyone holding or guessing a URL retrieves evidence photos, expert qualification documents, and chat media without authenticating. UUID filenames provide obscurity, not access control, and URLs leak through the unscoped list endpoints.
- **Recommendation:** Move media to private object storage; serve through an authenticated endpoint issuing short-lived signed URLs, authorized against the owning farm.
- **Dependencies:** Decision D-4 (storage target).
- **Verification requirement:** Test asserting an unauthenticated fetch of a known media URL returns 401/403.

---

## VAL-010 — Finance amount validation accepts `NaN` and `Infinity` *(NEWLY DISCOVERED)*

- **Severity:** Medium
- **Priority:** P1
- **Evidence:** [farmsFinance.ts:74-77](webapp/server-node/src/routes/farmsFinance.ts#L74) — guards are `typeof b.amount !== 'number'` then `b.amount <= 0`. `typeof NaN === 'number'` is true and `NaN <= 0` is false, so `NaN` passes; `Infinity` passes identically. `type` and `category` are never checked against their declared unions, and `currency` is accepted unvalidated at [farmsFinance.ts:85](webapp/server-node/src/routes/farmsFinance.ts#L85).
- **Risk:** A single poisoned row makes `totalExpense`, `totalIncome`, and `net` permanently `NaN` for every consumer of `/finances/summary`. No delete endpoint exists, so the corruption is unrecoverable without a restart — which, given the in-memory store, destroys all other data too.
- **Recommendation:** Use `Number.isFinite(b.amount)`, enforce the `type`/`category` allow-lists, validate `currency` against ISO-4217, and store money as integer minor units.
- **Dependencies:** None.
- **Verification requirement:** Tests rejecting `NaN`, `Infinity`, `-0`, and an out-of-union `category`.

---

## VAL-011 — Unhandled parser errors and non-null assertions return 500

- **Severity:** Medium *(revised down from High)*
- **Priority:** P2
- **Evidence:** `chatStore.conversations.get(id)!` at [features.ts:176](webapp/server-node/src/routes/features.ts#L176) and [features.ts:229](webapp/server-node/src/routes/features.ts#L229). `/v2/evidence` at [features.ts:244-250](webapp/server-node/src/routes/features.ts#L244) wraps neither `file.toBuffer()` nor `saveMedia()` in try/catch.
- **Original claim corrected:** memory exhaustion was asserted; the global `fileSize` limit makes the failure bounded. This is an error-handling defect, not a denial-of-service primitive.
- **Risk:** Unhandled 500s with potential stack-trace disclosure; degraded availability signal quality.
- **Recommendation:** Replace `!` assertions with explicit 404 handling; catch parser errors and return 413.
- **Dependencies:** None.
- **Verification requirement:** Test asserting 413 on an oversize upload and 404 on an unknown conversation.

---

## VAL-012 — Mobile app persists credentials in plaintext

- **Severity:** High
- **Priority:** P1
- **Evidence:** [webApi.ts:29-31](mobile-app/src/services/webApi.ts#L29) writes `JSON.stringify({email, password})` to AsyncStorage under a fixed key; [webApi.ts:43-45](mobile-app/src/services/webApi.ts#L43) reads it back on cold start. AsyncStorage is unencrypted. No `expo-secure-store` usage exists in the app.
- **Risk:** A rooted or jailbroken device, a device backup, or any filesystem-read vulnerability yields a reusable password — not merely a revocable session token. Password reuse extends the blast radius beyond this platform.
- **Recommendation:** Adopt a refresh-token flow and store only the refresh token in `expo-secure-store`. Ship a migration that deletes the existing key on launch.
- **Dependencies:** Requires the token-revocation work (WP-1.8) to be meaningful.
- **Verification requirement:** Test asserting the credentials key is never written and is removed at startup.

---

## VAL-013 — Mobile app hardcodes a cleartext HTTP origin

- **Severity:** High
- **Priority:** P1
- **Evidence:** [webApi.ts:18](mobile-app/src/services/webApi.ts#L18) — `export const BASE_URL = 'http://localhost:3000';`. No `eas.json` exists in `mobile-app`.
- **Risk:** No configuration path to a production HTTPS origin. Any build shipped as-is transmits bearer tokens and credentials in cleartext, and cannot reach a real backend at all.
- **Recommendation:** Source the origin from `expo-constants` per build profile; add `eas.json` with dev/staging/prod profiles; reject non-HTTPS origins in release builds.
- **Dependencies:** None.
- **Verification requirement:** Test asserting a release-profile build rejects an `http://` origin.

---

## VAL-014 — Rust token comparison is not constant-time and its comment is false *(NEWLY DISCOVERED)*

- **Severity:** Low
- **Priority:** P3
- **Evidence:** [auth.rs:41-43](webapp/server-rust/src/auth.rs#L41) — `if sign(payload) != sig` performs a short-circuiting `String` comparison. The doc comment at lines 38-39 claims constant-time comparison "via the hmac crate"; `Mac::verify_slice()` is not used. The Node trail does use `timingSafeEqual`.
- **Risk:** Theoretical signature-forgery oracle. Remote exploitation across a network is impractical under normal jitter. The more material risk is the false comment, which will cause future reviewers to skip the line.
- **Recommendation:** Use `Mac::verify_slice()` and correct the comment.
- **Dependencies:** Moot if decision D-1 retires the Rust trail.
- **Verification requirement:** Code review confirming `verify_slice()`; assert the comment matches the implementation.

---

## VAL-015 — WebSocket handshake carries the token in the query string

- **Severity:** Medium
- **Priority:** P2
- **Evidence:** [features.ts:311-313](webapp/server-node/src/routes/features.ts#L311) reads `request.query.token` and verifies it via `fakeRequestAuth()` at [features.ts:747](webapp/server-node/src/routes/features.ts#L747).
- **Risk:** Query strings are recorded in proxy, gateway, and server access logs and are exposed via `Referer`. A 7-day non-revocable token in a log file is a durable credential leak.
- **Recommendation:** Exchange a single-use, short-lived ticket over HTTP and present it on the socket.
- **Dependencies:** Token revocation (WP-1.8) reduces residual impact.
- **Verification requirement:** Test asserting the handshake rejects a token supplied via query string once the ticket flow lands.

---

## VAL-016 — Conversation creation accepts arbitrary member identifiers

- **Severity:** Medium
- **Priority:** P2
- **Evidence:** [chat.ts:110-121](webapp/server-node/src/chat.ts#L110) — only `memberIds.length < 2` is enforced; no verification that the caller is among them or may contact them.
- **Risk:** A user creates a conversation containing arbitrary users, then — combined with VAL-002 — becomes a legitimate member of a thread they fabricated. Also enables unsolicited contact.
- **Recommendation:** Require the creator to be a member, and validate every member against a permitted-contact relationship.
- **Dependencies:** Related to VAL-002.
- **Verification requirement:** Test rejecting creation when the caller is absent from `memberIds`.

---

## VAL-017 — No persistence layer

- **Severity:** Critical
- **Priority:** P0 (architectural)
- **Evidence:** No database driver in either backend manifest; `store.ts` and `store.rs` hold all state in `Map`/`HashMap`. `db/schema.sql` has never been executed.
- **Risk:** Total data loss on restart, including the audit log — eliminating forensic capability. Prevents horizontal scaling. Makes every other finding harder to detect and impossible to investigate after the fact.
- **Recommendation:** Per `specs/DATABASE_ARCHITECTURE_AUDIT.md` §8.
- **Dependencies:** Decision D-1, then D-2.
- **Verification requirement:** Integration test asserting data written before a restart is readable after it.

---

## VAL-018 — No repository-root version control

- **Severity:** High
- **Priority:** P0
- **Evidence:** `git rev-parse --is-inside-work-tree` fails at the repository root. Only `mobile-app` is a repository (branch `main`, working tree dirty).
- **Risk:** No history, no attribution, no revert path, no reviewable change record for either backend or the web client. Incident response cannot answer when a defect was introduced or by whom. Secret-scanning and CI gates have nothing to hook into.
- **Recommendation:** Initialise a repository at the root and commit the current tree before any remediation begins, so that remediation itself is reviewable.
- **Dependencies:** None. Blocks meaningful execution of every other work package.
- **Verification requirement:** `git log` returns commits; branch protection is enforced on the remote.

---

## VAL-019 — Vulnerable `@fastify/static` version serving user content

- **Severity:** High
- **Priority:** P1
- **Evidence:** `npm ls @fastify/static` returns `8.3.0`. The advertised advisories affect versions `<= 10.1.1` and include path traversal and authorization bypass via non-canonical paths. The package serves `/uploads/` at [index.ts:85](webapp/server-node/src/index.ts#L85).
- **Partial mitigating control:** the registration sets `index: false`, which removes the directory-listing precondition for at least one advisory.
- **Risk:** Path traversal in a route serving user-uploaded content. Compounds VAL-009, which already lacks authorization.
- **Recommendation:** Upgrade to `>= 10.1.3`. This is a **major version bump**; re-verify the `setHeaders` contract and the prefix behaviour afterwards.
- **Dependencies:** None.
- **Verification requirement:** `npm audit` reports no high or critical advisories in production dependencies; existing static-route header tests still pass.
