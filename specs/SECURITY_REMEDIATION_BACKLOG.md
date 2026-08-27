# Security Remediation Backlog

**Date:** 2026-08-27
**Author role:** Security remediation architect / senior engineering lead
**Source of truth:** `specs/AUDIT_VALIDATION_REPORT.md`,
`specs/AUDIT_FINDINGS_NORMALIZED.md`, `specs/AUDIT_EVIDENCE_MATRIX.md`,
`specs/AUDIT_OPEN_QUESTIONS.md`
**Companion:** `specs/SECURITY_REMEDIATION_DEPENDENCIES.md`

**No code was written or modified in producing this backlog.**

---

## How this backlog was prioritised

Priority is assigned from **validated evidence, reachability, likelihood, and
business impact** — not from the original audit's severity label. Three findings
the original audit called Critical are deliberately **not** P0:

| Finding | Audit severity | Priority here | Reason |
|---|---|---|---|
| VAL-017 (no persistence) | Critical | **P1** | Severe, but it is an architectural rebuild. It is not containable by an emergency change and belongs in Wave 4. Rule 9 forbids redesigning the database in Wave 0 |
| VAL-001 (Rust secret) | Critical | **P0 for rotation, P1 for code fix** | The committed value must be treated as burned immediately. The permanent fail-closed guard is ordinary engineering and is scheduled |
| VAL-019 (`@fastify/static`) | High | **P1, Wave 3** | A two-major-version bump is exactly the "broad refactoring" that rule 10 forbids mixing into emergency work |

### Verified environment facts this backlog relies on

| Artefact | State |
|---|---|
| `.github/workflows/ci.yml` | **Exists, never executed.** Its own header says so. No root git remote |
| `webapp/server-node/vitest.config.ts` | Thresholds 60% global; `src/security/**` held higher; `._*` excluded; `NO_LISTEN=1`, `NODE_ENV=test` |
| `npm run test` / `test:coverage` / `check` | Real scripts in `webapp/server-node/package.json` |
| `npm run schema:apply` | `psql "$DATABASE_URL" -f db/schema.sql` — target does not exist |
| Root git | **Absent.** No rollback path exists today |

---

## Explicitly excluded from implementation

Per objective 6, these must **not** appear as engineering work:

| Excluded item | Reason |
|---|---|
| Memory exhaustion via `toBuffer()` | **False positive.** Global `fileSize` limit at [index.ts:80](webapp/server-node/src/index.ts#L80) bounds it |
| Stored XSS via `/uploads/` (Node) | **False positive.** `default-src 'none'; sandbox` + nosniff + inline disposition already present |
| Committed build output in `client/dist/` | **Withdrawn by the audit.** Directory does not exist |
| `firebase-admin` shipping in a client bundle | **Withdrawn by the audit.** It is a devDependency |
| SEC-H05, H07, H08, H10 (Rust) | **Not re-verified.** Routed to investigation item R0-5, not to implementation |
| "39 of 52 entities missing", "47 vs 81 endpoints", "72.01% coverage" | **Unsupported tallies.** Not used as acceptance criteria anywhere |

---

## Decisions requiring human approval

No item below may start where it is marked blocked.

| ID | Decision | Blocks |
|---|---|---|
| **D-1** | One backend trail or two? | R1-2, and the scope of every Wave 1–2 item |
| **D-2** | Is `organizations` above `farms`? | R4-1, R4-2 |
| **D-3** | Remove Firestore from mobile, or retain and govern it? | R1-5 |
| **D-4** | Media storage target | R2-3 |
| **D-6** | Retention periods and applicable jurisdictions | R4-3 |
| **D-7** | Accept a two-major-version bump of `@fastify/static` this cycle? | R3-1 |

---

# WAVE 0 — EMERGENCY CONTAINMENT

**Scope discipline:** five items. Two are investigations with **no production
code change**. One is a repository operation. Only two alter running behaviour,
and both are small and surgical. No refactoring, no schema work, no dependency
upgrades.

---

## R0-0 — Establish a rollback path before any emergency change

| Field | Value |
|---|---|
| **Findings** | VAL-018 |
| **Wave / Priority / Severity** | 0 / P0 / High |
| **Objective** | Create a root git repository so every subsequent Wave 0 change is reviewable and revertible |
| **Business reason** | Three Wave 0 items modify authorization behaviour on live routes. Without version control there is no revert, no attribution, and no way to prove what changed during an incident |
| **Affected components** | Repository root (no source files) |
| **Prerequisites** | None |
| **Blocking decisions** | None |

**Implementation tasks**
1. `git init` at the repository root; add a `.gitignore` covering `node_modules/`, `target/`, `coverage/`, `uploads/`, and `._*`.
2. Commit the current tree as an untouched baseline, before any remediation.
3. Create the remote; enable branch protection and required review.
4. Confirm `mobile-app`'s existing repository is either nested intentionally or converted to a submodule — **do not delete it**; it has real history and a dirty working tree.

**Security acceptance criteria** — `git log` returns the baseline commit; force-push to the default branch is blocked.
**Functional acceptance criteria** — All four existing test suites behave identically to before.
**Unit / integration / negative / authorization / migration tests** — None applicable; verification is `git status` and a protected-branch push rejection.
**Deployment strategy** — Not deployed. Repository operation only.
**Rollback strategy** — Delete `.git/`; the working tree is untouched.
**Logs and metrics** — None.
**Documentation** — Contributing guide; branch-protection policy.
**Complexity** — Low. **Operational risk** — Low. **Downtime** — No. **Feature flag** — No. **Security review before deploy** — No.

---

## R0-1 — Rotate the exposed Rust signing secret and block the default

| Field | Value |
|---|---|
| **Findings** | VAL-001 |
| **Wave / Priority / Severity** | 0 / **P0** / Critical (configuration-dependent) |
| **Objective** | Ensure no running instance can accept a token signed with the committed literal |
| **Business reason** | The value is in source and must be treated as compromised. Anyone with repository read access can mint an admin token for any Rust instance where `AUTH_SECRET` is unset |
| **Affected components** | [webapp/server-rust/src/auth.rs:19-21](webapp/server-rust/src/auth.rs#L19) `secret()`; all environment configuration |
| **Prerequisites** | R0-0 |
| **Blocking decisions** | None — proceed regardless of D-1 |

**Implementation tasks**
1. Generate a new secret per environment via a cryptographic RNG. **Never** log, echo, print, or commit the value.
2. Set `AUTH_SECRET` in every environment where a Rust instance runs. Confirm per environment as a yes/no; do not transmit values.
3. Add a startup guard in `secret()` that panics outside development when the variable is unset, equals the known literal, or is shorter than 32 bytes.
4. Confirm whether any Rust instance is running anywhere (open question SEV-2). If none, record that and proceed.

**Security acceptance criteria** — A token signed with the legacy literal fails `verify()`; the process refuses to start in a non-dev profile without a valid secret.
**Functional acceptance criteria** — Rust integration tests pass with the variable set; existing sessions are expected to invalidate, which is intended.
**Unit tests** — Startup rejection for each of: unset, legacy literal, under 32 bytes. Acceptance of a valid secret.
**Integration tests** — `verify()` rejects a legacy-signed token.
**Negative tests** — Forged admin token rejected.
**Authorization tests** — Admin-only Rust route returns 401 for a legacy-signed token.
**Migration tests** — None.
**Deployment strategy** — Set the variable first, then deploy the guard. Reversing the order causes a boot failure.
**Rollback strategy** — Revert the guard commit. **Do not roll back the rotation.**
**Logs and metrics** — Log a startup assertion result (pass/fail only, never the value); alert on authentication failure spikes post-rotation.
**Documentation** — Environment variable matrix; secret rotation runbook.
**Complexity** — Low. **Operational risk** — Medium (invalidates sessions). **Downtime** — Brief restart. **Feature flag** — No. **Security review before deploy** — **Yes.**

---

## R0-2 — Contain cross-tenant finance exposure by disabling the routes

| Field | Value |
|---|---|
| **Findings** | VAL-004, VAL-005, VAL-006 |
| **Wave / Priority / Severity** | 0 / **P0** / Critical |
| **Objective** | Stop cross-tenant financial read and write immediately, without attempting the permanent authorization redesign |
| **Business reason** | Any user holding `owner` can read every tenant's complete financial history and inject ledger rows into other tenants' books with no audit trail. This is the highest-likelihood, highest-business-impact exposure in the codebase |
| **Affected components** | [farmsFinance.ts:51](webapp/server-node/src/routes/farmsFinance.ts#L51), [:54](webapp/server-node/src/routes/farmsFinance.ts#L54), [:67](webapp/server-node/src/routes/farmsFinance.ts#L67), [:94](webapp/server-node/src/routes/farmsFinance.ts#L94); registered at [index.ts:111](webapp/server-node/src/index.ts#L111) |
| **Prerequisites** | R0-0 |
| **Blocking decisions** | None |

**Implementation tasks**
1. Return `503 Service Unavailable` with a maintenance message from all four handlers, behind a single environment-controlled flag (`FINANCE_ROUTES_ENABLED`, default off).
2. **Do not** attempt tenant scoping here — that is R1-1. This item is containment only.
3. Notify the web client team: the Finance page will be non-functional.

**Rationale for disabling rather than fixing:** correct scoping requires wiring `buildActorContext()` into a module that does not import `authz.ts` at all. That is a design change, not an emergency patch, and rule 10 forbids combining the two.

**Security acceptance criteria** — No finance data is served to any caller; no ledger row can be created.
**Functional acceptance criteria** — All other routes unaffected; the client degrades with a clear message rather than a stack trace.
**Unit tests** — Each of the four routes returns 503 when the flag is off.
**Integration tests** — Flag on restores prior behaviour (for the R1-1 test bed only, never in a shared environment).
**Negative tests** — 503 is returned before any authorization or body parsing occurs.
**Authorization tests** — Deferred to R1-1.
**Migration tests** — None.
**Deployment strategy** — Deploy with the flag off. Single-step.
**Rollback strategy** — Revert the commit; behaviour returns to the vulnerable state, so rollback requires security sign-off.
**Logs and metrics** — Count 503s per route to measure real usage before R1-1 re-enables them.
**Documentation** — Incident note; client-facing status message.
**Complexity** — Low. **Operational risk** — Medium (removes a working feature). **Downtime** — Feature-level only. **Feature flag** — **Yes**, required. **Security review before deploy** — **Yes.**

---

## R0-3 — Add the missing membership assertion to chat read and translate

| Field | Value |
|---|---|
| **Findings** | VAL-002, VAL-003 |
| **Wave / Priority / Severity** | 0 / **P0** / Critical |
| **Objective** | Close two broken object-level authorization checks with the smallest possible change |
| **Business reason** | Any authenticated user — including the lowest-privileged worker — can read any conversation by iterating identifiers, and can force paid translation of any message. Expert consultations and manager discussions are exposed |
| **Affected components** | [chat.ts:181](webapp/server-node/src/chat.ts#L181) `listMessages`, [chat.ts:227](webapp/server-node/src/chat.ts#L227) `messageInLang`; routes [features.ts:184](webapp/server-node/src/routes/features.ts#L184) and [features.ts:196](webapp/server-node/src/routes/features.ts#L196) |
| **Prerequisites** | R0-0 |
| **Blocking decisions** | None |

**Implementation tasks**
1. Call `assertMember(id, session.userId)` in the `GET /v2/chat/:id/messages` handler before `listMessages`.
2. In the translate handler, resolve the parent conversation from the message and assert membership before invoking the provider.
3. Change the signatures of `listMessages` and `messageInLang` to require a `userId`, so a future omission is a compile error rather than a silent bypass.

**Rationale for fixing rather than disabling:** disabling chat reads breaks the primary mobile workflow entirely. A three-line assertion reusing an existing, already-proven helper is lower operational risk than a feature outage.

**Security acceptance criteria** — A non-member receives 403 from both routes; the translation provider is never invoked when authorization fails.
**Functional acceptance criteria** — Members read threads and translations exactly as before.
**Unit tests** — `listMessages` and `messageInLang` reject a non-member.
**Integration tests** — Member reads succeed end to end.
**Negative tests** — Unknown conversation ID returns 404, not 500; non-member returns 403.
**Authorization tests** — Worker, moderator, owner, and admin each tested against a conversation they do not belong to.
**Migration tests** — None.
**Deployment strategy** — Standard deploy with the rest of Wave 0.
**Rollback strategy** — Revert; requires security sign-off since it restores the bypass.
**Logs and metrics** — `permission denied` warnings already emitted by the existing logger; alert on a spike, which would indicate prior exploitation attempts.
**Documentation** — Update the chat authorization notes in `webapp/ARCHITECTURE.md`.
**Complexity** — Low. **Operational risk** — Low. **Downtime** — No. **Feature flag** — No. **Security review before deploy** — **Yes.**

---

## R0-4 — Investigation: confirm or refute the `saveMedia` path-containment risk

| Field | Value |
|---|---|
| **Findings** | VAL-008 (NEW-01) |
| **Wave / Priority / Severity** | 0 / **P0 to investigate** / High if confirmed |
| **Objective** | Determine whether a client-controlled MIME substring can escape `UPLOAD_DIR` |
| **Business reason** | If confirmed, this is an authenticated arbitrary-file-write on Windows hosts and outranks most of the backlog. It cannot be scheduled correctly while unverified |
| **Affected components** | [index.ts:50-55](webapp/server-node/src/index.ts#L50) `saveMedia`; callers at [features.ts:213](webapp/server-node/src/routes/features.ts#L213) and [features.ts:246](webapp/server-node/src/routes/features.ts#L246) |
| **Prerequisites** | R0-0 |
| **Blocking decisions** | None |

**Implementation tasks**
1. Write a **non-destructive** unit test asserting `resolve(join(UPLOAD_DIR, filename)).startsWith(resolve(UPLOAD_DIR))` for adversarial MIME values including backslash sequences.
2. Determine whether busboy permits backslashes in a part's `Content-Type` (open question SEV-1).
3. **No exploitation.** No writes outside the upload directory. Record the outcome and route to R2-2 with a confirmed severity.

**Security acceptance criteria** — A definitive, evidenced yes/no with a committed regression test either way.
**Functional acceptance criteria** — No production behaviour changes in this item.
**Unit tests** — The containment assertion above, retained permanently regardless of outcome.
**Integration / negative tests** — Adversarial MIME values rejected or safely contained.
**Authorization / migration tests** — Not applicable.
**Deployment strategy** — Test-only; nothing ships.
**Rollback strategy** — Not applicable.
**Logs and metrics** — None.
**Documentation** — Append the result to `specs/AUDIT_OPEN_QUESTIONS.md` (SEV-1).
**Complexity** — Low. **Operational risk** — None. **Downtime** — No. **Feature flag** — No. **Security review before deploy** — Not applicable.

---

## R0-5 — Investigation: re-verify the four unconfirmed Rust findings

| Field | Value |
|---|---|
| **Findings** | SEC-H05, SEC-H07, SEC-H08, SEC-H10 (all `Not re-verified`) |
| **Wave / Priority / Severity** | 0 / **P0 to investigate** / Unknown |
| **Objective** | Establish an evidence base for the trail that holds the highest-severity finding |
| **Business reason** | Decision D-1 — whether to retire the Rust backend — is the largest single lever in this plan and is currently blocked on unverified inputs |
| **Affected components** | `webapp/server-rust/src/main.rs`, `routes/mod.rs`, `features.rs` |
| **Prerequisites** | R0-0 |
| **Blocking decisions** | None; **unblocks D-1** |

**Implementation tasks**
1. Read and record evidence for: upload size limits, login rate limiting, CORS layer configuration, and mutex poisoning behaviour.
2. Update `specs/AUDIT_EVIDENCE_MATRIX.md` rows from `Not re-verified` to a validated status.
3. Do **not** fix anything in this item; route confirmed findings into Wave 1 or 2.

**Security acceptance criteria** — Each of the four findings carries a status and a file-and-line citation.
**Functional acceptance criteria** — No behaviour change.
**All test categories** — Not applicable; read-only investigation.
**Deployment strategy** — None. **Rollback strategy** — None.
**Logs and metrics** — None.
**Documentation** — Evidence matrix update.
**Complexity** — Low. **Operational risk** — None. **Downtime** — No. **Feature flag** — No. **Security review** — Not applicable.

---

# WAVE 1 — IDENTITY AND ACCESS CONTROL

---

## R1-1 — Permanent tenant scoping for the finance module

| Field | Value |
|---|---|
| **Findings** | VAL-004, VAL-005, VAL-006 |
| **Wave / Priority / Severity** | 1 / **P1** / Critical |
| **Objective** | Re-enable finance functionality with the tenant boundary enforced server-side |
| **Business reason** | R0-2 removed a feature the business needs. This restores it safely |
| **Affected components** | `webapp/server-node/src/routes/farmsFinance.ts` (entire module); `webapp/client/src/pages/Finance.tsx` |
| **Prerequisites** | R0-2 |
| **Blocking decisions** | D-2 influences whether the boundary is farm or organisation |

**Implementation tasks**
1. Import `authz.ts`; replace `requireRole` with `requirePermission` carrying an explicit action and a `getResource` that resolves `farmId`.
2. Derive permitted farms from `buildActorContext()`; intersect with any requested `farmId`; return **403** for a non-member rather than an empty result, so probing is not silently rewarded.
3. Reject writes whose body `farmId` is outside the actor's memberships.
4. Retire `GET /farms` in favour of the already-correct `GET /v2/farms`; migrate the client.
5. Write an audit record for every ledger mutation.
6. Remove the R0-2 flag once tests pass.

**Security acceptance criteria** — No request returns data from a farm the actor does not own or belong to; omitting `farmId` yields only the actor's own farms.
**Functional acceptance criteria** — The Finance page renders correct per-farm totals for a legitimate owner.
**Unit tests** — Scope-resolution helper returns exactly the actor's farms.
**Integration tests** — Full page-load path for an owner of two farms.
**Negative tests** — Omitted, empty, unknown, and other-tenant `farmId` values.
**Authorization tests** — Worker, moderator, accountant, owner, admin against own and foreign farms, read and write.
**Migration tests** — Client calls `GET /v2/farms` and renders identically.
**Deployment strategy** — Deploy backend behind the existing flag; enable after authorization tests pass in staging; then ship the client change.
**Rollback strategy** — Disable the flag, returning to the R0-2 contained state — **not** to the vulnerable state.
**Logs and metrics** — Audit event per mutation; metric on 403 rate by route.
**Documentation** — `webapp/ARCHITECTURE.md` §10 R5; API reference.
**Complexity** — Medium. **Operational risk** — Medium. **Downtime** — No. **Feature flag** — **Yes** (reuses R0-2's). **Security review before deploy** — **Yes.**

---

## R1-2 — Resolve the dual-backend trail and harden Rust authentication

| Field | Value |
|---|---|
| **Findings** | VAL-001, VAL-014, plus whatever R0-5 confirms |
| **Wave / Priority / Severity** | 1 / **P1** / Critical |
| **Objective** | Eliminate the class of defect where a control is fixed in one trail and left broken in the other |
| **Business reason** | Four Critical/High findings across two audits exist solely because Node was remediated and Rust was not. Every future security fix costs double until this is resolved |
| **Affected components** | All of `webapp/server-rust/` |
| **Prerequisites** | R0-1, R0-5 |
| **Blocking decisions** | **D-1 — mandatory** |

**Implementation tasks**
*If D-1 = retire:* archive the trail outside the build, remove it from CI, update all documentation asserting parity.
*If D-1 = keep both:* author the OpenAPI contract first (R2-7), add contract tests both trails must pass, then port every Node control — secret validation, rate limiting, CORS allow-list, upload limits, tenant scoping — and replace `!=` signature comparison with `Mac::verify_slice()` (VAL-014), correcting the false comment.

**Security acceptance criteria** — Either the trail cannot be deployed, or it passes the identical authorization test suite as Node.
**Functional acceptance criteria** — No client regression.
**Unit tests** — Constant-time comparison; secret validation.
**Integration tests** — Contract tests executed against both trails (keep-both path only).
**Negative tests** — Forged tokens, oversize uploads, disallowed origins.
**Authorization tests** — The full Node matrix re-run against Rust.
**Migration tests** — Clients function against the surviving trail.
**Deployment strategy** — Retire path: remove from CI, then archive. Keep path: contract tests gate every deploy.
**Rollback strategy** — Restore from the R0-0 baseline commit.
**Logs and metrics** — Per-trail request metrics to prove the retired trail receives no traffic.
**Documentation** — Architecture decision record; `docs/TECH_COMPARISON_STUDY.md`.
**Complexity** — High. **Operational risk** — Medium. **Downtime** — No. **Feature flag** — No. **Security review before deploy** — **Yes.**

---

## R1-3 — Make the authorization guard explicit about intent

| Field | Value |
|---|---|
| **Findings** | SEC-M06 (mechanism confirmed at [authz.ts:190](webapp/server-node/src/authz.ts#L190)) |
| **Wave / Priority / Severity** | 1 / **P1** / Medium |
| **Objective** | Remove the ambiguity that allowed VAL-002 and VAL-003 to ship |
| **Business reason** | `requirePermission()` with no argument silently means "authenticated only". Both chat Criticals used this form. The API invites the mistake |
| **Affected components** | [webapp/server-node/src/authz.ts:190](webapp/server-node/src/authz.ts#L190); every `/v2` route using the bare form |
| **Prerequisites** | R0-3 |
| **Blocking decisions** | None |

**Implementation tasks**
1. Introduce `requireAuth()` for authentication-only routes; make `requirePermission(action, …)` require an action.
2. Enumerate every current bare call — **recount rather than trusting the audit's figure of 26** — and classify each as legitimately auth-only or missing a check.
3. Add resource-level checks where the review finds them missing; record the classification per route.

**Security acceptance criteria** — No route uses an ambiguous guard; every auth-only route is explicitly and deliberately marked.
**Functional acceptance criteria** — No legitimate access is lost.
**Unit tests** — `requirePermission` without an action is a type error.
**Integration tests** — Each reclassified route retains correct behaviour.
**Negative tests** — Non-members rejected on every newly guarded route.
**Authorization tests** — Full persona matrix per reclassified route.
**Migration tests** — Not applicable.
**Deployment strategy** — Ship in reviewable batches by route group, not as one large change.
**Rollback strategy** — Revert per batch.
**Logs and metrics** — 403 rate per route, watched for false positives after each batch.
**Documentation** — Authorization guide; route inventory.
**Complexity** — Medium. **Operational risk** — Medium (over-restriction risk). **Downtime** — No. **Feature flag** — Per batch. **Security review before deploy** — **Yes.**

---

## R1-4 — Token revocation and session lifecycle

| Field | Value |
|---|---|
| **Findings** | SEC-M01 |
| **Wave / Priority / Severity** | 1 / **P1** / Medium |
| **Objective** | Make it possible to invalidate a credential before its 7-day expiry |
| **Business reason** | Today a leaked token is valid for up to seven days with no way to revoke it. Every other credential fix — including R1-5 — is weakened without this |
| **Affected components** | `webapp/server-node/src/auth.ts`; `routes/auth.ts`; store |
| **Prerequisites** | R1-1 (shared actor-context surface) |
| **Blocking decisions** | None |

**Implementation tasks**
1. Add a token version claim; increment it on password change, suspension, and role change.
2. Implement `POST /auth/logout`.
3. Fix suspension so it removes the primary role, not only the persona.
4. Shorten the access-token TTL; pair with the refresh flow in R1-5.

**Security acceptance criteria** — A revoked token fails on the next request; suspension immediately removes access.
**Functional acceptance criteria** — Normal sessions persist across app restarts.
**Unit tests** — Version comparison logic.
**Integration tests** — Logout, password change, suspension each invalidate.
**Negative tests** — Replay of a revoked token.
**Authorization tests** — A suspended admin loses admin access immediately.
**Migration tests** — Existing tokens without a version claim are handled deterministically (reject preferred; document the choice).
**Deployment strategy** — Deploy with a grace period for tokens lacking the claim, then enforce.
**Rollback strategy** — Revert; sessions remain valid.
**Logs and metrics** — Revocation events; count of rejected stale-version tokens.
**Documentation** — Session lifecycle; incident runbook for mass revocation.
**Complexity** — Medium. **Operational risk** — Medium. **Downtime** — No. **Feature flag** — Yes for enforcement. **Security review before deploy** — **Yes.**

---

## R1-5 — Secure mobile credential storage

| Field | Value |
|---|---|
| **Findings** | VAL-012 |
| **Wave / Priority / Severity** | 1 / **P1** / High |
| **Objective** | Stop persisting a reusable password on the device |
| **Business reason** | A device backup or filesystem read yields a password, not a revocable token. Password reuse extends the impact beyond this platform |
| **Affected components** | [mobile-app/src/services/webApi.ts:29-31](mobile-app/src/services/webApi.ts#L29), [:43-45](mobile-app/src/services/webApi.ts#L43); `authService.ts` |
| **Prerequisites** | R1-4 |
| **Blocking decisions** | **D-3** (Firestore) affects the surrounding refactor |

**Implementation tasks**
1. Remove `setWebCredentials` and the `agritasks.apiCreds` key entirely.
2. Adopt a refresh-token flow; store only the refresh token in `expo-secure-store`.
3. Ship a launch-time migration that deletes any existing credentials key.
4. Replace silent re-login with a re-authentication prompt.

**Security acceptance criteria** — No password is written to disk; the credentials key is absent after upgrade.
**Functional acceptance criteria** — Sessions still survive cold start via the refresh token.
**Unit tests** — Assert the credentials key is never written and is removed on launch.
**Integration tests** — Cold start, token refresh, refresh-token expiry.
**Negative tests** — Tampered or expired refresh token rejected.
**Authorization tests** — Refresh yields a token with unchanged, correct claims.
**Migration tests** — Upgrade from a build that stored credentials leaves no residue.
**Deployment strategy** — Mobile release; requires R1-4 server support deployed first.
**Rollback strategy** — Client rollback restores the insecure store — requires security sign-off.
**Logs and metrics** — Refresh success/failure rate; count of migrations performed.
**Documentation** — Mobile security notes; `mobile-app/ARCHITECTURE.md`.
**Complexity** — Medium. **Operational risk** — Medium. **Downtime** — No. **Feature flag** — No. **Security review before deploy** — **Yes.**

---

## R1-6 — Validate conversation membership on creation

| Field | Value |
|---|---|
| **Findings** | VAL-016 |
| **Wave / Priority / Severity** | 1 / **P2** / Medium |
| **Objective** | Prevent fabricating a conversation to gain legitimate membership |
| **Business reason** | With R0-3 in place, membership is the authorization boundary — so unrestricted membership assignment undermines it |
| **Affected components** | [chat.ts:110-121](webapp/server-node/src/chat.ts#L110) |
| **Prerequisites** | R0-3 |
| **Blocking decisions** | **A-5** — are conversations always farm-scoped? |

**Implementation tasks**
1. Require the creator to appear in `memberIds`.
2. Validate every member against a permitted-contact relationship (shared farm, or an assigned consultation).
3. Cap participant count.

**Security acceptance criteria** — A user cannot create a conversation containing users they may not contact, nor one excluding themselves.
**Functional acceptance criteria** — Legitimate direct, group, and consultation threads still create.
**Unit tests** — Creator-membership and contact-permission rules.
**Integration tests** — Each conversation kind creates successfully.
**Negative tests** — Creator absent; unrelated member; oversized member list.
**Authorization tests** — Cross-farm creation rejected unless a consultation permits it.
**Migration tests** — Existing conversations remain readable.
**Deployment strategy** — Standard.
**Rollback strategy** — Revert.
**Logs and metrics** — Rejected creation attempts.
**Documentation** — Chat authorization model.
**Complexity** — Medium. **Operational risk** — Low. **Downtime** — No. **Feature flag** — No. **Security review before deploy** — Yes.

---

## R1-7 — Authentication hardening: lockout, reset, and rate-limit parity

| Field | Value |
|---|---|
| **Findings** | SEC-M05; SEC-H07 pending R0-5 |
| **Wave / Priority / Severity** | 1 / **P2** / Medium |
| **Objective** | Complete the authentication lifecycle and make brute-force protection consistent |
| **Business reason** | Users have no recovery path today, which drives password reuse and support load; and brute-force protection must not depend on which backend answers |
| **Affected components** | `webapp/server-node/src/routes/auth.ts`, `src/security/rateLimit.ts`; Rust login if D-1 keeps it |
| **Prerequisites** | R0-5, R1-4 |
| **Blocking decisions** | D-1 |

**Implementation tasks**
1. Password reset via a single-use, expiring, side-channel token — never returned in the response body.
2. Account lockout with progressive backoff after repeated failures.
3. Verify rate-limit key derivation resists trivial header spoofing.
4. Port equivalent protection to Rust if the trail survives.

**Security acceptance criteria** — Automated password guessing is throttled; reset tokens are single-use and expiring.
**Functional acceptance criteria** — Legitimate users recover access unaided.
**Unit tests** — Backoff schedule; token single-use enforcement.
**Integration tests** — Full reset flow.
**Negative tests** — Reused token, expired token, spoofed forwarding header.
**Authorization tests** — Reset does not permit privilege change.
**Migration tests** — Not applicable.
**Deployment strategy** — Standard; monitor lockout rate closely after release.
**Rollback strategy** — Revert; brute-force exposure returns.
**Logs and metrics** — Lockout events, reset requests, failure rate by source.
**Documentation** — Account recovery runbook.
**Complexity** — Medium. **Operational risk** — Medium (lockout can deny legitimate users). **Downtime** — No. **Feature flag** — Yes for lockout thresholds. **Security review before deploy** — **Yes.**

---

## R1-8 — Membership management API *(hardening objective — enables authorization)*

| Field | Value |
|---|---|
| **Findings** | Traceability BL-17 — no validated vulnerability; a functional gap that blocks correct authorization |
| **Wave / Priority / Severity** | 1 / **P2** / Informational |
| **Objective** | Allow farm memberships to be created, changed, and revoked through an audited API |
| **Business reason** | Every authorization decision derives from memberships, yet they can only be changed by editing source. Access cannot currently be revoked at all |
| **Affected components** | `webapp/server-node/src/store.ts`; a new route module |
| **Prerequisites** | R1-3 |
| **Blocking decisions** | **D-2** |

**Implementation tasks** — Add authorized, audited create/update/revoke endpoints for farm membership, restricted to farm owners and admins.

**Security acceptance criteria** — Only owners and admins mutate membership; every change is audited; revocation takes effect immediately.
**Functional acceptance criteria** — A worker can be onboarded and offboarded without a deployment.
**Unit tests** — Role-change validity rules.
**Integration tests** — Onboard, change role, revoke.
**Negative tests** — Non-owner attempts; self-escalation.
**Authorization tests** — Full persona matrix.
**Migration tests** — Seeded memberships remain intact.
**Deployment strategy** — Standard.
**Rollback strategy** — Revert; memberships become static again.
**Logs and metrics** — Audit event per change.
**Documentation** — Admin runbook.
**Complexity** — Medium. **Operational risk** — Medium. **Downtime** — No. **Feature flag** — Yes. **Security review before deploy** — **Yes.**

---

# WAVE 2 — DATA AND API PROTECTION

---

## R2-1 — Apply content validation to the two unguarded upload routes

| Field | Value |
|---|---|
| **Findings** | VAL-007 |
| **Wave / Priority / Severity** | 2 / **P1** / High |
| **Objective** | Verify uploaded content by magic bytes, not by client-declared MIME |
| **Business reason** | Content-type spoofing allows polyglot files into shared storage. **Size limits already exist globally — this item is about content only** |
| **Affected components** | [features.ts:211-217](webapp/server-node/src/routes/features.ts#L211), [:244-250](webapp/server-node/src/routes/features.ts#L244); `src/security/uploads.ts` |
| **Prerequisites** | None |
| **Blocking decisions** | None |

**Implementation tasks** — Route both handlers through `validateUpload()`; derive the stored extension from the **verified** type; return 400 on mismatch.

**Security acceptance criteria** — A file whose magic bytes contradict its declared MIME is rejected on both routes.
**Functional acceptance criteria** — Legitimate photo, video, and audio uploads succeed.
**Unit tests** — `validateUpload` against each supported and several unsupported types.
**Integration tests** — Upload through both routes.
**Negative tests** — Renamed executable declared as `image/jpeg`; empty file; truncated header.
**Authorization tests** — Unauthenticated upload rejected.
**Migration tests** — Existing stored files remain retrievable.
**Deployment strategy** — Standard.
**Rollback strategy** — Revert.
**Logs and metrics** — Rejected-upload count by reason.
**Documentation** — Upload policy; supported type list.
**Complexity** — Low. **Operational risk** — Low. **Downtime** — No. **Feature flag** — No. **Security review before deploy** — Yes.

---

## R2-2 — Enforce path containment in `saveMedia`

| Field | Value |
|---|---|
| **Findings** | VAL-008 |
| **Wave / Priority / Severity** | 2 / **P1**, escalating to **P0** if R0-4 confirms exploitability / High |
| **Objective** | Guarantee that no upload can write outside the upload directory |
| **Business reason** | Client-controlled input currently reaches a filesystem path with no sanitisation. Even if unexploitable today, the invariant should be enforced at the sink |
| **Affected components** | [index.ts:50-55](webapp/server-node/src/index.ts#L50) |
| **Prerequisites** | **R0-4 must complete first** |
| **Blocking decisions** | None |

**Implementation tasks**
1. Allow-list the extension from the verified type returned by `validateUpload()`; never accept a client-supplied substring.
2. Assert path containment inside `saveMedia()` as a defensive invariant independent of caller behaviour.
3. Retain the R0-4 regression test permanently.

**Security acceptance criteria** — For every adversarial input tested, the resolved path remains within `UPLOAD_DIR`; a violation throws rather than writing.
**Functional acceptance criteria** — Normal uploads store and serve unchanged.
**Unit tests** — Containment assertion across adversarial extensions, including backslash and dot sequences.
**Integration tests** — Upload and retrieve through both routes.
**Negative tests** — Traversal-shaped MIME values rejected.
**Authorization tests** — Not applicable.
**Migration tests** — Existing filenames still resolve.
**Deployment strategy** — Standard, or expedited if R0-4 confirms exploitability.
**Rollback strategy** — Revert only with security sign-off.
**Logs and metrics** — Alert on any containment-assertion failure — it indicates an active attempt.
**Documentation** — Upload storage design note.
**Complexity** — Low. **Operational risk** — Low. **Downtime** — No. **Feature flag** — No. **Security review before deploy** — **Yes.**

---

## R2-3 — Authenticated, authorized media access

| Field | Value |
|---|---|
| **Findings** | VAL-009 |
| **Wave / Priority / Severity** | 2 / **P1** / High |
| **Objective** | Require authorization to retrieve uploaded media |
| **Business reason** | Evidence photos, chat media, and **expert qualification documents** are served to anyone with a URL. UUID filenames are obscurity, not access control, and URLs leak through unscoped list endpoints |
| **Affected components** | [index.ts:85-94](webapp/server-node/src/index.ts#L85); all upload call sites |
| **Prerequisites** | R2-1, R2-2 |
| **Blocking decisions** | **D-4** (storage target) |

**Implementation tasks**
1. Create a media metadata record with owning farm, uploader, checksum, size, and verified type.
2. Move objects to private storage per D-4.
3. Serve through an authenticated endpoint that authorizes against the owning farm and redirects to a short-lived signed URL.
4. Strip EXIF/GPS on ingest.
5. Retire the public static route.

**Security acceptance criteria** — An unauthenticated fetch returns 401; a non-member returns 403; signed URLs expire.
**Functional acceptance criteria** — All existing media renders for authorized users.
**Unit tests** — Signed-URL generation and expiry.
**Integration tests** — Upload, authorize, retrieve.
**Negative tests** — Expired URL; foreign-farm media; unauthenticated fetch.
**Authorization tests** — Full persona matrix against own and foreign media.
**Migration tests** — **Existing files under `uploads/` must be migrated with metadata reconstructed.** Files whose owner cannot be determined must be quarantined, not left public.
**Deployment strategy** — Dual-serve during migration, then disable the public route. Coordinated client release required.
**Rollback strategy** — Re-enable the public route — **requires security sign-off**, as it restores the exposure.
**Logs and metrics** — Media access events; count of unauthorized attempts; migration completeness.
**Documentation** — Media handling policy; retention.
**Complexity** — High. **Operational risk** — High (data migration plus client coordination). **Downtime** — Possible brief media unavailability. **Feature flag** — **Yes.** **Security review before deploy** — **Yes.**

---

## R2-4 — Finance input validation

| Field | Value |
|---|---|
| **Findings** | VAL-010 |
| **Wave / Priority / Severity** | 2 / **P1** / Medium |
| **Objective** | Reject non-finite amounts and out-of-union values |
| **Business reason** | `NaN` and `Infinity` both pass the current guards. One poisoned row makes every finance aggregate permanently `NaN`, and no delete endpoint exists to recover |
| **Affected components** | [farmsFinance.ts:74-77](webapp/server-node/src/routes/farmsFinance.ts#L74), [:85](webapp/server-node/src/routes/farmsFinance.ts#L85) |
| **Prerequisites** | R1-1 |
| **Blocking decisions** | None |

**Implementation tasks**
1. Replace the numeric guard with `Number.isFinite`.
2. Enforce `type` and `category` allow-lists matching the declared unions.
3. Validate `currency` against ISO-4217.
4. Move to integer minor units end to end.
5. Add an upper bound consistent with the intended `NUMERIC(14,2)` target.

**Security acceptance criteria** — No non-finite or out-of-union value is persisted.
**Functional acceptance criteria** — Valid entries record and aggregate correctly.
**Unit tests** — `NaN`, `Infinity`, `-Infinity`, `-0`, `1e308`, string amounts, unknown category, invalid currency.
**Integration tests** — Create then summarise.
**Negative tests** — Each rejection case returns 400 with a safe message.
**Authorization tests** — Inherited from R1-1.
**Migration tests** — Existing seeded entries still validate.
**Deployment strategy** — Standard.
**Rollback strategy** — Revert.
**Logs and metrics** — Validation-rejection counts by field.
**Documentation** — Finance API reference.
**Complexity** — Low. **Operational risk** — Low. **Downtime** — No. **Feature flag** — No. **Security review before deploy** — No.

---

## R2-5 — API error handling

| Field | Value |
|---|---|
| **Findings** | VAL-011 |
| **Wave / Priority / Severity** | 2 / **P2** / Medium |
| **Objective** | Return correct status codes instead of unhandled 500s |
| **Business reason** | Unhandled errors leak stack traces and degrade the signal quality of availability monitoring. **This is error handling, not a denial-of-service fix — the memory-exhaustion claim was a false positive** |
| **Affected components** | [features.ts:176](webapp/server-node/src/routes/features.ts#L176), [:229](webapp/server-node/src/routes/features.ts#L229), [:244-250](webapp/server-node/src/routes/features.ts#L244) |
| **Prerequisites** | None |
| **Blocking decisions** | None |

**Implementation tasks** — Replace `!` assertions with explicit 404 handling; catch multipart parser errors and return 413; add a global error handler that suppresses stack traces outside development.

**Security acceptance criteria** — No stack trace or internal path reaches a client in a non-development profile.
**Functional acceptance criteria** — Correct status codes for each condition.
**Unit tests** — Error-mapping helper.
**Integration tests** — Oversize upload returns 413; unknown conversation returns 404.
**Negative tests** — Malformed multipart; absent file part.
**Authorization tests** — Errors do not disclose existence of resources the caller may not see.
**Migration tests** — Not applicable.
**Deployment strategy** — Standard.
**Rollback strategy** — Revert.
**Logs and metrics** — 5xx rate by route; alert on regression.
**Documentation** — Error-code reference.
**Complexity** — Low. **Operational risk** — Low. **Downtime** — No. **Feature flag** — No. **Security review before deploy** — No.

---

## R2-6 — WebSocket ticket handshake

| Field | Value |
|---|---|
| **Findings** | VAL-015 |
| **Wave / Priority / Severity** | 2 / **P2** / Medium |
| **Objective** | Remove the bearer token from the URL query string |
| **Business reason** | Query strings are recorded in proxy and access logs. A long-lived token in a log file is a durable credential leak |
| **Affected components** | [features.ts:311-313](webapp/server-node/src/routes/features.ts#L311), [:747](webapp/server-node/src/routes/features.ts#L747) |
| **Prerequisites** | R1-4 |
| **Blocking decisions** | None |

**Implementation tasks** — Issue a single-use, short-lived ticket over authenticated HTTP; accept only that ticket on the socket; reject query-string tokens once clients migrate.

**Security acceptance criteria** — No long-lived credential appears in any URL; tickets are single-use and expire in seconds.
**Functional acceptance criteria** — Live chat push continues to work on web and mobile.
**Unit tests** — Ticket issue, consume, expire.
**Integration tests** — Full handshake.
**Negative tests** — Reused ticket; expired ticket; query-string token after cutover.
**Authorization tests** — Ticket binds to the issuing user only.
**Migration tests** — Grace period accepting both, then enforcement.
**Deployment strategy** — Server supports both, clients migrate, then query-string support is removed. **Coordinated.**
**Rollback strategy** — Re-enable query-string acceptance.
**Logs and metrics** — Handshake method breakdown to confirm client migration before cutover.
**Documentation** — WebSocket protocol note.
**Complexity** — Medium. **Operational risk** — Medium (breaks clients if cut over early). **Downtime** — No. **Feature flag** — **Yes.** **Security review before deploy** — Yes.

---

## R2-7 — API contract and runtime schema validation

| Field | Value |
|---|---|
| **Findings** | API-01, API-02 |
| **Wave / Priority / Severity** | 2 / **P2** / High |
| **Objective** | Validate every request against a published schema |
| **Business reason** | `request.body as any` is pervasive. The absence of a contract is also what allowed a client to call a non-existent endpoint while its mocked unit test passed |
| **Affected components** | All route modules in `webapp/server-node/src/routes/` |
| **Prerequisites** | R1-3 |
| **Blocking decisions** | D-1 — a contract is mandatory if both trails survive |

**Implementation tasks** — Publish OpenAPI 3.1 covering every endpoint; attach Fastify JSON schemas to every route; eliminate `as any`; generate client types; add contract tests.

**Security acceptance criteria** — Every endpoint rejects structurally invalid input before handler logic executes.
**Functional acceptance criteria** — All existing valid requests continue to succeed.
**Unit tests** — Schema acceptance and rejection per route.
**Integration tests** — Contract tests against the running server.
**Negative tests** — Extra fields, wrong types, missing required fields, oversized payloads.
**Authorization tests** — Validation runs after authentication so it cannot be used to probe.
**Migration tests** — Generated client types compile against existing call sites.
**Deployment strategy** — Route group at a time, monitoring 400 rates.
**Rollback strategy** — Per-group revert.
**Logs and metrics** — 400 rate by route and field — a spike means an over-strict schema.
**Documentation** — Published API reference.
**Complexity** — High. **Operational risk** — Medium (over-strict schemas break clients). **Downtime** — No. **Feature flag** — Per group. **Security review before deploy** — Yes.

---

## R2-8 — Transport and browser security headers *(defense-in-depth)*

| Field | Value |
|---|---|
| **Findings** | WEB-03, WEB-06 — **hardening, not a validated vulnerability** |
| **Wave / Priority / Severity** | 2 / **P2** / Low |
| **Objective** | Add HSTS and a CSP for HTML responses |
| **Business reason** | Four baseline headers are already set. HSTS and a document CSP are the remaining gaps. Listed separately from vulnerability fixes per objective 7 |
| **Affected components** | [index.ts:97-104](webapp/server-node/src/index.ts#L97); edge proxy once one exists |
| **Prerequisites** | R3-4 (a TLS-terminating edge must exist for HSTS to be meaningful) |
| **Blocking decisions** | D-2 (deployment topology) |

**Implementation tasks** — Add HSTS at the TLS edge; define a CSP for HTML; keep the existing `/uploads/` CSP unchanged.

**Security acceptance criteria** — Headers present on all responses; CSP blocks inline script in report-only mode before enforcement.
**Functional acceptance criteria** — The web client functions with the CSP enforced.
**Unit tests** — Header presence assertions.
**Integration tests** — Client smoke test under enforced CSP.
**Negative tests** — Inline script blocked.
**Authorization tests** — Not applicable.
**Migration tests** — Report-only period produces no violations before enforcement.
**Deployment strategy** — Report-only first, then enforce. **HSTS is effectively irreversible for its max-age** — start with a short value.
**Rollback strategy** — CSP revertible; **HSTS is not** until max-age elapses.
**Logs and metrics** — CSP violation reports.
**Documentation** — Header policy.
**Complexity** — Low. **Operational risk** — Medium (HSTS is sticky). **Downtime** — No. **Feature flag** — Report-only mode acts as one. **Security review before deploy** — Yes.

---

## R2-9 — Mobile transport configuration

| Field | Value |
|---|---|
| **Findings** | VAL-013, MOB-01 |
| **Wave / Priority / Severity** | 2 / **P1** / High |
| **Objective** | Give the mobile app a build-profile-driven HTTPS origin |
| **Business reason** | The origin is a hardcoded cleartext constant and no `eas.json` exists, so no production build is possible today and any build transmits credentials in cleartext |
| **Affected components** | [mobile-app/src/services/webApi.ts:18](mobile-app/src/services/webApi.ts#L18); new `mobile-app/eas.json` |
| **Prerequisites** | R3-4 (a real origin must exist) |
| **Blocking decisions** | D-2 |

**Implementation tasks** — Add `eas.json` with dev/staging/prod profiles; source the origin from `expo-constants`; reject non-HTTPS in release; add certificate pinning for production.

**Security acceptance criteria** — A release build refuses a non-HTTPS origin; pinning rejects an untrusted certificate.
**Functional acceptance criteria** — Each profile reaches its intended backend.
**Unit tests** — Origin resolution and the HTTPS guard.
**Integration tests** — Build per profile and smoke test.
**Negative tests** — `http://` origin in release; mismatched certificate.
**Authorization tests** — Not applicable.
**Migration tests** — Existing installs upgrade without losing session.
**Deployment strategy** — Staged store rollout.
**Rollback strategy** — Store rollback; slow. **Pinning errors can brick connectivity — stage carefully.**
**Logs and metrics** — Connection failure rate by profile.
**Documentation** — Mobile build and release guide.
**Complexity** — Medium. **Operational risk** — **High** (pinning misconfiguration is difficult to recover from). **Downtime** — No. **Feature flag** — No. **Security review before deploy** — **Yes.**

---

# WAVE 3 — PLATFORM, SUPPLY CHAIN, AND OBSERVABILITY

---

## R3-1 — Upgrade `@fastify/static`

| Field | Value |
|---|---|
| **Findings** | VAL-019 |
| **Wave / Priority / Severity** | 3 / **P1** / High |
| **Objective** | Remove path-traversal and authorization-bypass advisories from the component serving user content |
| **Business reason** | Version 8.3.0 is affected by advisories covering `<= 10.1.1`, including authorization bypass via non-canonical paths. It serves `/uploads/`, which currently has no authorization of its own |
| **Affected components** | `webapp/server-node/package.json`; [index.ts:85-94](webapp/server-node/src/index.ts#L85) |
| **Prerequisites** | R0-0 |
| **Blocking decisions** | **D-7** — accept a two-major-version bump |

**Implementation tasks** — Upgrade to `>= 10.1.3`; re-verify the `setHeaders` contract, `prefix`, and `index: false` behaviour against the new major version; re-run static-route tests.

**Security acceptance criteria** — `npm audit` reports no high or critical advisories in production dependencies.
**Functional acceptance criteria** — `/uploads/` still serves with all three security headers intact.
**Unit tests** — Header assertions on the static route.
**Integration tests** — Fetch a known file; confirm headers and content.
**Negative tests** — Encoded traversal attempts return 404; directory listing unavailable.
**Authorization tests** — Combine with R2-3 once media authorization lands.
**Migration tests** — Existing URLs resolve unchanged.
**Deployment strategy** — Deploy to staging, run the full suite, then production. **Not to be combined with any other change in the same release.**
**Rollback strategy** — Revert the version pin; the lock file makes this clean.
**Logs and metrics** — 404/403 rate on `/uploads/`.
**Documentation** — Dependency upgrade note.
**Complexity** — Medium (major bump). **Operational risk** — Medium. **Downtime** — No. **Feature flag** — No. **Security review before deploy** — Yes.

---

## R3-2 — Activate CI and add security gates

| Field | Value |
|---|---|
| **Findings** | DSO-02, DSO-03 |
| **Wave / Priority / Severity** | 3 / **P1** / High |
| **Objective** | Make the existing, never-executed CI workflow real and add scanning |
| **Business reason** | `.github/workflows/ci.yml` exists but has never run — its own header says so. An unexecuted gate provides false assurance. Secret scanning would have caught VAL-001 |
| **Affected components** | [.github/workflows/ci.yml](.github/workflows/ci.yml) |
| **Prerequisites** | **R0-0** — CI cannot run without a repository |
| **Blocking decisions** | None |

**Implementation tasks**
1. Execute the workflow; treat the first run as debugging, as its header advises.
2. Add secret scanning covering **`webapp/server-rust/`** — the current grep would not have caught VAL-001.
3. Add SAST, dependency scanning, and an SBOM step.
4. Make the security jobs required for merge.
5. Raise `vitest.config.ts` thresholds from 60% only after each wave's tests land — a permanently red gate trains people to ignore it.

**Security acceptance criteria** — A seeded test secret fails the build; a known-vulnerable dependency fails the build.
**Functional acceptance criteria** — All four suites pass in CI.
**Unit / integration tests** — Existing suites execute in CI.
**Negative tests** — Seeded secret and seeded vulnerable dependency both fail.
**Authorization tests** — Workflow permissions remain least-privilege (`contents: read`).
**Migration tests** — Not applicable.
**Deployment strategy** — Enable jobs as non-blocking first, then required.
**Rollback strategy** — Mark jobs non-required.
**Logs and metrics** — Build pass rate; scan findings over time.
**Documentation** — CI guide; triage process for scan findings.
**Complexity** — Medium. **Operational risk** — Low. **Downtime** — No. **Feature flag** — Non-blocking mode acts as one. **Security review before deploy** — No.

---

## R3-3 — Structured security logging and audit coverage

| Field | Value |
|---|---|
| **Findings** | SEC-M08 |
| **Wave / Priority / Severity** | 3 / **P2** / High |
| **Objective** | Make security-relevant events durable, complete, and alertable |
| **Business reason** | Audit records live in a mutable in-memory array and cover only a handful of actions. Login, logout, failed login, registration, task and finance mutations, and uploads are unaudited. There is no forensic capability today |
| **Affected components** | `webapp/server-node/src/audit.ts`, `logger.ts`; all mutating routes |
| **Prerequisites** | **R4-1** for durability; coverage expansion can start earlier |
| **Blocking decisions** | D-6 (retention) |

**Implementation tasks** — Expand audit coverage to all authentication and mutation events; adopt structured logging with correlation IDs; ensure no credential or personal data is logged; add alerting on authorization-denial spikes, lockouts, and containment-assertion failures.

**Security acceptance criteria** — Every authentication and mutation event produces an audit record; no secret or password appears in any log.
**Functional acceptance criteria** — Log volume remains manageable.
**Unit tests** — Audit-record shape; redaction helper.
**Integration tests** — Each event type produces a record.
**Negative tests** — Attempt to log a credential is redacted.
**Authorization tests** — Audit read remains admin-only.
**Migration tests** — Applies once R4-1 provides durable storage.
**Deployment strategy** — Incremental by event category.
**Rollback strategy** — Revert per category.
**Logs and metrics** — Audit write rate; alert thresholds.
**Documentation** — `docs/LOGGING_GUIDE.md`; incident response runbook.
**Complexity** — Medium. **Operational risk** — Low. **Downtime** — No. **Feature flag** — No. **Security review before deploy** — Yes.

---

## R3-4 — Deployment artefacts and environment separation

| Field | Value |
|---|---|
| **Findings** | DSO-04, DSO-11 |
| **Wave / Priority / Severity** | 3 / **P1** / High |
| **Objective** | Produce reproducible, environment-separated deployments |
| **Business reason** | No deployment configuration exists, which is why the reachability of the highest-severity finding cannot be determined. Several other items are blocked on having a real environment |
| **Affected components** | Repository root; both backends; both clients |
| **Prerequisites** | R0-0, R3-2 |
| **Blocking decisions** | **D-1** (how many services), **D-2** |

**Implementation tasks** — Container definitions with non-root users and pinned bases; an environment matrix; `.env.example` with **names only, never values**; secret management integration; TLS-terminating edge; documented separation of dev, staging, and production.

**Security acceptance criteria** — No secret is present in any image or repository file; containers run as non-root; environments are network-isolated from one another.
**Functional acceptance criteria** — Each environment builds and runs from the same artefact.
**Unit tests** — Not applicable.
**Integration tests** — Smoke test per environment.
**Negative tests** — Build fails when a required secret is absent.
**Authorization tests** — Staging credentials do not work against production.
**Migration tests** — Not applicable.
**Deployment strategy** — Stand up staging first; production last.
**Rollback strategy** — Previous image tag.
**Logs and metrics** — Deployment events; image provenance.
**Documentation** — Deployment runbook; environment matrix.
**Complexity** — High. **Operational risk** — Medium. **Downtime** — No. **Feature flag** — No. **Security review before deploy** — **Yes.**

---

## R3-5 — Backup, restore, and rehearsal

| Field | Value |
|---|---|
| **Findings** | Database audit Q25 |
| **Wave / Priority / Severity** | 3 / **P1** / High |
| **Objective** | Provide a proven recovery capability |
| **Business reason** | No backup exists because no database exists. A backup that has never been restored is not a backup |
| **Affected components** | Database infrastructure (post R4-1) |
| **Prerequisites** | **R4-1** |
| **Blocking decisions** | D-6 |

**Implementation tasks** — Enable managed backups and point-in-time recovery; **rehearse a restore into an isolated environment on a schedule and record the outcome**; document RPO and RTO; include object storage in the backup scope.

**Security acceptance criteria** — Backups encrypted at rest; access restricted and audited.
**Functional acceptance criteria** — A rehearsed restore reproduces a known dataset within the stated RTO.
**Migration tests** — Restore rehearsal is itself the test, and must be repeated after every schema migration.
**Other test categories** — Not applicable.
**Deployment strategy** — Enable with the database.
**Rollback strategy** — Not applicable.
**Logs and metrics** — Backup success/failure; age of last successful restore rehearsal.
**Documentation** — Disaster recovery runbook.
**Complexity** — Medium. **Operational risk** — Low. **Downtime** — No. **Feature flag** — No. **Security review before deploy** — Yes.

---

# WAVE 4 — ARCHITECTURE AND LONG-TERM SECURITY

---

## R4-1 — PostgreSQL persistence layer

| Field | Value |
|---|---|
| **Findings** | VAL-017 |
| **Wave / Priority / Severity** | 4 / **P1** / Critical |
| **Objective** | Replace in-memory state with a durable, transactional database |
| **Business reason** | All data — including the audit log — is lost on restart. Nothing can be investigated after the fact, no second replica is possible, and multi-step writes are non-atomic |
| **Affected components** | `store.ts` / `store.rs`; `db/schema.sql`; all route modules |
| **Prerequisites** | R1-1, R1-3, R3-4 |
| **Blocking decisions** | **D-1, D-2** |

**Implementation tasks**
1. **Rewrite `db/schema.sql`** per the database audit §8.1. **Do not execute the current file** — it requires an extension with no corresponding table and uses a primary-key type incompatible with the application's own identifiers.
2. Adopt a migration tool; create `db/migrations/`, which does not currently exist.
3. Formalise the `store.ts` seam into a repository interface with an explicit transaction boundary.
4. Keep the in-memory adapter for unit tests; run integration tests against a real database in CI.
5. Wrap multi-step writes in transactions.

**Security acceptance criteria** — Audit records are durable and append-only; no route bypasses the repository layer.
**Functional acceptance criteria** — Data written before a restart is readable after it.
**Unit tests** — Repository interface against the in-memory adapter.
**Integration tests** — Full suite against a real database in CI.
**Negative tests** — Transaction rollback on partial failure; constraint violations rejected.
**Authorization tests** — Entire Wave 1 matrix re-run against the persistent store.
**Migration tests** — Forward and backward migration; idempotent re-run; **restore rehearsal after migration**.
**Deployment strategy** — Provision, migrate, dual-write or accept a cutover window, then switch reads.
**Rollback strategy** — Documented per migration. **Backward migrations must be written and tested, not assumed.**
**Logs and metrics** — Query latency; pool saturation; migration status.
**Documentation** — Data model; migration runbook.
**Complexity** — **Very high.** **Operational risk** — **High.** **Downtime** — **Likely a cutover window.** **Feature flag** — Yes, per read path. **Security review before deploy** — **Yes.**

---

## R4-2 — Row-level security and tenant isolation

| Field | Value |
|---|---|
| **Findings** | Database audit SCH-01, SCH-03; long-term control for VAL-004/005 |
| **Wave / Priority / Severity** | 4 / **P2** / High |
| **Objective** | Enforce the tenant boundary in the database, behind the application checks |
| **Business reason** | Application-layer scoping was missing on four routes. A second, independent layer means a single missed check is no longer a breach |
| **Affected components** | Database schema; connection role; repository layer |
| **Prerequisites** | **R4-1** |
| **Blocking decisions** | **D-2** |

**Implementation tasks** — `NOT NULL` tenancy keys on every tenant-scoped table; enable RLS with policies keyed to a session variable; connect as a non-superuser role; set the tenant context per transaction.

**Security acceptance criteria** — With the application check deliberately removed in a test, RLS still prevents cross-tenant reads.
**Functional acceptance criteria** — No legitimate query is blocked.
**Unit tests** — Session-variable helper.
**Integration tests** — Queries under each tenant context.
**Negative tests** — **Query with the application filter removed returns nothing** — the definitive RLS proof.
**Authorization tests** — Cross-tenant attempts at the database layer.
**Migration tests** — Enabling RLS does not break existing queries.
**Deployment strategy** — Policies in permissive mode first, then enforcing.
**Rollback strategy** — Disable policies; application checks remain.
**Logs and metrics** — Policy-denial counts.
**Documentation** — Tenancy model.
**Complexity** — High. **Operational risk** — Medium. **Downtime** — No. **Feature flag** — Permissive mode acts as one. **Security review before deploy** — **Yes.**

---

## R4-3 — Data retention, erasure, and export

| Field | Value |
|---|---|
| **Findings** | Database audit SCH-08 |
| **Wave / Priority / Severity** | 4 / **P2** / Medium |
| **Objective** | Satisfy personal-data obligations |
| **Business reason** | Personal data — email, name, task geolocation, media — has no deletion or export path. An erasure request cannot currently be satisfied |
| **Affected components** | Schema; media storage; a new administrative surface |
| **Prerequisites** | R4-1, R2-3 |
| **Blocking decisions** | **D-6** — retention periods and applicable jurisdictions |

**Implementation tasks** — Soft delete with partial indexes; per-table retention policies; telemetry partition expiry; media lifecycle rules; an audited export and erasure capability; a data-classification catalogue.

**Security acceptance criteria** — Erasure removes or irreversibly anonymises all personal data across database and object storage, while preserving legally required audit records.
**Functional acceptance criteria** — Export produces a complete, machine-readable record.
**Unit tests** — Classification helper.
**Integration tests** — End-to-end export and erasure.
**Negative tests** — Erased data does not reappear in backups restored after the erasure date.
**Authorization tests** — Only the data subject and authorised admins may invoke either.
**Migration tests** — Retention columns backfill correctly.
**Deployment strategy** — Ship export first, erasure second.
**Rollback strategy** — **Erasure is irreversible — require explicit confirmation and an audit record before execution.**
**Logs and metrics** — Erasure and export request counts and completion times.
**Documentation** — Privacy policy; data-handling runbook.
**Complexity** — High. **Operational risk** — **High** (irreversible). **Downtime** — No. **Feature flag** — Yes. **Security review before deploy** — **Yes.**

---

## R4-4 — Encryption architecture and key rotation

| Field | Value |
|---|---|
| **Findings** | Hardening objective, informed by VAL-001 |
| **Wave / Priority / Severity** | 4 / **P2** / Medium |
| **Objective** | Manage keys and secrets systematically rather than ad hoc |
| **Business reason** | VAL-001 happened because a secret had no lifecycle. Rotation must be routine, not an incident response |
| **Affected components** | Secret management; database; object storage; token signing |
| **Prerequisites** | R3-4, R4-1 |
| **Blocking decisions** | D-2 |

**Implementation tasks** — Centralised secret storage; documented rotation schedule; support for overlapping key validity so rotation does not invalidate all sessions; encryption at rest for database and object storage; `pgcrypto` for specifically classified columns only.

**Security acceptance criteria** — Rotation completes without downtime or mass session invalidation; no secret exists outside the manager.
**Functional acceptance criteria** — Users unaffected by a rotation.
**Unit tests** — Multi-key verification during overlap.
**Integration tests** — Full rotation rehearsal.
**Negative tests** — Retired key rejected after the overlap window.
**Authorization tests** — Secret access restricted and audited.
**Migration tests** — Rotation from the current single-key model.
**Deployment strategy** — Introduce multi-key verification, then rotate.
**Rollback strategy** — Retain the previous key through the overlap window.
**Logs and metrics** — Key age; rotation events; verification by key ID.
**Documentation** — Key management policy; rotation runbook.
**Complexity** — High. **Operational risk** — Medium. **Downtime** — No, if overlap is implemented first. **Feature flag** — No. **Security review before deploy** — **Yes.**

---

## R4-5 — Security regression framework and threat-model maintenance

| Field | Value |
|---|---|
| **Findings** | Hardening objective; addresses the audit's own coverage gaps |
| **Wave / Priority / Severity** | 4 / **P2** / Medium |
| **Objective** | Prevent regression of every finding in this backlog |
| **Business reason** | **Every Critical finding in this audit sits in a module with zero tests.** Chat and finance are the only substantial modules with no test file, and between them they hold four of the six Criticals. That correlation is the root cause worth fixing |
| **Affected components** | Test suites; CI; `docs/` threat model |
| **Prerequisites** | R3-2 |
| **Blocking decisions** | None |

**Implementation tasks**
1. A named regression test per confirmed finding — **no finding may be closed on a code change alone**.
2. A reusable cross-tenant authorization test harness applied to every resource route.
3. Taint-analysis coverage for user-controlled data reaching filesystem, database, and command sinks — the gap that produced VAL-008.
4. Scheduled dependency and threat-model review; DAST and periodic penetration testing.
5. Raise coverage thresholds wave by wave, only after the tests exist.

**Security acceptance criteria** — Reintroducing any confirmed finding fails CI.
**Functional acceptance criteria** — Suite runtime stays within CI budget.
**Unit / integration / negative / authorization tests** — The harness itself is the deliverable.
**Migration tests** — Not applicable.
**Deployment strategy** — Continuous.
**Rollback strategy** — Not applicable.
**Logs and metrics** — Coverage trend; regression-catch rate.
**Documentation** — Threat model; test strategy; `docs/TEST_COVERAGE_TRACEABILITY.md`.
**Complexity** — Medium. **Operational risk** — Low. **Downtime** — No. **Feature flag** — No. **Security review before deploy** — No.

---

# Consistency check

**1. Every confirmed vulnerability maps to at least one remediation item.**

| Finding | Items |
|---|---|
| VAL-001 | R0-1, R1-2 |
| VAL-002, VAL-003 | R0-3, R1-3 |
| VAL-004, VAL-005 | R0-2, R1-1, R4-2 |
| VAL-006 | R0-2, R1-1 |
| VAL-007 | R2-1 |
| VAL-008 | R0-4, R2-2 |
| VAL-009 | R2-3 |
| VAL-010 | R2-4 |
| VAL-011 | R2-5 |
| VAL-012 | R1-5 |
| VAL-013 | R2-9 |
| VAL-014 | R1-2 |
| VAL-015 | R2-6 |
| VAL-016 | R1-6 |
| VAL-017 | R4-1 |
| VAL-018 | R0-0 |
| VAL-019 | R3-1 |
| SEC-M01 | R1-4 |
| SEC-M05 | R1-7 |
| SEC-M06 | R1-3 |
| SEC-M08 | R3-3 |
| API-01, API-02 | R2-7 |
| DSO-02, DSO-03 | R3-2 |
| DSO-04, DSO-11 | R3-4 |

**2. Every remediation item maps to a validated finding or a labelled hardening objective.** R1-8, R2-8, R4-4, and R4-5 are explicitly marked as hardening objectives rather than vulnerability fixes, per objective 7.

**3. Unsupported claims and false positives appear nowhere as implementation requirements.** Both false positives are excluded by name. The four unverified Rust findings appear only in investigation item R0-5. Unsupported tallies are used in no acceptance criterion.

**4. No circular dependencies.** Verified in `specs/SECURITY_REMEDIATION_DEPENDENCIES.md` §7.

**5. Wave 0 is the smallest viable emergency set.** Five items: one repository operation, two investigations with no code change, and two behavioural changes — a route disablement behind a flag and a three-line authorization assertion. No refactoring, no dependency upgrades, and no schema work, in compliance with rules 9 and 10.
