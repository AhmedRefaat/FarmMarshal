# Management Security Summary — AgriTasks

**Audience:** Executive leadership, board, and non-technical stakeholders
**Date:** 27 August 2026
**Sources:** Cybersecurity audit, database architecture audit, normalised findings, evidence matrix, audit validation report, and remediation plan. Where the validation report corrected the original audit, the validation report is used.

---

## 1. Overall verdict

The platform is **suitable for internal testing with synthetic data only**. It is **not ready for a customer pilot, staging with real users, or production**.

The most severe security defects have now been fixed and independently tested. The blocking issue is no longer security — it is that **the product has no database**. Every account, task, message, and financial record is held in memory and destroyed when the service restarts. That alone disqualifies the platform from holding real customer data, irrespective of security posture.

## 2. What was reviewed

Two backend services (one Node.js, one Rust), a web application, a mobile application, and the proposed database design. Reviews covered authentication, access control, data protection, dependencies, and operational readiness. Findings were then re-checked in a separate validation pass, which corrected four items and rejected two as inaccurate. Only re-verified findings are reported here.

## 3. What the audit found

The original audit raised 41 issues: 6 critical, 11 high, 14 medium, 6 low, plus 4 advisory. Validation confirmed 12 as stated, revised 4, rejected 2 sub-claims as incorrect, and identified 3 new issues. Six findings were carried forward on earlier evidence and have **not** been re-verified.

The critical findings shared one theme: **the system checked who you were, but frequently not what you were entitled to see.**

Since the audit, an emergency remediation wave has been completed and verified. Five of the six critical findings are now closed with automated tests. The sixth — absence of a database — remains open and requires investment, not a code fix.

## 4. Immediate business risks

- **Administrator impersonation — confirmed as a defect, now fixed in code.** The Rust service contained a fallback password-equivalent value published in our own source code. Anyone with access to the code could have created a valid administrator session against an affected deployment. We have **no evidence of misuse**, and exploitation required a specific deployment condition we have not confirmed exists. The code is fixed; **the value must still be replaced operationally**, because a code change cannot retire credentials already issued.
- **Cross-customer data exposure — confirmed, now fixed.** Any signed-in user could read other customers' private conversations and financial records, and could write financial entries against farms they had no relationship with. This is the finding with the clearest commercial and contractual consequence.
- **Third-party billing exposure — confirmed, now fixed.** An unauthorised request could trigger a paid translation service, creating avoidable cost.
- **Total data loss on restart — confirmed, open.** Unchanged.

## 5. Database and operational status

**No database is connected.** Neither service contains database software of any kind. The single design file in the repository has never been run and cannot currently run, because it depends on an optional component nobody has provisioned. There is no migration tooling, no backup, and no tested restore.

Consequently: data does not survive restart; the service cannot run on more than one machine; personal-data deletion and export requests cannot be satisfied; and there is no reliable financial or audit record.

The two backends are **divergent, not aligned**. They implement the same product twice with no shared contract, and that divergence directly caused our single most severe finding — a fix applied to one service was never applied to the other.

## 6. Next 24 to 72 hours

1. Replace and redistribute the affected signing value across every environment, and require all users to sign in again.
2. Confirm where — if anywhere — the Rust service is deployed and reachable.
3. Answer one outstanding technical question that could materially raise the severity of a file-handling issue.

## 7. Next 30 days

Decide the backend strategy, provision a managed database, migrate the application onto it, prove a restore, and make audit records tamper-evident. Bring the automated build and security checks into routine use; they exist but have never run.

## 8. Recommended target architecture

Consolidate to **a single backend** — maintaining two hand-written implementations has already produced repeat divergences and doubles every future fix. Adopt **managed PostgreSQL** as the system of record with tenant isolation enforced at the data layer as well as in code, formal migrations, and rehearsed backups. Move uploaded files to managed object storage with authorised access. Defer geospatial and time-series extensions until a genuine requirement exists.

## 9. Decisions required from management

| # | Decision | Consequence of delay |
|---|---|---|
| D-1 | One backend or two | Blocks all persistence and security work; delay doubles downstream cost |
| D-2 | Tenancy model: organisation above farm, or farm alone | Shapes every access-control rule |
| D-3 | Retain or remove the mobile app's separate cloud data path | Leaves an ungoverned second data store |
| D-4 | Accept a maintenance window that discards current in-memory data | Blocks the database migration entirely |
| D-5 | Confirm applicable jurisdictions and data-retention periods | Determines whether missing deletion is a gap or a violation |

## 10. Investment and staffing implications

The remediation plan is roughly **17 weeks of engineering across four waves**, assuming decisions are made promptly and the team is not split across both backends. Consolidating to one backend is the single largest cost saving available. New recurring costs: managed database, object storage, and backup retention. Legal or compliance input is required for data-retention decisions. One-off cost: an independent penetration test before production.

## 11. Conditions for external testing

External penetration testing is **premature today** and would largely re-report known issues. Commission it only once the database migration is complete, a single backend is canonical, and the automated security checks run green — otherwise the findings will be obsolete before the report is delivered.

## 12. Conditions for production readiness

Production requires, at minimum: durable storage with a rehearsed restore; one backend; a published and tested interface contract; access-controlled file storage; encrypted transport end to end, including mobile; secure credential storage on devices; and a passed independent penetration test. Field control of physical irrigation equipment requires a separate safety review.

## 13. Residual uncertainty

We are **not claiming full assurance**. Specifically:

- Four Rust-specific findings were carried on earlier evidence and not re-verified.
- One file-handling question remains open; the answer could raise or lower that item's severity significantly.
- We do not have a confirmed deployment inventory, so statements about what is reachable from the internet are inference, not fact.
- The sensitivity of uploaded professional credentials is unconfirmed.
- No dynamic, load, end-to-end, or mobile-device testing has been performed.
- Absence of evidence of misuse is not evidence of absence: with no durable audit trail, we could not fully reconstruct past activity even if we tried.

---

## Management action table

| Action | Owner role | Deadline | Business reason | Completion evidence |
|---|---|---|---|---|
| Replace and redistribute the affected signing value; force re-authentication | Head of Infrastructure / DevOps | Immediate | A code fix cannot retire credentials already issued | Startup record shows a supplied value; a previously issued session is refused |
| Confirm deployment inventory and internet reachability of both backends | Head of Infrastructure | Immediate | Severity of the most serious finding depends on it | Signed inventory of environments and endpoints |
| Resolve the outstanding file-handling question | Engineering Lead | 72 hours | May reorder remediation priority | Written finding with reproduction result |
| Decide single backend versus two | CTO | 72 hours | Blocks every subsequent work package | Recorded architecture decision |
| Provision managed database and migrate the application | Engineering Lead | 30 days | Data currently does not survive restart | Data present after a deliberate restart |
| Prove backup and restore | Head of Infrastructure | 30 days | No recovery capability exists today | Documented restore rehearsal with recovery time |
| Confirm jurisdictions and retention periods | Legal / Compliance | 30 days | Determines regulatory exposure of missing deletion paths | Written retention policy |
| Enforce encrypted transport for the mobile application | Engineering Lead | Before staging | Current build would transmit credentials unprotected | Release build verified against a secure endpoint |
| Bring automated security and build checks into routine use | Engineering Lead | Before staging | The checks exist but have never run | First successful automated run recorded |
| Commission independent penetration test | CISO | Before production | Required assurance gate | Test report with findings closed |

---

## Appendix — status of the six critical findings

| Finding | Status |
|---|---|
| Published signing value enabling administrator impersonation (Rust) | Code fixed and tested; **operational replacement still required** |
| Private conversations readable by any signed-in user | Closed, tested |
| Alternative message path bypassing the same check | Closed, tested |
| Financial records readable across customers | Closed, tested |
| Financial records writable against other customers' farms | Closed, tested |
| No persistence — total data loss on restart | **Open** — requires investment decision |

**Verification performed:** 175 automated tests pass across the two backends and the web client, up from 135 for the same three suites before this wave. Type checks are clean, the production build succeeds, and the production dependency set reports no known vulnerabilities. The mobile application was unchanged in this wave and was not re-tested.
