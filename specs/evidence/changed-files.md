# Evidence — Changed Files

## Created

| Path | Purpose |
|---|---|
| `webapp/server-node/src/security/passwords.ts` | scrypt KDF: `hashPassword`, `hashPasswordSync`, `verifyPassword` (timing-safe), `validatePasswordPolicy`, `isHashed` |
| `webapp/server-node/src/security/roles.ts` | Runtime role validation; `resolvePublicRegistrationRole`, `resolveAdminAssignedRole` |
| `webapp/server-node/src/security/rateLimit.ts` | In-process fixed-window limiter for credential endpoints |
| `webapp/server-node/src/security/uploads.ts` | MIME allow-list + magic-byte verification + size cap + filename sanitisation |
| `webapp/server-node/src/security/config.ts` | Fail-fast `AUTH_SECRET` / `CORS_ORIGINS` / demo-seed resolution |
| `webapp/server-node/test/security.test.ts` | 62 regression tests pinning every Wave 0 fix |
| `webapp/server-node/vitest.config.ts` | `._*` exclude, `NO_LISTEN`/`NODE_ENV` env, coverage thresholds |
| `webapp/server-rust/src/security.rs` | Rust parity: role validation + scrypt hashing + 5 unit tests |
| `mobile-app/vitest.config.ts` | `._*` exclude |
| `.gitignore` (root) | Ignores `node_modules`, `target`, coverage, uploads, `.env`, `._*` |
| `specs/REMEDIATION_BASELINE.md` | Phase 0 evidence, invalidated audit claims, new findings |
| `specs/AUDIT_PROPOSAL_REVIEW.md` | Accept / change / defer / reject decision per proposal |
| `specs/ARCHITECTURE_DECISION_REPORT.md` | ADR-ARCH/DATA/SEC/API/CLIENT/INT decisions |
| `specs/IMPLEMENTATION_REPORT.md` | What was implemented and verified |
| `specs/FINAL_VERIFICATION_REPORT.md` | Final recommendation |
| `specs/evidence/*.md` | Command log, test/coverage summaries, blocked checks, this file |
| `.github/workflows/ci.yml` | Build/typecheck/test/coverage gates (authored, unverified) |

## Modified

| Path | Change |
|---|---|
| `webapp/server-node/src/routes/auth.ts` | **GAP-01**: server decides the role (default `worker`; privileged → 403; unknown → 400). Password hashed on register, policy enforced, email validated, rate limited. Removed the plaintext `seedPassword` helper and its mid-file import. |
| `webapp/server-node/src/routes/users.ts` | `createUser` validates the role and throws on an unknown one; UUID ids instead of `u-${role}-${Date.now()}`; emails redacted for unprivileged callers; **new** `PATCH /admin/users/:id/role` (admin-only, audited). |
| `webapp/server-node/src/routes/tasks.ts` | **SEC-C4**: `GET /tasks` scoped to farm membership; `GET /tasks/:id` and `PATCH /tasks/:id/status` gated by `canAccessTask` (404 on tenancy failure); workers limited to their own assignment; reviewers cannot approve their own work; coordinate and worker-membership validation on create. |
| `webapp/server-node/src/routes/features.ts` | **GAP-02**: `POST /v2/videos` now runs `requirePermission` before `requireEntitlement`, checks `hasFarmAccess`, and takes `uploadedBy` from the session only. |
| `webapp/server-node/src/store.ts` | Plaintext `seedPasswords` Map replaced with a hashed credential store; demo fixtures hashed at seed and gated by `allowDemoSeed()`; `verifyPassword` is now async and constant-time; added `setPasswordHash`, `hasCredential`; seeded tasks carry `farmId: 'f-1'`. |
| `webapp/server-node/src/auth.ts` | `SECRET` resolved via `resolveAuthSecret()` — throws outside dev instead of falling back to the committed literal. |
| `webapp/server-node/src/index.ts` | CORS allow-list; multipart `limits`; `/uploads/` served with `nosniff` + sandbox CSP; global security headers; photo upload validated by magic bytes with a server-chosen extension; upload tenancy check. |
| `webapp/server-node/src/types.ts` | `Task.farmId` added (required). |
| `webapp/server-node/package.json` | Added `test:coverage` script. |
| `webapp/server-rust/src/routes/mod.rs` | **GAP-01** parity: server-decided role, password policy, scrypt hashing; login uses constant-time verification. |
| `webapp/server-rust/src/store.rs` | Credential map now holds PHC scrypt hashes; demo fixtures hashed at seed. |
| `webapp/server-rust/src/main.rs` | Registered `mod security`. |
| `webapp/server-rust/Cargo.toml` | Added `scrypt`, `password-hash`, `rand_core`. |
| `webapp/client/vite.config.ts` | Added a `test` block with the `._*` exclude. |
| `mobile-app/src/services/issuesService.ts` | **GAP-05**: `/evidence` → `/v2/evidence`. |

## Not modified (deliberately)

- The ~83,101 `._*` AppleDouble files — excluded and gitignored rather than
  bulk-deleted (irreversible, no git history).
- `webapp/server-node/src/authz.ts` — the blanket-admin bypass and the
  no-resource denial are real findings but need their own test wave.
- `mobile-app/src/services/webApi.ts` — GAP-12 remains open.
