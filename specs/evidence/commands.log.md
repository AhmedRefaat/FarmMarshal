# Evidence — Commands Executed

Every command below was actually run in this execution. Exit codes are as
reported by the shell. Commands that were *not* run are listed in
`blocked-checks.md`.

## Phase 0 — baseline (before any source change)

| # | Working dir | Command | Exit |
|---|---|---|---|
| 1 | `webapp/server-node` | `npm ci` | 0 |
| 2 | `webapp/server-node` | `npm test` | 1 |
| 3 | `webapp/client` | `npm ci` | 1 |
| 4 | `webapp/client` | `npm install` | 0 |
| 5 | `webapp/client` | `npx vitest run` | 1 |
| 6 | `mobile-app` | `npm ci` | 0 |
| 7 | `mobile-app` | `npx vitest run` | 1 |
| 8 | `webapp/server-rust` | `cargo test` | 0 |

## Wave 0 — after remediation

| # | Working dir | Command | Exit | Notes |
|---|---|---|---|---|
| 9 | `webapp/server-node` | `npx tsc --noEmit` | 0 | clean typecheck |
| 10 | `webapp/server-node` | `npx vitest run` | 0 | 57 tests, 3 files (pre-existing suites) |
| 11 | `webapp/server-node` | `npx vitest run test/security.test.ts` | 0 | 62 new security tests |
| 12 | `webapp/server-node` | `npx vitest run --coverage` | 0 | 119 tests, 4 files |
| 13 | `webapp/server-rust` | `cargo fetch` | 0 | resolved scrypt 0.11, password-hash 0.5 |
| 14 | `webapp/server-rust` | `cargo test` | 0 | 14 tests |
| 15 | `webapp/client` | `npx vitest run` | 0 | 2 tests |
| 16 | `mobile-app` | `npx vitest run` | 0 | 3 tests |

## Notes on execution reliability

- Command output was captured by redirecting to a file and reading it back.
  Inline terminal echoes are unreliable under this shell's prompt renderer.
- Port 3000 had to be freed before command #12 because the pre-fix test suite
  had bound it for real (see `REMEDIATION_BASELINE.md` §5, finding N-2).
