# Wave 0 — Emergency Containment

> **Implementation prompt.** Hand this to the engineer or agent executing Wave 0.
> Planning artefact only — no production file has been modified in producing it.

---

## 1. Role

You are a senior application security engineer executing emergency containment on
a live codebase. Your mandate is **risk reduction with the smallest possible
change set**. You are not fixing architecture. You are not refactoring. You are
stopping active exposure and preserving evidence.

---

## 2. Objective

Contain four confirmed exposures and establish a rollback path, in a change set
small enough to be reviewed in a single sitting:

1. A committed signing secret that permits admin token forgery.
2. Two authorization bypasses allowing any authenticated user to read any chat.
3. Cross-tenant read and write of financial records.
4. A vulnerable dependency serving user-uploaded content.

Wave 0 is complete when these are contained — **not when they are correctly
engineered**. Permanent correction is Wave 1 and Wave 3.

---

## 3. Verified findings in scope

Only findings re-verified against source on 2026-08-27 are in scope.

| ID | Finding | Evidence | Status |
|---|---|---|---|
| **VAL-001** | Rust hardcoded fallback signing secret | [auth.rs:19-21](webapp/server-rust/src/auth.rs#L19) — literal on **line 20** | Confirmed |
| **VAL-002** | `GET /v2/chat/:id/messages` performs no membership check | [features.ts:184](webapp/server-node/src/routes/features.ts#L184) bare guard; [chat.ts:181](webapp/server-node/src/chat.ts#L181) `listMessages` takes no user parameter | Confirmed |
| **VAL-003** | Translate route performs no membership check | [chat.ts:227](webapp/server-node/src/chat.ts#L227); route [features.ts:196](webapp/server-node/src/routes/features.ts#L196) | Confirmed |
| **VAL-004** | Cross-tenant finance read | [farmsFinance.ts:54](webapp/server-node/src/routes/farmsFinance.ts#L54), [:94](webapp/server-node/src/routes/farmsFinance.ts#L94) — `farmId` is an optional filter | Confirmed |
| **VAL-005** | Cross-tenant finance write | [farmsFinance.ts:67](webapp/server-node/src/routes/farmsFinance.ts#L67) — `farmId` from request body | Confirmed |
| **VAL-006** | Farm directory returns all tenants | [farmsFinance.ts:51](webapp/server-node/src/routes/farmsFinance.ts#L51) | Confirmed |
| **VAL-018** | No repository-root version control | `git rev-parse --is-inside-work-tree` fails at root | Confirmed |
| **VAL-019** | `@fastify/static@8.3.0` serving `/uploads/` | `npm ls @fastify/static` | Confirmed |
| **VAL-008** | Client-controlled MIME substring reaches `join()` | [index.ts:50-55](webapp/server-node/src/index.ts#L50) | Confirmed weakness, **exploitability undetermined** |

---

## 4. Files and components in scope

| File | Change type |
|---|---|
| Repository root | `git init`, `.gitignore`, baseline commit |
| [webapp/server-rust/src/auth.rs](webapp/server-rust/src/auth.rs) | `secret()` — fail-closed guard |
| [webapp/server-node/src/routes/features.ts](webapp/server-node/src/routes/features.ts) | Two handlers — add membership assertion |
| [webapp/server-node/src/chat.ts](webapp/server-node/src/chat.ts) | `listMessages`, `messageInLang` — signature change |
| [webapp/server-node/src/routes/farmsFinance.ts](webapp/server-node/src/routes/farmsFinance.ts) | Four handlers — flag-gated 503 |
| `webapp/server-node/test/` | New regression tests |
| `webapp/server-rust/src/auth.rs` tests | New unit tests |
| Environment configuration | `AUTH_SECRET`, `FINANCE_ROUTES_ENABLED` |

---

## 5. Explicit exclusions

**Do not touch any of the following in Wave 0.**

| Excluded | Reason |
|---|---|
| Tenant scoping logic in `farmsFinance.ts` | Requires wiring `authz.ts` into a module that does not import it. Design change → Wave 1 |
| `@fastify/static` version bump | Two-major-version upgrade. Broad change → Wave 4 |
| `requirePermission()` signature | Changing the guard mid-emergency invalidates review → Wave 1 |
| Any database or schema work | No confirmed DB defect requires schema change to contain |
| `saveMedia()` behaviour | Investigate only; fix in Wave 3 |
| Mobile app changes | No Wave 0 mobile exposure requires a store release |
| **Memory-exhaustion "fix" for `toBuffer()`** | **False positive.** Global `fileSize` limit at [index.ts:80](webapp/server-node/src/index.ts#L80) already bounds it |
| **Stored-XSS "fix" for `/uploads/`** | **False positive.** CSP `default-src 'none'; sandbox` + nosniff already present at [index.ts:88-93](webapp/server-node/src/index.ts#L88) |
| SEC-H05, H07, H08, H10 | Not re-verified. Investigate in task 0.6; do not fix |

---

## 6. Prerequisites

| # | Prerequisite | Blocking |
|---|---|---|
| 1 | Confirm whether any Rust instance runs in any environment | **Yes** — determines VAL-001 urgency |
| 2 | Notify the web client team that the Finance page will return 503 | **Yes** — user-visible |
| 3 | Legal review: does cross-tenant financial access trigger notification obligations? | **Escalate before shipping**, not after |
| 4 | Access to environment configuration for every environment | **Yes** — task 0.2 |
| 5 | Confirm a git remote is available and branch protection can be enabled | Yes |

---

## 7. Required implementation sequence

**Strictly ordered. Do not parallelise across task boundaries.**

```
0.1  Root git repository + baseline commit      ← gates everything
0.2  Rotate AUTH_SECRET in all environments     ← BEFORE 0.3
0.3  Rust fail-closed secret guard
0.4  Chat membership assertions
0.5  Finance route containment flag
0.6  Investigations (no code change)
0.7  Dependency exposure mitigation review
```

### Task 0.1 — Root git repository

1. `git init` at repository root.
2. `.gitignore`: `node_modules/`, `target/`, `coverage/`, `uploads/`, `._*`, `.DS_Store`, `*.log`.
3. Commit the tree **untouched** as the baseline, before any remediation.
4. Push; enable branch protection with required review.
5. **Do not delete `mobile-app/.git`** — it has real history and a dirty working tree. Decide deliberately whether to nest or submodule.

### Task 0.2 — Rotate the exposed secret

1. Generate a new secret per environment with a cryptographic RNG, minimum 32 bytes.
2. Set `AUTH_SECRET` in every environment running a Rust instance.
3. **Never** log, echo, print, commit, or paste the value into any document, ticket, or chat.
4. Record only a yes/no per environment.

> **Ordering is mandatory.** Setting the variable must precede deploying task 0.3.
> Reversing the order causes an immediate boot failure.

### Task 0.3 — Rust fail-closed secret guard

**Symbol:** `secret()` in [webapp/server-rust/src/auth.rs](webapp/server-rust/src/auth.rs#L19)

Current shape:

```rust
pub fn secret() -> String {
    std::env::var("AUTH_SECRET").unwrap_or_else(|_| "REDACTED-DEV-LITERAL".into())
}
```

Required behaviour — reject at startup, not per request, when **outside a
development profile** any of these hold:

- `AUTH_SECRET` is unset
- it equals the known legacy literal
- it is shorter than 32 bytes

Development retains a permissive path so local work is unaffected. Mirror the
semantics of Node's `resolveAuthSecret()` — do not invent different rules.

### Task 0.4 — Chat membership assertions

**Symbols:** `listMessages` [chat.ts:181](webapp/server-node/src/chat.ts#L181),
`messageInLang` [chat.ts:227](webapp/server-node/src/chat.ts#L227);
handlers at [features.ts:184](webapp/server-node/src/routes/features.ts#L184) and
[features.ts:196](webapp/server-node/src/routes/features.ts#L196).

1. In the messages handler, call `assertMember(id, session.userId)` — the helper
   already exists at [chat.ts:126](webapp/server-node/src/chat.ts#L126) and is
   already used correctly by `sendMessage`, `setPin`, and `react`.
2. In the translate handler, resolve the parent conversation from the message,
   then assert membership **before** `activeTranslator()` is invoked.
3. **Change both signatures to require a `userId`.** This converts a future
   omission from a silent authorization bypass into a compile error. This is the
   single most valuable line of this wave.

> **Why fix rather than disable:** disabling chat reads breaks the primary mobile
> workflow. A three-line assertion reusing a proven helper is lower operational
> risk than a feature outage.

### Task 0.5 — Finance containment

**Symbols:** the four handlers in [farmsFinance.ts](webapp/server-node/src/routes/farmsFinance.ts#L51).

1. Introduce `FINANCE_ROUTES_ENABLED`, **default off**.
2. When off, all four handlers return `503` with a maintenance message, **before**
   any body parsing or authorization runs.
3. **Do not implement tenant scoping here.** That is Wave 1.

> **Why disable rather than fix:** correct scoping requires importing `authz.ts`
> into a module that currently imports only `requireRole`, and resolving farms
> through `buildActorContext()`. That is a design change and must not enter an
> emergency release.

### Task 0.6 — Investigations (no production code change)

**0.6a — `saveMedia` path containment (VAL-008).** Write a non-destructive unit
test asserting
`resolve(join(UPLOAD_DIR, filename)).startsWith(resolve(UPLOAD_DIR))` for
adversarial `ext` values including backslash sequences. Determine whether busboy
permits backslashes in a part's `Content-Type`. **No exploitation. No writes
outside the upload directory.** Record the result; route to Wave 3.

**0.6b — Rust findings re-verification.** Read and record file-and-line evidence
for SEC-H05 (upload limits), SEC-H07 (login rate limiting), SEC-H08 (CORS layer),
SEC-H10 (mutex poisoning). Update `specs/AUDIT_EVIDENCE_MATRIX.md`. **Fix
nothing.** This unblocks the canonical-backend decision in Wave 2.

### Task 0.7 — Dependency exposure mitigation

**Not an upgrade.** Confirm and record:

1. `index: false` is set on the static registration ([index.ts:87](webapp/server-node/src/index.ts#L87)) — this removes the directory-listing precondition for one advisory.
2. Whether any reverse proxy performs path canonicalisation before the app.
3. Whether `/uploads/` is reachable without authentication in each environment.

If the route is internet-facing and unauthenticated, propose an edge-level
path-canonicalisation rule as interim mitigation. The version bump is Wave 4.

---

## 8. Security invariants

These must hold at the end of Wave 0 and must never regress:

| # | Invariant |
|---|---|
| **I-1** | No running instance accepts a token signed with the legacy literal |
| **I-2** | No process starts outside development without a valid, sufficiently long signing secret |
| **I-3** | No user reads a conversation they are not a member of, by any route |
| **I-4** | The translation provider is never invoked for an unauthorized caller |
| **I-5** | No financial record is served to or created by any caller while containment is active |
| **I-6** | Every Wave 0 change is committed, attributable, and revertible |
| **I-7** | No secret value appears in any log, commit, document, or test fixture |

---

## 9. Exact expected code changes by file and symbol

| File | Symbol | Change |
|---|---|---|
| `webapp/server-rust/src/auth.rs` | `secret()` | Add fail-closed validation; remove reliance on the literal fallback outside dev |
| `webapp/server-node/src/chat.ts` | `listMessages(conversationId)` | → `listMessages(conversationId, userId)`; assert membership |
| `webapp/server-node/src/chat.ts` | `messageInLang(messageId, targetLang)` | → add `userId`; resolve conversation; assert membership before provider call |
| `webapp/server-node/src/routes/features.ts` | `GET /v2/chat/:id/messages` handler | Pass `session.userId`; map `ChatError` to 403/404 |
| `webapp/server-node/src/routes/features.ts` | `POST /v2/chat/messages/:messageId/translate` handler | Pass `session.userId` |
| `webapp/server-node/src/routes/farmsFinance.ts` | `farmFinanceRoutes` — all four handlers | Flag-gated 503 short-circuit |
| `.gitignore` (new) | — | Ignore build output, uploads, AppleDouble files |

**Files that must NOT change in Wave 0:** `authz.ts`, `index.ts`, `package.json`,
`db/schema.sql`, anything under `mobile-app/` or `webapp/client/`.

---

## 10. Secure structured logging

| Event | Level | Fields | Never log |
|---|---|---|---|
| Secret validation at startup | info | outcome (pass/fail), environment profile | **the secret, its length, or any prefix** |
| Chat membership denial | warn | `conversationId`, `userId`, route | message content |
| Finance route 503 | info | route, flag state | request body |
| Path-containment assertion failure | **error + alert** | attempted extension (sanitised) | full path |

The existing `log.warn('permission denied', …)` at
[authz.ts:198](webapp/server-node/src/authz.ts#L198) already emits warn-level
denial signals — reuse that shape rather than inventing a new one.

---

## 11. Tests to write before or with the changes

**Write the failing test first for every item below.**

### Rust (`webapp/server-rust`)
- `secret()` rejects: unset, legacy literal, under 32 bytes — three tests
- `secret()` accepts a valid secret — one test
- `verify()` rejects a token signed with the legacy literal — one test

### Node (`webapp/server-node/test/`)
- Non-member receives 403 from `GET /v2/chat/:id/messages`
- Member receives messages successfully
- Unknown conversation returns 404, not 500
- Non-member receives 403 from the translate route
- **Translation provider is not invoked when authorization fails** (spy assertion)
- Each of the four finance routes returns 503 when the flag is off
- 503 is returned before body parsing or authorization
- Path-containment assertion for adversarial `ext` values (task 0.6a, retained permanently)

### Authorization matrix
Each of worker, moderator, accountant, owner, admin against a conversation they
do not belong to → all 403.

---

## 12. Commands to run

```powershell
# Node backend — typecheck, tests, coverage
cd webapp/server-node
npm run check
npm run test
npm run test:coverage

# Rust backend
cd ../server-rust
cargo test

# Web client and mobile — confirm no collateral breakage
cd ../client;  npx tsc --noEmit; npx vitest run
cd ../../mobile-app; npx vitest run

# Dependency posture snapshot (record, do not act in Wave 0)
cd ../webapp/server-node; npm audit --json
```

> **Capture full output to a file and inspect the file.** A truncated terminal
> tail is not acceptable evidence for "no new failures".

---

## 13. Expected output

| Command | Expected |
|---|---|
| `npm run check` | Exit 0, no errors |
| `npm run test` | Exit 0. Baseline is **119 passing** — expect that plus the new Wave 0 tests, **zero failures** |
| `npm run test:coverage` | Exit 0; thresholds in [vitest.config.ts](webapp/server-node/vitest.config.ts) (60% global) still met |
| `cargo test` | Exit 0 with `AUTH_SECRET` set; **startup failure without it outside dev is the intended result** |
| `npm audit --json` | Recorded as a baseline snapshot; **no change expected in Wave 0** |

---

## 14. Verification checklist

- [ ] `git log` returns the baseline commit; force-push to the default branch is blocked
- [ ] `AUTH_SECRET` confirmed set in every environment (recorded as yes/no, no values)
- [ ] Rust process refuses to start outside dev without a valid secret
- [ ] A token signed with the legacy literal is rejected
- [ ] Non-member receives 403 from both chat routes
- [ ] Translation provider not invoked on authorization failure
- [ ] All four finance routes return 503
- [ ] VAL-008 investigation has a recorded yes/no and a committed test
- [ ] Four Rust findings have file-and-line evidence recorded
- [ ] **No secret value appears in any commit, log, or document**

---

## 15. Regression checklist

- [ ] All pre-existing Node tests still pass (baseline 119)
- [ ] `cargo test` passes
- [ ] Web client typechecks and builds
- [ ] Mobile tests pass
- [ ] Task, issue, upload, and auth routes behave unchanged
- [ ] Chat send, pin, and react still work for members
- [ ] `/uploads/` still serves with all three security headers intact
- [ ] No new dependency added

---

## 16. Rollback plan

| Task | Rollback | Constraint |
|---|---|---|
| 0.1 | Delete `.git/`; working tree untouched | Safe |
| 0.2 | **Do not roll back the rotation.** The old value is burned | Irreversible by design |
| 0.3 | Revert the guard commit | Safe; restores fail-open — **security sign-off required** |
| 0.4 | Revert | Restores the bypass — **security sign-off required** |
| 0.5 | Set `FINANCE_ROUTES_ENABLED=true` | Restores cross-tenant exposure — **security sign-off required** |
| 0.6, 0.7 | No production change | Not applicable |

**Rollback order if the whole wave must be reverted:** 0.5 → 0.4 → 0.3 → 0.1.
Never revert 0.2.

---

## 17. Evidence to capture

Store under `specs/evidence/wave-0/`:

1. Full output of every command in §12, redirected to files.
2. Baseline commit hash.
3. Per-environment `AUTH_SECRET` set confirmation — **yes/no only**.
4. Test run before and after, showing new tests failing then passing.
5. VAL-008 investigation result with the busboy determination.
6. Rust re-verification notes with file and line citations.
7. `npm audit --json` baseline snapshot.
8. Screenshot or transcript of branch protection enabled.

**Evidence-preserving incident check:** before deploying task 0.5, capture current
access logs for the finance routes and chat routes. If exploitation has occurred,
those logs are the only record — the audit log is in-memory and will not survive a
restart.

---

## 18. Acceptance criteria

Wave 0 is complete when **all** hold:

1. All seven security invariants in §8 hold.
2. Every checklist item in §14 and §15 is ticked with captured evidence.
3. All four test suites pass.
4. The VAL-008 question is answered yes or no with a committed regression test.
5. The four Rust findings carry a validated status in the evidence matrix.
6. Security review has signed off on the change set.
7. No file outside §4 was modified.

---

## 19. Stop conditions

**Halt immediately and escalate if any of these occur:**

| Condition | Action |
|---|---|
| VAL-008 confirmed exploitable | **Stop.** Escalate to Critical; fix in Wave 0, not Wave 3 |
| Evidence of prior exploitation in access logs | **Stop.** Trigger incident response before further deploys |
| A Rust instance is found internet-facing with the default secret | **Stop.** Take it offline before anything else |
| Any Wave 0 change requires touching `authz.ts` or `index.ts` | **Stop.** Scope creep — re-plan |
| Pre-existing tests begin failing | **Stop.** Do not proceed with a red baseline |
| A secret value is discovered in a log or commit | **Stop.** Rotate again and purge |
| The change set exceeds roughly 200 lines | **Stop.** Wave 0 must stay reviewable |

---

## 20. Handover to Wave 1

**Deliverables Wave 1 depends on:**

| Deliverable | Consumed by |
|---|---|
| Baseline commit and rollback path | All subsequent work |
| Finance routes contained behind a flag | Wave 1 re-enables them **after** scoping lands |
| Chat membership assertions | Wave 1 formalises the guard API around them |
| Rust re-verification evidence | **Wave 2's canonical-backend decision** |
| VAL-008 determination | Wave 3 media security |

**Open questions carried forward:**

- Is any Rust instance deployed? (blocks final VAL-001 severity)
- Does busboy permit backslashes in `Content-Type`? (blocks VAL-008 severity)
- Legal determination on notification obligations for VAL-004/005

**Wave 1 must not begin** until the Wave 0 change set is merged, deployed, and
verified. Wave 1 rewrites `farmsFinance.ts` and changes the `requirePermission`
signature — both conflict directly with Wave 0 files.
