# Audit Proposal Review

Independent assessment of every proposal in `specs/Audit.md`. The audit is an
input, not a verdict. Each item was re-verified against the repository before a
status was assigned.

**Status vocabulary:** Accepted · Accepted with changes · Deferred · Rejected ·
Blocked by missing information · Replaced by a better proposal

---

## 1. Critical and High findings

### GAP-01 — Privilege escalation via public registration
- **Audit rationale:** `POST /auth/register` passes a caller-supplied `role` to
  `createUser`.
- **Independent verification:** Confirmed in both trails.
  `webapp/server-node/src/routes/auth.ts` destructured `role?: Role` and passed
  it through; `Role` is a TypeScript type and is erased at runtime, so nothing
  validated it. `webapp/server-rust/src/routes/mod.rs` did the same with
  `body["role"].as_str()`. An unauthenticated `{"role":"admin"}` created a
  platform administrator.
- **Status: Accepted.** Fixed in both trails.
- **Changes vs. the audit's proposal:** the audit suggested silently forcing the
  role to `worker`. Rejected that detail — silent downgrade hides attack
  attempts. Privileged values now return **403** and are logged at warn level;
  unknown values return **400**. Omitted values get the safe default.

### GAP-02 — Unauthenticated video creation
- **Audit rationale:** `POST /v2/videos` is guarded only by
  `requireEntitlement('video_platform')`.
- **Independent verification:** Confirmed. `requireEntitlement`
  (`src/entitlements.ts` L68) resolves a farm from the request and checks a plan
  — it **never authenticates**. `uploadedBy` fell back to a client-supplied
  `sourceDeviceId` or the literal `'unknown'`, destroying attribution.
- **Status: Accepted.** `requirePermission` now runs first, `hasFarmAccess`
  gates the target farm, and `uploadedBy` comes from the session only.

### GAP-03 — Plaintext password storage
- **Audit rationale:** `seedPasswords` is a plaintext `Map`; `verifyPassword` is
  a string comparison.
- **Independent verification:** Confirmed at `store.ts` L75-80 and L198-200, and
  in Rust at `store.rs` L25.
- **Status: Accepted with changes.** See ADR-SEC-002 — the directive prefers
  Argon2id; scrypt was chosen instead. Rationale in
  `specs/ARCHITECTURE_DECISION_REPORT.md` §C.

### SEC-C4 — Broken object-level authorization on tasks (audit ranked High)
- **Audit rationale:** task routes check role but not ownership.
- **Independent verification:** Confirmed, and **worse than the audit stated**.
  `GET /tasks` returned every task on the platform to any authenticated caller;
  `GET /tasks/:id` had no check at all; `PATCH /tasks/:id/status` validated role
  and from-state but never ownership, so any worker could start or submit any
  other worker's task.
- **Status: Accepted, severity raised to Critical.** This is OWASP A01 and was
  exploitable by any registered user.
- **Replaced proposal:** the audit proposed adding ownership checks only. That
  is insufficient — `Task` had no tenancy field at all, so "ownership" was
  undefined. Added a required `farmId` to `Task`, derived server-side from the
  creator's farm membership, and authorized against it.

### GAP-05 — Mobile evidence upload targets a non-existent endpoint
- **Independent verification:** Confirmed. `mobile-app/src/services/issuesService.ts`
  called `/evidence`; both backends expose only `/v2/evidence`. The unit test
  mocks `webApi`, so the wrong path was invisible to it.
- **Status: Accepted.** One-line fix applied. Note the deeper problem: mocking
  the transport made a 100%-failing runtime path look tested. Contract tests are
  required — see WP-3.1.

### SEC-H5 / SEC-H8 — CORS and signing-secret defaults
- **Verification:** Confirmed. `cors({ origin: true })` reflects any origin;
  `AUTH_SECRET` fell back to the committed literal `'agritasks-dev-secret'`.
- **Status: Accepted.** Both now fail fast outside development.

### SEC-H6 — Upload validation
- **Verification:** Confirmed and expanded. Beyond the audit's "no size cap",
  the stored **file extension was derived from the client-declared MIME type**
  and written into a statically served directory.
- **Status: Accepted with changes** — added magic-byte verification, which the
  audit did not propose. A MIME allow-list alone is insufficient because the
  declared type is caller input.

### SEC-H7 — No brute-force protection
- **Status: Accepted with changes.** The audit proposed `@fastify/rate-limit`.
  Replaced with a ~90-line in-process limiter to avoid a new dependency in a
  security-critical path. **Explicitly documented as insufficient for
  horizontal scaling** — it is per-process and does not survive restart.

---

## 2. Proposals deferred, rejected, or blocked

| Proposal | Status | Reasoning |
|---|---|---|
| **GAP-04 — PostgreSQL persistence** | **Deferred (Wave 2)** | Correctly identified and genuinely Critical: all data is in-memory `Map`s and is lost on restart. Not implementable here — no database instance is available, and `db/schema.sql` has never been executed. This is the single largest remaining risk. |
| **Delete all `._*` files** | **Replaced** | The audit called them "safe to delete" but missed that they break every test gate (see baseline N-1). ~83,101 files with no git history is an irreversible bulk delete. Replaced with vitest excludes + `.gitignore`, which fixes the actual impact at zero risk. |
| **OpenAPI-first contract** | **Deferred (Wave 3)** | Sound, and would have caught GAP-05. Large effort across four codebases; sequencing it before the security fixes would have delayed them. |
| **MQTT for IoT ingest** | **Blocked by missing information** | No broker, no device fleet, and no stated message volume. Cannot size or justify. Needs a stakeholder decision on the actual device population. |
| **TimescaleDB for telemetry** | **Deferred** | Premature — depends entirely on GAP-04 landing first. Plain PostgreSQL is sufficient at demo volume. |
| **Object storage (S3/GCS) for media** | **Deferred (Wave 2)** | Correct direction. The interim `setHeaders` CSP/nosniff hardening on `/uploads/` addresses the immediate exploit risk. |
| **Replace React with an alternative** | **Rejected** | The audit floated this without a defect to justify it. No React-attributable problem was found. Churn with no security or correctness benefit. |
| **Rust backend specialization** | **Rejected as stated** | The audit proposed keeping both trails and specializing Rust for telemetry. Two hand-maintained implementations of the same API is precisely why GAP-01 existed in duplicate. Recommend a stakeholder decision to pick one trail; until then both must receive every security fix (as done here). |
| **`blanket admin → return true` in `authz.can()`** | **Accepted, deferred** | Real finding. Platform admin should not imply tenant data access. Not changed in Wave 0 because it would alter behaviour six other routes depend on; needs its own test wave. Task-level access now deliberately does *not* honour it. |
| **`requirePermission()` with no `getResource` denies all non-admins** | **Accepted, deferred (WP-1.8)** | Confirmed: `resource = {}` → `farmId` undefined → denial. Makes 6 routes accidentally admin-only. A functional defect, not a security hole (it fails closed), so it ranks below the escalation fixes. |
| **95% global coverage gate** | **Accepted with changes** | Not achievable in one execution — see §3. Thresholds set to the *currently verified* level (60%) with a higher bar on `src/security/**`, and raised per wave. Setting an unmet threshold would leave the gate permanently red and train the team to ignore it. |

---

## 3. Coverage: honest position

`@vitest/coverage-v8` was already a devDependency. Coverage now runs and is
enforced.

**Measured, not claimed:**

```
Statements   : 72.01% ( 2177/3023 )
Branches     : 70.87% ( 528/745 )
Functions    : 67.26% ( 150/223 )
Lines        : 72.01% ( 2177/3023 )
```

The directive's 95% global target and 100% branch coverage on all
security-critical modules are **not met** and are not claimed to be met.
Thresholds are configured at the verified level so the gate is honest today,
with a documented ratchet in `specs/DETAILED_IMPLEMENTATION_PLAN.md`.

---

## 4. Required stakeholder decisions

| # | Decision | Consequence of postponement |
|---|---|---|
| 1 | **One backend trail, or two?** | Every security fix must be written twice. GAP-01 existed in duplicate for exactly this reason. |
| 2 | **Provision PostgreSQL** | GAP-04 stays open; all data is lost on every restart. Blocks any real pilot. |
| 3 | **Argon2id vs scrypt** (ADR-SEC-002) | None immediate — scrypt is OWASP-recommended. Revisit only if a policy mandates Argon2id. |
| 4 | **Shared rate-limit store (Redis)** | Throttling breaks the moment a second replica is added. |
| 5 | **Device fleet size and protocol** | MQTT and telemetry storage cannot be designed without it. |
