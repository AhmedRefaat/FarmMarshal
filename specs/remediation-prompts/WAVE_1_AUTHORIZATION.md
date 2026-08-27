# Wave 1 — Authorization and Tenancy

> **Implementation prompt.** Planning artefact — no production file modified in
> producing it.

---

## 1. Role

You are a senior application security engineer and backend architect responsible
for the authorization model. Your mandate is to make the tenant boundary
**explicit, uniform, and impossible to omit by accident**.

---

## 2. Objective

Replace Wave 0's containment with correct, permanent authorization:

1. Re-enable finance functionality with a server-side tenant boundary.
2. Eliminate the guard API that made VAL-002 and VAL-003 possible.
3. Establish farm and organisation boundaries consistently across every resource route.
4. Produce a denied-access test matrix that becomes the permanent regression net.
5. Reach the Node/Rust parity decision on evidence.

---

## 3. Verified findings in scope

| ID | Finding | Evidence | Status |
|---|---|---|---|
| **VAL-004** | Cross-tenant finance read | [farmsFinance.ts:54](webapp/server-node/src/routes/farmsFinance.ts#L54), [:94](webapp/server-node/src/routes/farmsFinance.ts#L94) | Confirmed |
| **VAL-005** | Cross-tenant finance write | [farmsFinance.ts:67](webapp/server-node/src/routes/farmsFinance.ts#L67) | Confirmed |
| **VAL-006** | Farm directory returns all tenants | [farmsFinance.ts:51](webapp/server-node/src/routes/farmsFinance.ts#L51) | Confirmed |
| **SEC-M06** | Action-less `requirePermission()` = authentication only | [authz.ts:190](webapp/server-node/src/authz.ts#L190) — `if (action)` skips evaluation entirely | Confirmed mechanism |
| **VAL-016** | `createConversation` accepts arbitrary `memberIds` | [chat.ts:110-121](webapp/server-node/src/chat.ts#L110) | Confirmed |
| **VAL-014** | Rust signature comparison not constant-time; comment falsely claims it is | [auth.rs:41-43](webapp/server-rust/src/auth.rs#L41) | Confirmed |
| **SEC-M06b** | `requireEntitlement` applied to one route only | Carried forward | Partially confirmed |
| **BL-17** | No membership management API | Traceability §3.4 | Functional gap enabling authorization |

**Conditional scope** — include only if Wave 0 task 0.6b confirmed them:
SEC-H07 (Rust login rate limiting), SEC-H08 (Rust CORS).

---

## 4. Files and components in scope

| File | Change |
|---|---|
| [webapp/server-node/src/authz.ts](webapp/server-node/src/authz.ts) | Split the guard; audit the permission matrix |
| [webapp/server-node/src/routes/farmsFinance.ts](webapp/server-node/src/routes/farmsFinance.ts) | Full authorization rewrite |
| [webapp/server-node/src/routes/features.ts](webapp/server-node/src/routes/features.ts) | Reclassify every bare-guard route |
| [webapp/server-node/src/chat.ts](webapp/server-node/src/chat.ts) | `createConversation` membership rules |
| [webapp/server-node/src/entitlements.ts](webapp/server-node/src/entitlements.ts) | Extend coverage to gated routes |
| `webapp/server-node/src/routes/` (new) | Membership management module |
| [webapp/client/src/pages/Finance.tsx](webapp/client/src/pages/Finance.tsx) | Migrate off `GET /farms` |
| `webapp/server-rust/` | Parity work **or** archival, per the decision |

---

## 5. Explicit exclusions

| Excluded | Reason |
|---|---|
| Database or schema work | Wave 2 |
| Input validation, file upload, media | Wave 3 |
| Session lifecycle and token revocation | Wave 3 |
| Dependency upgrades | Wave 4 |
| **Any false positive from the validation report** | Not implementation work |
| Rust findings still unverified after Wave 0 | Do not fix on speculation |

---

## 6. Prerequisites

| # | Prerequisite | Blocking |
|---|---|---|
| 1 | Wave 0 merged, deployed, verified | **Yes** — Wave 1 rewrites Wave 0 files |
| 2 | **Decision D-2: is `organizations` above `farms`?** | **Yes** — defines the boundary being enforced |
| 3 | **Decision D-1: one backend trail or two?** | **Yes** for the parity task |
| 4 | Wave 0 task 0.6b evidence complete | **Yes** — D-1 rests on it |
| 5 | Client team available for the `GET /farms` migration | Yes |

> **D-2 must be answered before task 1.2.** Enforcing a farm boundary is wasted
> work if the real boundary is the organisation. The repository models no
> organisation entity at all, so this cannot be resolved from code.

---

## 7. Required implementation sequence

```
1.1  Split the authorization guard          ← foundation for everything else
1.2  Finance authorization + re-enable
1.3  Route-by-route bare-guard reclassification
1.4  Chat authorization completion
1.5  Entitlement coverage
1.6  Membership management API
1.7  Node/Rust parity decision execution
1.8  Denied-access test matrix
```

### Task 1.1 — Split the guard

**Symbol:** `requirePermission` at [authz.ts:190](webapp/server-node/src/authz.ts#L190)

The current signature makes "authenticated only" the **silent default** when an
action is omitted. Both chat Criticals used this form.

1. Introduce `requireAuth()` — explicit, intentional, authentication only.
2. Make `requirePermission(action, getResource?)` require an action; omission
   becomes a **type error**.
3. Note the second, separate hazard: an action supplied **without** `getResource`
   yields `resource = {}`, which fails farm-scoped checks and silently makes a
   route admin-only. Detect and correct these too.

### Task 1.2 — Finance authorization

**Symbols:** all four handlers in `farmsFinance.ts`.

1. Import `authz.ts` — the module currently imports only `requireRole`.
2. Replace `requireRole` with `requirePermission` carrying an explicit action and
   a `getResource` resolving `farmId`.
3. Derive permitted farms from `buildActorContext()`; intersect with any requested
   `farmId`.
4. **Return 403 for a non-member, not an empty result set.** An empty set silently
   rewards probing and is indistinguishable from "no data".
5. Reject writes whose body `farmId` falls outside the actor's memberships.
6. Retire `GET /farms`; migrate the client to the already-correct
   `GET /v2/farms` ([v2.ts:153](webapp/server-node/src/routes/v2.ts#L153)).
7. Write an audit record for every ledger mutation.
8. Remove the `FINANCE_ROUTES_ENABLED` flag only after the matrix in task 1.8 passes.

### Task 1.3 — Bare-guard reclassification

1. **Enumerate every current bare `requirePermission()` call. Recount — do not
   trust the audit's figure of 26.**
2. Classify each route: legitimately auth-only, or missing a resource check.
3. Add resource-level checks where missing.
4. Record the classification per route in the evidence pack.

Known unscoped routes requiring attention: `GET /v2/videos`,
`POST /v2/videos/:id/complete`, comments, ratings, water summary, devices, trees,
consultations, cases, quizzes, expert document upload.

### Task 1.4 — Chat authorization completion

**Symbol:** `createConversation` [chat.ts:110-121](webapp/server-node/src/chat.ts#L110)

1. Require the creator to appear in `memberIds`.
2. Validate every member against a permitted-contact relationship — shared farm,
   or an assigned consultation.
3. Cap participant count.
4. Resolve open question A-5: are conversations always farm-scoped?

### Task 1.5 — Entitlement coverage

`requireEntitlement()` fails closed correctly at
[entitlements.ts:51-58](webapp/server-node/src/entitlements.ts#L51) but is applied
to **one** route. Apply it to every billable feature: translation, water, solar,
trees, marketplace, reports, video.

> `requireEntitlement` does **not** authenticate. It must always be paired with a
> permission guard, never used alone.

### Task 1.6 — Membership management API

Memberships drive every authorization decision but cannot be created, changed, or
revoked through any API. **Access cannot currently be revoked at all.** Add
authorized, audited endpoints restricted to farm owners and admins.

### Task 1.7 — Parity decision execution

*If D-1 = retire Rust:* remove from CI, archive outside the build, update every
document asserting parity.

*If D-1 = keep both:* the OpenAPI contract (Wave 3) becomes a **prerequisite**,
not a follow-up. Port every Node control and fix VAL-014 — replace the
short-circuiting `!=` with `Mac::verify_slice()` and **correct the false comment**.

### Task 1.8 — Denied-access test matrix

Build a reusable harness, not a set of one-off tests.

| Dimension | Values |
|---|---|
| Persona | worker, moderator, accountant, owner, admin, expert |
| Relationship | owner of resource, member of farm, non-member, suspended |
| Operation | read one, list, create, update, advance state, delete |
| Resource | task, issue, finance entry, conversation, message, media, video, device, tree, consultation |

**Every non-member combination must assert 403 or 404 — never 200.**

---

## 8. Security invariants

| # | Invariant |
|---|---|
| **I-1** | No route may be authenticated-only by accident; auth-only is explicit and deliberate |
| **I-2** | Every resource route resolves the tenant from the **resource**, never from client input |
| **I-3** | A non-member receives 403 or 404 — never an empty 200 |
| **I-4** | `farmId` in a request body is never trusted as an authorization input |
| **I-5** | Membership changes are audited and take effect immediately |
| **I-6** | Entitlement checks are always paired with a permission check |
| **I-7** | Wave 0 invariants I-1 through I-7 continue to hold |

---

## 9. Exact expected code changes by file and symbol

| File | Symbol | Change |
|---|---|---|
| `authz.ts` | `requirePermission` | Action becomes required |
| `authz.ts` | `requireAuth` (new) | Explicit authentication-only guard |
| `authz.ts` | `can` | Audit the permission matrix; confirm fail-closed default holds |
| `farmsFinance.ts` | `farmFinanceRoutes` | Full authorization rewrite; remove containment flag |
| `farmsFinance.ts` | `GET /farms` | Removed |
| `features.ts` | ~26 bare-guard routes | Reclassified |
| `chat.ts` | `createConversation` | Creator and contact validation |
| `entitlements.ts` | call sites | Extended to all gated features |
| new route module | membership CRUD | Owner/admin only, audited |
| `Finance.tsx` | farm fetch | `GET /v2/farms` |
| `auth.rs` | `verify` | `Mac::verify_slice()`; correct the comment |

---

## 10. Secure structured logging

Reuse the existing shape at [authz.ts:198](webapp/server-node/src/authz.ts#L198).

| Event | Level | Fields |
|---|---|---|
| Permission denied | warn | action, userId, personas, resource ref |
| Tenant boundary violation attempt | **warn + alert** | userId, requested farmId, permitted set size |
| Membership change | info + **audit** | actor, subject, farm, old role, new role |
| Finance mutation | info + **audit** | actor, farm, entry id, type, category |
| Entitlement denied | info | feature, farm, plan |

**Never log:** message content, financial amounts tied to identifiable tenants,
tokens, or secrets.

---

## 11. Tests to write before or with the changes

**Write the denied-access matrix first.** It should fail against current code.

- Cross-tenant finance read: omitted, empty, unknown, and foreign `farmId` → 403
- Cross-tenant finance write → 403, and **nothing appended**
- `GET /v2/farms` returns only owned ∪ member farms
- `requirePermission` without an action → compile error
- Every reclassified route: non-member → 403
- Conversation creation: creator absent → reject; unrelated member → reject
- Entitlement: gated feature without subscription → 403
- Membership: non-owner attempts change → 403; revocation takes effect immediately
- Rust (if retained): constant-time comparison; full Node matrix re-run

---

## 12. Commands to run

```powershell
cd webapp/server-node
npm run check
npm run test
npm run test:coverage

cd ../client
npx tsc --noEmit
npx vitest run
npm run build

cd ../server-rust
cargo test          # only if D-1 retains the trail
```

---

## 13. Expected output

| Command | Expected |
|---|---|
| `npm run check` | Exit 0 |
| `npm run test` | Exit 0; Wave 0 baseline plus the full matrix, zero failures |
| `npm run test:coverage` | Exit 0; **raise thresholds only after the matrix lands** — a permanently red gate trains people to ignore it |
| `npm run build` (client) | Exit 0 |
| `cargo test` | Exit 0, or the trail is archived |

---

## 14. Verification checklist

- [ ] D-1 and D-2 are recorded decisions with named owners
- [ ] `requirePermission` cannot be called without an action
- [ ] Every bare-guard route recounted and classified
- [ ] Finance routes re-enabled with the flag removed
- [ ] `GET /farms` removed; client migrated
- [ ] Non-member returns 403 across the full matrix
- [ ] Every ledger mutation produces an audit record
- [ ] Membership can be granted and **revoked** through the API
- [ ] Entitlements enforced on all gated features
- [ ] Rust trail archived, or at parity with tests proving it

---

## 15. Regression checklist

- [ ] All Wave 0 tests still pass
- [ ] Legitimate owners see their own finance data correctly
- [ ] Chat send, read, pin, react work for members
- [ ] Task and issue flows unchanged
- [ ] Finance page renders correct per-farm totals
- [ ] **403 rate monitored per route after each batch — a spike means over-restriction**

---

## 16. Rollback plan

| Task | Rollback |
|---|---|
| 1.1 | Revert; ship in batches so revert is granular |
| 1.2 | Re-set `FINANCE_ROUTES_ENABLED=false` → returns to **Wave 0 contained state, not the vulnerable state** |
| 1.3 | Per-batch revert |
| 1.4–1.6 | Revert individually |
| 1.7 | Restore from the Wave 0 baseline commit |

**Ship task 1.3 in reviewable batches by route group.** A single large
authorization change cannot be safely reverted in part.

---

## 17. Evidence to capture

Under `specs/evidence/wave-1/`:

1. Recorded D-1 and D-2 decisions with owner and date
2. Full bare-guard route inventory with classification
3. Denied-access matrix results, before and after
4. Full command output, redirected to files
5. Coverage report before and after
6. 403-rate metrics per route for 48 hours after each batch
7. Audit records produced by a sample membership change and ledger mutation

---

## 18. Acceptance criteria

1. All invariants in §8 hold.
2. The complete denied-access matrix passes.
3. Finance functionality restored with tenancy enforced.
4. No route is ambiguously guarded.
5. Membership is manageable and revocable.
6. The parity decision is executed, not merely recorded.
7. Security review sign-off.

---

## 19. Stop conditions

| Condition | Action |
|---|---|
| D-2 unanswered | **Stop before task 1.2.** Do not guess the tenancy root |
| D-1 unanswered | **Stop before task 1.7** |
| Matrix reveals an unreported cross-tenant path | **Stop.** Treat as a new Critical; contain first |
| 403 rate spikes after a batch | **Stop.** Roll back that batch; over-restriction is a real outage |
| Wave 1 requires schema change to proceed | **Stop.** That is Wave 2 |
| Coverage falls below the current gate | **Stop.** Do not lower the threshold to pass |

---

## 20. Handover to Wave 2

| Deliverable | Consumed by |
|---|---|
| **D-1 executed** | Wave 2's canonical backend — Wave 2 cannot start without it |
| **D-2 answered** | Tenant-aware schema design |
| Stable authorization surface | Repository layer boundaries |
| Denied-access matrix | Re-run against the persistent store in Wave 2 |
| Audit event shape | Durable audit table design |

**Open questions carried forward:** A-5 (conversation farm scoping),
organisation model shape, retention periods for audit records.

Wave 2 must not begin until the authorization surface is stable — building a
repository layer against a moving authorization model means building it twice.
