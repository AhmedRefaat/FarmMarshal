# Implementation Report — Wave 0

Scope: the emergency security remediation defined in directive §6, plus the
test-infrastructure repairs required to verify it. **Wave 0 only.** Waves 1–8
are planned but not implemented.

---

## 1. What was fixed

### GAP-01 / SEC-C1 — Privilege escalation via public registration (**Critical**)

`POST /auth/register` accepted a caller-supplied `role` and inserted it. Because
`Role` is a TypeScript type erased at runtime, an unauthenticated request with
`{"role":"admin"}` created a platform administrator. The Rust trail had the
identical defect via `body["role"].as_str()`.

**Fix (both trails):** the role is decided by the server.

| Input | Result |
|---|---|
| omitted / `null` / `""` | `worker` (safe default), 201 |
| `"worker"` | `worker`, 201 |
| `"admin"`, `"owner"`, `"moderator"` | **403** + warn-level log |
| unrecognised string | **400** |
| non-string (object, array, number, boolean) | **400** |

Elevation now has exactly one path: `PATCH /admin/users/:id/role`, which
requires an authenticated administrator and writes an append-only audit record.

### GAP-02 / SEC-C2 — Unauthenticated video creation (**Critical**)

`POST /v2/videos` was guarded only by `requireEntitlement('video_platform')`,
which resolves a plan from a caller-supplied `farmId` and **never
authenticates**. Anyone on the network could create video records against any
entitled farm, and `uploadedBy` fell back to a client value or `'unknown'`.

**Fix:** `requirePermission` runs first, `hasFarmAccess` gates the target farm,
and `uploadedBy` is taken from the verified session only.

### SEC-C3 — Plaintext password storage (**Critical**)

`seedPasswords` was a plaintext `Map` and `verifyPassword` was `===`. Rust was
equivalent.

**Fix:** scrypt (N=2^15, r=8, p=1, 32-byte key, 16-byte random salt) in both
trails. Verification is constant-time. Malformed stored values return `false`
rather than throwing, so a corrupted record cannot become a bypass or a 500.
Cost parameters read from storage are bounded so a tampered record cannot pin
the event loop. Demo fixtures are hashed at seed time and only seeded when
`allowDemoSeed()` permits it — a production-like `NODE_ENV` starts with no
accounts rather than with published credentials.

See ADR-SEC-002 for why scrypt rather than the directive's preferred Argon2id.

### SEC-C4 — Broken object-level authorization on tasks (**Critical**)

Worse than the audit recorded. `GET /tasks` returned **every task on the
platform** to any authenticated caller. `GET /tasks/:id` had no check at all.
`PATCH /tasks/:id/status` validated role and from-state but never ownership, so
any worker could start or submit any other worker's task.

The underlying problem was that `Task` had **no tenancy field**, so ownership
was undefined.

**Fix:** `Task.farmId` added (required, server-derived from the creator's farm
membership). All three routes authorize through `canAccessTask`. Workers are
further limited to their own assignment. Reviewers cannot approve their own
work. Tenancy failures return **404, not 403**, so the endpoint is not an
id-enumeration oracle.

### GAP-05 — Broken evidence upload

`mobile-app` called `/evidence`; both backends expose only `/v2/evidence`. Every
evidence upload failed at runtime. The unit test mocked `webApi`, so it passed
anyway — mocking the transport made a 100%-failing contract look tested.

**Fix:** one-line path correction. The systemic lesson is recorded as ADR-API-001.

### SEC-H5 / SEC-H6 / SEC-H7 / SEC-H8 — Hardening

| Finding | Before | After |
|---|---|---|
| CORS | `origin: true` (reflects any origin) | Allow-list from `CORS_ORIGINS`; **throws at boot** in non-dev if unset |
| Signing secret | Fell back to committed `'agritasks-dev-secret'` | **Throws at boot** outside dev if missing, too short, or the published literal |
| Uploads | No size cap, no allow-list, extension from client MIME | `limits` on multipart, MIME allow-list **and** magic-byte check, server-chosen extension, `nosniff` + sandbox CSP on `/uploads/` |
| Brute force | None | Fixed-window limiter on login (IP+identity) and register (IP), 429 + `Retry-After` |
| Response headers | None | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, CORP on every response |

### Additional fixes not in the audit

- User ids were `u-${role}-${Date.now()}` — leaked the role and collided under
  concurrent registration. Now UUIDs.
- `GET /users` returned every user's email to any authenticated caller. Now
  redacted for unprivileged roles.
- Registration had no email-format or length validation.
- Task creation accepted any `lat`/`lng`, including out-of-range and
  non-numeric values, and allowed assigning a worker from another farm.

---

## 2. Test infrastructure repaired

Both were blocking any possibility of a CI gate.

**AppleDouble files broke test collection.** Vitest matched `._*.test.ts` and
esbuild aborted with `Unexpected "\x00"`. Every JS/TS suite exited non-zero
regardless of results. Fixed with `exclude: ['**/._*']` in all three vitest
configs plus a root `.gitignore`. The ~83,101 files were **not** deleted —
irreversible, and the directive forbids deleting data.

**The Node test suite bound a real TCP port.** `NO_LISTEN` was set in
`beforeAll`, which runs *after* module evaluation, so it never took effect.
Moved to `vitest.config.ts` `env`.

---

## 3. Verification

All commands below were executed; exit codes are as reported.

| Suite | Baseline | Now |
|---|---|---|
| server-node | 57 tests, **exit 1** | **119 tests, exit 0** |
| server-rust | 9 tests, exit 0 | **14 tests, exit 0** |
| client | 2 tests, **exit 1** | **2 tests, exit 0** |
| mobile-app | 3 tests, **exit 1** | **3 tests, exit 0** |
| **Total** | 71, 3 suites red | **138, all green** |

Typechecks: `npx tsc --noEmit` exits 0 in server-node, client, and mobile-app.

Coverage (server-node, measured):

```
Statements   : 72.01% ( 2177/3023 )
Branches     : 70.87% ( 528/745 )
Functions    : 67.26% ( 150/223 )
Lines        : 72.01% ( 2177/3023 )
```

**62 new security regression tests** pin every Wave 0 fix. Each Critical and
High finding has at least one dedicated test. Breakdown in
`specs/evidence/test-results-summary.md`.

---

## 4. What was NOT done

- **GAP-04 persistence** — no database available. All data is still lost on
  restart. This is the largest remaining risk.
- **95% coverage / 100% security-module branch coverage** — not met, not claimed.
- **7 npm vulnerabilities** (2 critical) — not remediated.
- **`authz.can()` blanket-admin bypass** and **`requirePermission()` no-resource
  denial** — real findings, deferred to their own test wave.
- **Mobile `BASE_URL`** (GAP-12) — still hardcoded to `localhost`.
- **CI workflow** — authored but never executed; there is no repository-root git
  remote.

Full list in `specs/evidence/blocked-checks.md`.

---

## 5. Safe continuation point

The repository is **buildable, typechecking, and fully green** at this commit.
Nothing is partially migrated. The next step is WP-1.1: provision PostgreSQL and
implement GAP-04 behind the existing `store.ts` seam, which was designed for
exactly this swap.
