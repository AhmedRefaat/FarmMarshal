# Remediation Baseline

Phase 0 of the remediation directive. Records the verified state of the
repository **before** any production source was modified, plus the audit
findings that this baseline invalidated or added.

Everything below was produced by executing the command shown. Nothing in this
document is inferred.

---

## 1. Toolchain

| Tool | Version | Source |
|---|---|---|
| node | v24.12.0 | `node --version` |
| npm | 11.6.2 | `npm --version` |
| cargo | 1.93.0 (083ac5135 2025-12-15) | `cargo --version` |
| rustc | 1.93.0 (254b59607 2026-01-19) | `rustc --version` |
| OS | Windows, PowerShell (pwsh) | environment |

## 2. Dependency and lock inventory

| Package | Lock file | Size (bytes) |
|---|---|---|
| `mobile-app` | `package-lock.json` | 393,374 |
| `webapp/client` | `package-lock.json` | 180,252 (**regenerated during Phase 0**) |
| `webapp/server-node` | `package-lock.json` | 132,962 |
| `webapp/server-rust` | `Cargo.lock` | 26,387 |
| repository root | `package-lock.json` | 93 (stub) |

Only one git repository exists in the tree: `mobile-app/.git`. There is no
repository root `.git`, so most of the tree has no version-control history to
fall back on. This constrains remediation: destructive operations are not
recoverable and were therefore avoided.

## 3. Commands executed and their results

| # | Package | Command | Exit | Result |
|---|---|---|---|---|
| 1 | server-node | `npm ci` | 0 | 201 packages; 7 vulnerabilities (3 moderate, 2 high, 2 critical) |
| 2 | server-node | `npm test` | 1 | 57 real tests passed; 3 *files* failed — all `._*.test.ts` |
| 3 | client | `npm ci` | 1 | `npm error Missing: stackback@0.0.2 from lock file` |
| 4 | client | `npm install` | 0 | lock regenerated |
| 5 | client | `npx vitest run` | 1 | 2 tests passed; `src/._api.test.ts` failed |
| 6 | mobile-app | `npm ci` | 0 | install clean |
| 7 | mobile-app | `npx vitest run` | 1 | 3 tests passed; 2 `._*` files failed |
| 8 | server-rust | `cargo test` | 0 | 9 passed; 0 failed |

**Baseline real test count: 71 passing (57 + 2 + 3 + 9).**

## 4. Audit findings this baseline INVALIDATED

The audit recorded four suites as **"Blocked by environment"** and concluded
that *no test suite was observed to pass*. That conclusion is superseded.

| Audit claim | Verified reality |
|---|---|
| "vitest declared but not installed (TS2307)" in the client | The real cause was a **stale `package-lock.json`**: `vitest` had been added to `devDependencies` but the lock was never regenerated, so `npm ci` refused to install. `npm install` fixed it. |
| "No test suite observed to pass" | All four suites contain passing tests. 71 passed at baseline. |
| "Blocked by environment" ×4 | Entirely an artifact of macOS-installed `node_modules` plus the stale lock. A clean install resolved all four. |
| Static test counts (57 / 9 / 2 / 3) | **Confirmed exactly correct** when executed. |

## 5. NEW findings the audit missed or under-weighted

### N-1 — AppleDouble files break test collection (severity: High)
The audit noted `._*` files were "safe to delete" but did not identify that
they **actively break every JS/TS test gate**. Vitest's default glob matches
`._routes.test.ts` as a test file and esbuild aborts with
`ERROR: Unexpected "\x00"` on the resource-fork content
(`Mac OS X ... This resource fork intentionally left blank`).

Consequence: every JS/TS suite exited non-zero regardless of test outcome, so
**no CI gate could ever have been green**. This is the single highest-impact
non-security defect found.

Decision: do **not** mass-delete ~83,101 files (irreversible, and the directive
forbids deleting data). Instead each vitest config now carries
`exclude: ['**/._*']`, and a root `.gitignore` prevents recurrence. An opt-in
cleanup script is deferred to WP-2.4.

### N-2 — The Node test suite bound a real TCP port (severity: Medium)
`src/index.ts` calls `app.listen()` at import time unless `NO_LISTEN=1`. The
test files set `process.env.NO_LISTEN = '1'` inside `beforeAll`, which runs
**after** module evaluation — so it never took effect. `package.json`'s `test`
script did not set it either. The suite therefore bound `0.0.0.0:3000` for real
and failed with `EADDRINUSE` whenever a dev server or a parallel run was live.

Fixed by setting `env: { NO_LISTEN: '1', NODE_ENV: 'test' }` in
`webapp/server-node/vitest.config.ts`, which applies before any import.

### N-3 — Stale client lock file (severity: Medium)
Root cause of the audit's misattributed "vitest not installed" finding. Now
regenerated. A CI `npm ci` gate would have caught this at the commit that
introduced it.

## 6. Environment limitations recorded

| Limitation | Impact |
|---|---|
| No repository-root git history | Destructive changes are unrecoverable; all edits kept additive and reviewable. |
| 7 npm vulnerabilities in server-node (2 critical) | Not remediated in Wave 0 — requires dependency bumps with their own regression risk. Tracked as WP-1.10. |
| No PostgreSQL instance available | GAP-04 (persistence) cannot be implemented or verified in this execution. |
| Rust debug build hashes slowly | `cargo test` now takes ~86 s because scrypt runs unoptimised. Acceptable; CI should use `--release` for timing-sensitive work. |

---

## 7. Baseline verdict

The repository was **buildable and typecheckable** at baseline, had **71
passing tests**, and had **no working test gate**. The audit's severity ranking
for security findings held up under revalidation; its test-infrastructure
conclusions did not.
