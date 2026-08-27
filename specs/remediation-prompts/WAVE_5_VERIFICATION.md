# Wave 5 — Verification and Release Readiness

> **Implementation prompt.** Planning artefact — no production file modified in
> producing it.

---

## 1. Role

You are an independent security verification lead. Your mandate is to **prove or
disprove** that the remediation programme achieved its objectives, and to state a
release verdict that can be defended with evidence.

> **Independence matters.** Verification carried out solely by the engineers who
> implemented the fixes tends to confirm what they intended rather than what they
> built.

---

## 2. Objective

1. Run full regression across all four workspaces.
2. Verify the authorization matrix independently.
3. Complete dependency and static analysis review.
4. Test migration and restore under realistic conditions.
5. Execute security testing in staging.
6. Produce a residual-risk register.
7. Issue a readiness verdict.

---

## 3. Verified findings in scope

**Every finding from Waves 0–4 is in scope for verification.** This wave adds no
new remediation.

| Category | Verify |
|---|---|
| Wave 0 | VAL-001, VAL-002, VAL-003, VAL-018; containment removed only where replaced |
| Wave 1 | VAL-004, VAL-005, VAL-006, VAL-016, SEC-M06, SEC-M06b, VAL-014 |
| Wave 2 | VAL-017, SEC-M08, confirmed SCH defects |
| Wave 3 | VAL-007 to VAL-013, VAL-015, SEC-M01, SEC-M05, API-01/02, WEB-03/06 |
| Wave 4 | VAL-019, SEC-M03, DSO-02/03/04/11 |

**Explicitly verify as still-excluded:**

| Item | Expected state |
|---|---|
| Memory exhaustion via `toBuffer()` | Remains a **false positive**; confirm the `fileSize` limit still exists |
| Stored XSS via `/uploads/` | Remains a **false positive**; confirm the CSP and `nosniff` headers survived Wave 3 |
| `client/dist/` claim | Withdrawn |
| `firebase-admin` bundling | Withdrawn; confirm it is still a devDependency in both manifests |

**Findings that must NOT appear as "remediated":** SEC-H05, SEC-H07, SEC-H08,
SEC-H10 (never re-verified), and payment security (no code exists).

---

## 4. Files and components in scope

Verification is **read-only** with respect to production code. Only these are
written:

| Artefact | Purpose |
|---|---|
| `specs/evidence/wave-5/` | All verification output |
| `specs/RESIDUAL_RISK_REGISTER.md` | Accepted and outstanding risk |
| `specs/RELEASE_READINESS_VERDICT.md` | The verdict with supporting evidence |
| Test files only | If a verification gap requires a new test |

> If verification reveals a defect, **do not fix it in this wave**. Record it,
> assign it to the owning wave, and re-run that wave's gates.

---

## 5. Explicit exclusions

| Excluded | Reason |
|---|---|
| New feature work | Not verification |
| Refactoring | Changes the thing being verified |
| Fixing defects found here | Return them to the owning wave |
| Unverified findings | Cannot verify a fix that was never justified |
| Performance optimisation | Unless a security control caused the regression |

---

## 6. Prerequisites

| # | Prerequisite | Blocking |
|---|---|---|
| 1 | Waves 0–4 complete with evidence packs | **Yes** |
| 2 | Staging environment matching production configuration | **Yes** |
| 3 | Production-like data volume in staging | **Yes** — authorization defects hide at small scale |
| 4 | CI green and demonstrably executing | **Yes** |
| 5 | Verification lead who did **not** implement the fixes | **Yes** |
| 6 | All wave decisions (D-1, D-2, D-4, D-6, D-7) recorded | **Yes** |

---

## 7. Required implementation sequence

```
5.1  Evidence completeness review           ← cheapest failure to find first
5.2  Full regression across all workspaces
5.3  Independent authorization matrix verification
5.4  Dependency scanning review
5.5  Static analysis review
5.6  Migration and restore testing
5.7  Staging security testing
5.8  Residual-risk review
5.9  Readiness verdict
```

### Task 5.1 — Evidence completeness

Confirm every wave produced its evidence pack, every checklist item is genuinely
ticked, and every decision has a named owner and date. **A missing evidence pack
is itself a finding** — and it is far cheaper to find now than after staging tests.

### Task 5.2 — Full regression

Run every suite in every workspace. Compare against the Wave 0 baseline of 119
Node tests. Record counts, coverage, and duration.

### Task 5.3 — Independent authorization verification

Rebuild the denied-access matrix **from the requirements, not from the Wave 1
test code**. Reusing the implementation's tests verifies only self-consistency.

| Dimension | Values |
|---|---|
| Persona | worker, moderator, accountant, owner, admin, expert, unauthenticated |
| Relationship | owner, member, non-member, revoked, suspended |
| Operation | read, list, create, update, state change, delete |
| Resource | every resource type in the system |

Additionally verify: revoked membership takes effect immediately; a revoked
session is rejected immediately; IDOR attempts on sequential and guessable
identifiers fail.

### Task 5.4 — Dependency review

`npm audit` in all three Node workspaces, `cargo audit` if the Rust trail was
retained. Review SBOMs. **Zero High or Critical.** Every Moderate carries a
documented decision. Verify licence compliance.

### Task 5.5 — Static analysis

Full SAST across all languages. Triage every finding — fix, accept with
justification, or defer with an owner. **Confirm the planted-secret test still
detects a secret in a Rust file** — the scanner configuration may have drifted.

### Task 5.6 — Migration and restore

Forward and backward migration on a production-sized copy. Full restore rehearsal
with data verification and timing. Confirm measured RPO and RTO. **Verify audit
records survive restore intact with the hash chain unbroken.**

### Task 5.7 — Staging security testing

Authenticated and unauthenticated scanning; upload traversal and polyglot attempts;
rate limit and lockout verification; session lifecycle; security header capture;
mobile release build inspection; TLS configuration; and — if in scope and
authorised — external penetration testing.

### Task 5.8 — Residual-risk review

Produce a register covering: accepted risks with owner and rationale; deferred
findings with target dates; **unverified findings that were never implemented**;
unimplemented areas such as payments; and compensating controls.

### Task 5.9 — Readiness verdict

One of: **Ready**, **Ready with conditions**, or **Not ready**. State the criteria,
the evidence, the conditions, and the named approvers.

---

## 8. Security invariants

| # | Invariant |
|---|---|
| **I-1** | Every invariant from Waves 0–4 verified as still holding |
| **I-2** | No Wave 0 containment measure was removed without a permanent replacement |
| **I-3** | No previously fixed finding has regressed |
| **I-4** | No unverified finding is reported as remediated |
| **I-5** | Every residual risk has a named owner |
| **I-6** | The verdict is supported by reproducible evidence |
| **I-7** | Verification was independent of implementation |

---

## 9. Exact expected code changes by file and symbol

**None to production code.** New artefacts only:

| Artefact | Content |
|---|---|
| `specs/evidence/wave-5/` | All verification output |
| `specs/RESIDUAL_RISK_REGISTER.md` | Risk, severity, owner, decision, date |
| `specs/RELEASE_READINESS_VERDICT.md` | Verdict, criteria, evidence, conditions, approvers |
| Test files | Only where a verification gap requires one |

---

## 10. Secure structured logging

Verification **consumes** logs rather than adding them. Confirm:

| Check | Requirement |
|---|---|
| Denied access | Logged with sufficient context to investigate |
| Alert-level events | Actually reach an alerting destination |
| Audit trail | Complete, append-only, tamper-evident |
| Log content | **No secrets, tokens, passwords, message bodies, or amounts tied to identifiable tenants** |
| Retention | Matches the D-6 decision |
| Correlation | A single request is traceable end to end |

**Sample real logs and inspect them.** A logging policy is not evidence that the
policy is followed.

---

## 11. Tests to write before or with the changes

New tests only to close verification gaps:

- Independent authorization matrix, written from requirements
- Regression tests for every fixed finding, asserting the vulnerable behaviour is gone
- **Negative tests for the two false positives**, documenting why they are not vulnerabilities
- Restore verification including audit hash-chain continuity
- Alert-path test: does a Critical event actually page someone?
- Contract tests against the OpenAPI specification
- Rust/Node parity tests, if both trails were retained

---

## 12. Commands to run

```powershell
$ev = "specs/evidence/wave-5"

cd webapp/server-node
npm run check          | Out-File -Encoding utf8 "$ev/node-check.txt"
npm run test           | Out-File -Encoding utf8 "$ev/node-test.txt"
npm run test:coverage  | Out-File -Encoding utf8 "$ev/node-coverage.txt"
npm run test:integration | Out-File -Encoding utf8 "$ev/node-integration.txt"
npm audit --json       | Out-File -Encoding utf8 "$ev/node-audit.json"

cd ../client
npx tsc --noEmit       | Out-File -Encoding utf8 "$ev/client-tsc.txt"
npx vitest run         | Out-File -Encoding utf8 "$ev/client-test.txt"
npm run build          | Out-File -Encoding utf8 "$ev/client-build.txt"
npm audit --json       | Out-File -Encoding utf8 "$ev/client-audit.json"

cd ../server-rust      # only if D-1 retained the trail
cargo test             | Out-File -Encoding utf8 "$ev/rust-test.txt"
cargo audit            | Out-File -Encoding utf8 "$ev/rust-audit.txt"

cd ../../mobile-app
npx tsc --noEmit       | Out-File -Encoding utf8 "$ev/mobile-tsc.txt"
npx vitest run         | Out-File -Encoding utf8 "$ev/mobile-test.txt"
```

> **Always redirect to a file and search the whole file.** A truncated terminal
> tail can hide failures that occur earlier in the output — never conclude "zero
> errors" from a tail.

---

## 13. Expected output

| Command | Expected |
|---|---|
| All `check` / `tsc` | Exit 0, zero errors |
| All test suites | Exit 0, zero failures, **count ≥ the Wave 0 baseline of 119 for Node** |
| Coverage | Meets or exceeds the ratcheted thresholds |
| `npm audit` / `cargo audit` | Zero High or Critical |
| CI | Green on the release commit |
| Authorization matrix | 100% pass; **every non-member case returns 403 or 404** |
| Restore rehearsal | Within documented RTO; audit chain intact |

---

## 14. Verification checklist

- [ ] Every wave's evidence pack complete
- [ ] Every decision recorded with owner and date
- [ ] Full regression green across all four workspaces
- [ ] Independent authorization matrix at 100%
- [ ] Zero High or Critical dependencies
- [ ] SAST findings triaged
- [ ] Planted Rust secret still detected
- [ ] Migration forward and backward verified
- [ ] Restore rehearsed; audit chain intact
- [ ] Staging security testing complete
- [ ] Security headers verified on live responses
- [ ] Mobile release build verified — no cleartext, no stored password
- [ ] Logs sampled and confirmed free of sensitive data
- [ ] Alert paths confirmed to reach a human
- [ ] Residual-risk register complete with owners
- [ ] Verdict issued and approved

---

## 15. Regression checklist

- [ ] No Wave 0 containment removed without a permanent replacement
- [ ] No previously fixed finding regressed
- [ ] Both false positives still correctly classified
- [ ] Both withdrawn claims still withdrawn
- [ ] Core user journeys work end to end on web and mobile
- [ ] Performance acceptable under production-like load
- [ ] No unverified finding reported as remediated

---

## 16. Rollback plan

Verification does not change production code, so there is nothing to roll back.

**If verification fails:**

| Severity | Action |
|---|---|
| Critical or High | **Verdict: Not ready.** Return to the owning wave; re-verify from task 5.1 |
| Medium | Verdict: *Ready with conditions*, if a compensating control exists and an owner accepts the risk |
| Low | Record in the register; proceed |

**Never soften a verdict to meet a date.** The verdict's only value is its
accuracy.

---

## 17. Evidence to capture

Under `specs/evidence/wave-5/`:

1. All command output files listed in §12
2. Independent authorization matrix results, full grid
3. Dependency scan output and SBOMs for all workspaces
4. SAST reports with triage decisions
5. Migration round-trip and restore rehearsal records with timings
6. Staging security test reports
7. Security header captures
8. Mobile release build inspection
9. Sampled log excerpts, redacted
10. Alert-path test results
11. Signed residual-risk register
12. Signed readiness verdict

**Retain all evidence for the full audit retention period.** Store it immutably —
this is the record that the programme was actually executed.

---

## 18. Acceptance criteria

1. All invariants in §8 verified.
2. Full regression green.
3. Independent authorization matrix at 100%.
4. Zero High or Critical dependency findings.
5. Restore rehearsed successfully with the audit chain intact.
6. Staging security testing complete with findings triaged.
7. Residual-risk register signed by an accountable owner.
8. Readiness verdict issued with named approvers.
9. **No finding reported as remediated without evidence.**

---

## 19. Stop conditions

| Condition | Action |
|---|---|
| Any Critical or High finding unresolved | **Stop. Verdict: Not ready** |
| Authorization matrix shows any cross-tenant access | **Stop.** Return to Wave 1 |
| Restore fails or the audit chain is broken | **Stop.** Return to Wave 2 |
| A previously fixed finding regressed | **Stop.** Determine why the gate missed it |
| Evidence missing for a claimed fix | **Stop.** The fix is unproven |
| Logs contain secrets or personal data | **Stop.** Return to the owning wave |
| Alerts do not reach a human | **Stop.** Detection is non-functional |
| Pressure to issue a favourable verdict without evidence | **Stop and escalate** |

---

## 20. Handover to operations

This is the final wave. Handover is to ongoing operations, not to another wave.

| Deliverable | Owner |
|---|---|
| Readiness verdict and conditions | Release management |
| Residual-risk register | Security, with periodic review |
| Evidence archive | Compliance |
| CI gates and thresholds | Engineering — **treat any lowering as a security change** |
| Restore runbook and rehearsal schedule | Operations |
| Alerting configuration | On-call |
| **Unimplemented areas** — payments, unverified SEC-H05/07/08/10 | Product backlog, explicitly flagged |

**Recurring obligations:**

| Activity | Cadence |
|---|---|
| Dependency review | Weekly automated, monthly triage |
| Restore rehearsal | Quarterly |
| Authorization matrix re-run | Every release |
| Access review | Quarterly |
| Residual-risk review | Quarterly |
| Full security audit | Annually |

> A security programme is not finished when the last wave ships. **The waves
> established controls; operations keeps them true.**
