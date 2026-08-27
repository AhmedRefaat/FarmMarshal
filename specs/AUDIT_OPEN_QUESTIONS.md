# Audit Open Questions

**Date:** 2026-08-27
**Purpose:** Questions that could not be answered from the repository and that
block severity classification, remediation, or both.

Each question states **why it matters** and **what specific artefact would
resolve it**. Questions are not rhetorical — they are blocking inputs.

---

## 1. Missing architecture information

| # | Question | Why it blocks | Resolving artefact |
|---|---|---|---|
| A-1 | Is the Rust backend intended to be deployed at all, or is it an experiment? | Determines whether SEC-C01 is a live Critical or a latent one. It is the highest-severity finding in the audit and its severity is entirely reachability-dependent | A deployment decision record, or decision D-1 |
| A-2 | Which backend is authoritative when both run? | They share a token format and seeded user IDs but hold separate state. A client authenticated against one and reading from the other sees a different universe | An architecture decision record |
| A-3 | Is `organizations` above `farms` in the tenancy hierarchy? | The entire RLS policy design and every tenant-scoping fix depends on the answer. Fixing SEC-C04 at the farm level is wasted work if the boundary is really the organisation | Product requirement confirmation (decision D-2) |
| A-4 | Are `user_personas` global or per-farm? | `buildActorContext()` treats them as global; `farm_members.role_in_farm` is per-farm. The two overlap and can conflict. An authorization fix cannot be written against an ambiguous model | Requirement clarification |
| A-5 | Are conversations always farm-scoped? | Determines whether the SEC-C02 fix should assert farm membership, conversation membership, or both. Expert consultations may legitimately cross farms | Product requirement |

---

## 2. Missing deployment information

| # | Question | Why it blocks | Resolving artefact |
|---|---|---|---|
| D-1 | Is anything deployed today, and where? | Every "externally reachable" assessment in this review is an inference. If nothing is deployed, all severities are latent; if a staging host is internet-facing with the default Rust secret, SEC-C01 is live | Environment inventory |
| D-2 | Is there a reverse proxy, gateway, or WAF in front of either backend? | Would materially change SEC-H03 (media access), WEB-03 (HSTS), and the rate-limiting findings. Controls at the edge are invisible in this repository | Infrastructure configuration |
| D-3 | Is TLS terminated anywhere? | SEC-H06 assumes cleartext end to end. A TLS-terminating proxy would reduce it, though the mobile client's hardcoded `http://` origin would still not reach it | Deployment topology |
| D-4 | How are environment variables supplied, and is `AUTH_SECRET` set in any existing environment? | Directly determines whether SEC-C01 is currently exploitable. **Do not send the value** — a yes/no per environment is sufficient | Secret-management inventory (redacted) |
| D-5 | Is `/uploads/` served by the application or by a CDN/bucket in any environment? | Changes both the SEC-H03 fix and the DEP-01 exposure | Deployment topology |

---

## 3. Missing database information

| # | Question | Why it blocks | Resolving artefact |
|---|---|---|---|
| DB-1 | Has `db/schema.sql` ever been executed against any instance? | The audit asserts it never has. If a stale instance exists somewhere, it is unmanaged, unpatched, and potentially holds real data | Database inventory |
| DB-2 | Does any Firestore project hold production data today? | The mobile app still opens live listeners. If the project is live, its security rules are an unaudited control surface **outside this repository** | Firebase console inventory + exported rules |
| DB-3 | What are the retention requirements for telemetry, media, audit records, and personal data? | Blocks the retention and erasure design, and therefore any GDPR-style erasure capability | Legal/compliance input |
| DB-4 | Which jurisdictions' data-protection regimes apply? | Determines whether the absence of erasure and export paths is a compliance violation or merely a design gap | Legal input |
| DB-5 | Is there any existing backup of anything? | The audit reports none. Confirmation is needed before assuming a restart is recoverable | Operations confirmation |

---

## 4. Missing security configuration

| # | Question | Why it blocks | Resolving artefact |
|---|---|---|---|
| S-1 | What is `MAX_UPLOAD_BYTES` set to in each environment? | It defaults to 10 MB but is environment-overridable at `security/uploads.ts:13`. A large override would partially reinstate the DoS concern this review downgraded | Environment configuration |
| S-2 | What is `CORS_ORIGINS` set to in each environment? | `resolveCorsOrigins()` is only as strong as its input. A wildcard would negate the control credited in this review | Environment configuration |
| S-3 | Is `LOG_LEVEL=debug` enabled anywhere? | `authz.ts` logs granted permission decisions with user IDs and resources at debug level. In production this is a privacy and volume concern | Environment configuration |
| S-4 | Which translation provider does `activeTranslator()` reach, and is it metered or billed? | Determines the financial blast radius of SEC-C03. An unmetered paid API turns a data-leak finding into a cost-attack finding | Provider contract |
| S-5 | Are there any WAF, IDS, or alerting rules today? | Detectability is a severity input throughout this review, and it was assessed as effectively zero. Confirmation is needed | Security operations inventory |

---

## 5. Questions that block severity classification

These specifically prevent a defensible severity from being assigned.

| # | Question | Finding affected | Effect on severity |
|---|---|---|---|
| SEV-1 | **Does busboy permit backslashes in a multipart part's `Content-Type` header?** | NEW-01 / VAL-008 | If yes, this is an authenticated arbitrary-file-write on Windows hosts and likely the highest-severity finding in the codebase. If no, it is a low-severity input-hygiene issue. **This is the single most important open question in this review** |
| SEV-2 | Is the Rust backend internet-reachable in any environment? | SEC-C01 | Critical-and-live versus Critical-and-latent |
| SEV-3 | Do the `/uploads/` URLs appear in any client-side cache, log, or third-party analytics? | SEC-H03 | Determines whether URL obscurity offers any practical protection |
| SEV-4 | Is the `owner` role widely assigned, or held by a small trusted set? | SEC-C04, SEC-C05 | Determines the realistic attacker population for the finance findings |
| SEV-5 | What is the actual sensitivity of expert qualification documents uploaded via `/v2/experts/me/documents`? | SEC-H02, SEC-H03 | If they are government identity documents, the confidentiality impact rises sharply |
| SEV-6 | Are the four unverified Rust findings (SEC-H05, H07, H08, H10) accurate? | Those four | They are currently carried on prior evidence alone |

---

## 6. Questions that block remediation

| # | Question | Work package blocked | Why |
|---|---|---|---|
| R-1 | One backend trail or two? (decision D-1) | Every persistence and authorization work package | Determines whether each fix is written once or twice. Deferring this does not save effort — it doubles it |
| R-2 | What is the target media storage platform? (decision D-4) | VAL-009 / WP-2.3 | The fix differs substantially between S3-compatible storage, GCS, and an authenticated pass-through endpoint |
| R-3 | Which payment provider? | All payment schema and idempotency work | Webhook shape, refund model, and idempotency anchor all follow from the provider |
| R-4 | Should Firestore be removed or retained and governed? (decision D-3) | VAL-012 and the mobile refactor | Removal is a deletion; retention requires committing and auditing rules that are currently outside version control |
| R-5 | Is there a maintenance window in which the in-memory store may be dropped? | WP-1.1 through WP-1.4 | Migrating to PostgreSQL discards all current state by definition. If any of it matters, an export is needed first |
| R-6 | Who owns the root repository initialisation, and does a remote exist? | VAL-018 / E-11 | Blocks every CI, scanning, and review gate. It is the cheapest item in the plan and gates the most |
| R-7 | Is a major-version bump of `@fastify/static` acceptable this cycle? | VAL-019 / E-6 | The fix crosses two major versions; the `setHeaders` contract must be re-validated afterwards |

---

## 7. Summary

**14 questions materially block progress**, of which **SEV-1** should be answered
first because it is cheap to resolve — a single non-destructive unit test — and
because it may reorder the entire remediation plan.

**R-1** is the second priority: it is a decision, not an investigation, and every
engineering work package is downstream of it.

Everything else can proceed in parallel once Wave 0 items E-1 through E-5 are
underway, since those rest on confirmed evidence and do not depend on any open
question.
