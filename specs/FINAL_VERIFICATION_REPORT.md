# Final Verification Report

Covers Wave 0 only. Every claim below is backed by a command that was executed
in this session; see `specs/evidence/commands.log.md`.

---

## 14.1 — Verification commands executed

| Package | Command | Exit |
|---|---|---|
| server-node | `npx tsc --noEmit` | **0** |
| server-node | `npx vitest run --coverage` | **0** |
| server-rust | `cargo test` | **0** |
| client | `npx tsc --noEmit` | **0** |
| client | `npx vitest run` | **0** |
| mobile-app | `npx tsc --noEmit` | **0** |
| mobile-app | `npx vitest run` | **0** |

## 14.2 — Test results

**138 tests pass across four suites; all four exit 0.**

| Suite | Tests | Exit |
|---|---|---|
| server-node | 119 | 0 |
| server-rust | 14 | 0 |
| client | 2 | 0 |
| mobile-app | 3 | 0 |

At baseline this was 71 tests with three of four suites exiting non-zero.

## 14.3 — Coverage results

```
Statements   : 72.01% ( 2177/3023 )
Branches     : 70.87% ( 528/745 )
Functions    : 67.26% ( 150/223 )
Lines        : 72.01% ( 2177/3023 )
```

Enforced thresholds: 60% global, 90%/85% on `src/security/**`. The run exits 0,
so both are satisfied.

**The directive's 95% global and 100% security-branch targets are NOT met.**
This is stated explicitly and is not claimed.

## 14.4 — Security findings closed

| ID | Severity | Status | Regression tests |
|---|---|---|---|
| GAP-01 / SEC-C1 privilege escalation | Critical | **Closed, both trails** | 23 + 5 elevation + 1 Rust |
| GAP-02 / SEC-C2 unauthenticated video | Critical | **Closed** | 3 |
| SEC-C3 plaintext passwords | Critical | **Closed, both trails** | 11 + 4 Rust |
| SEC-C4 broken object-level authz | Critical | **Closed** | 12 |
| GAP-05 broken evidence endpoint | High | **Closed** | verified by path correction |
| SEC-H5 permissive CORS | High | **Closed** | 6 (shared with H8) |
| SEC-H6 upload validation | High | **Closed** | 8 |
| SEC-H7 no brute-force protection | High | **Closed (interim)** | 2 |
| SEC-H8 hardcoded signing secret | High | **Closed** | 6 |

## 14.5 — Security findings still open

| ID | Severity | Why still open |
|---|---|---|
| GAP-04 persistence | **Critical** | No database instance available. All data lost on restart. |
| npm vulnerabilities (7, 2 critical) | High | Dependency bumps need their own regression wave. |
| `authz.can()` blanket admin bypass | Medium | Behaviour change affects 6 routes; needs a dedicated test wave. |
| `requirePermission()` no-resource denial | Medium | Fails closed, so functional not exploitable. |
| GAP-12 mobile `BASE_URL` | Medium | Needs an environment-config strategy. |
| Rate limiting is per-process | Medium | Breaks on a second replica. |

## 14.6 — Blocked checks

Recorded in full in `specs/evidence/blocked-checks.md`. Summary: persistence
verification, 95% coverage, Rust coverage, `npm audit` remediation, E2E, load
testing, mobile device testing, contract tests, CI execution, and DAST were all
**not performed**.

## 14.7 — Remaining risks

1. **Data loss on every restart (GAP-04).** The platform cannot hold real data.
   This alone precludes any production or pilot use.
2. **CI is unverified.** The workflow has never run.
3. **Two backend trails must be patched in parallel.** GAP-01 existed in
   duplicate for exactly this reason; the next security fix will too.
4. **Coverage is 72%, not 95%.** Untested branches remain in `authz.ts` and the
   feature routes.
5. **Known-vulnerable dependencies** remain, including two rated critical.

## 14.8 — Recommended next implementation step

**WP-1.1 — implement GAP-04 persistence** behind the existing `store.ts` seam,
which was designed for this swap. Provision PostgreSQL, execute
`webapp/server-node/db/schema.sql` (never yet run), add the `farmId` column and
index introduced by ADR-DATA-001, and port the 119 existing tests to run against
it.

Prerequisite stakeholder decision: **one backend trail or two.**

## 14.9 — Final release recommendation

> ## NO-GO for production.
> ## GO FOR INTERNAL TESTING.

**Rationale.** Wave 0 closed four Critical and five High security findings, each
with dedicated regression tests, and took the repository from *no working test
gate at all* to 138 passing tests across four green suites. That is enough to
justify internal, non-production use with synthetic data.

It is **not** enough for production or for a pilot with real users:

- All data is lost on restart (GAP-04). This is disqualifying on its own.
- Coverage is 72%, well short of the 95% bar.
- Known-critical dependency vulnerabilities are unpatched.
- The CI pipeline has never executed.
- No end-to-end, contract, load, or device testing has been performed.

Revisit this recommendation once GAP-04 lands and the CI workflow has produced
its first green run.
