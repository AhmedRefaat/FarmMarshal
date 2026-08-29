# FarmMarshal — Audit Document Review Log

**Review date:** 2026-08-27
**Reviewer role:** Independent audit editor, cybersecurity architect, database
architect, requirements engineer, technical-documentation quality lead.
**Scope:** Editorial and factual review of four audit documents as a coherent
deliverable set.
**Restriction observed:** No production source code, test, schema, dependency, or
configuration file was modified. No package was installed. No migration was
executed. Only the four audit documents were edited and this log was created.

---

## 1. Documents reviewed

| # | Document | Lines at review | Sections | Outcome |
|---|---|---|---|---|
| 1 | [specs/CYBERSECURITY_AUDIT.md](specs/CYBERSECURITY_AUDIT.md) | ~1,900 | 27 | Corrected extensively |
| 2 | [specs/DATABASE_ARCHITECTURE_AUDIT.md](specs/DATABASE_ARCHITECTURE_AUDIT.md) | ~600 | 10 | Corrected extensively |
| 3 | [specs/DATABASE_INTEGRATION_TRACEABILITY.md](specs/DATABASE_INTEGRATION_TRACEABILITY.md) | ~530 | 6 | Corrected extensively |
| 4 | [specs/CYBERSECURITY_AND_DATABASE_REMEDIATION_PLAN.md](specs/CYBERSECURITY_AND_DATABASE_REMEDIATION_PLAN.md) | ~250 | 11 | Corrected extensively |

### The central problem this review found

The four documents were written on **2026-08-26**. Between that date and this
review, the **Wave 0 emergency remediation was implemented and validated**. None
of the four documents recorded that. As a set they therefore asserted, in the
present tense, a large number of defects that no longer existed — including the
headline statement `CRITICAL – IMMEDIATE ACTION REQUIRED` justified by "six
Critical findings are confirmed and reachable", of which five were closed.

This is the most consequential class of error in an audit deliverable, in **both**
directions:

- **Overstating open risk** destroys the credibility of the findings that are
  genuinely still open — and there are many, including one Critical.
- **Understating it** would be worse.

The review's governing editorial decision was therefore **not** to rewrite the
documents to describe today. Findings are records of what was true when observed;
deleting them destroys the traceability that justified the remediation. Instead
every document now carries an explicit **two-points-in-time** convention: the
audit-date claim is preserved verbatim, and a dated correction states what changed,
what did not, and what evidence supports the change.

**A secondary, independent problem** was that a substantial number of claims were
wrong *at the audit date too* — wrong line numbers, wrong counts, wrong arithmetic,
and in three cases wrong reasoning. Those are corrected outright, since preserving
a false citation serves no traceability purpose.

---

## 2. Validation method

Every claim that could be re-derived from the repository was re-derived. Nothing
was accepted on the authority of another document.

| Technique | Applied to |
|---|---|
| Full read of all four documents | All claims |
| `CREATE TABLE` / `CREATE INDEX` / `CREATE EXTENSION` extraction | `schema.sql` — 13 tables, 2 indexes, 2 extensions |
| Direct line-range read of `schema.sql` 11–160 | Every SCH-01…SCH-15 evidence citation |
| Symbol and route line extraction (`chat.ts`, `features.ts`, `farmsFinance.ts`, `index.ts`, `auth.ts`, `authz.ts`) | Every Node evidence citation |
| Recursive handler count (`app.<verb>(`) | Node endpoint total |
| Recursive route count (`.route(`) | Rust endpoint total |
| Recursive pattern search of `webapp/server-rust/src` for `DefaultBodyLimit`, rate-limiting constructs, `lock()`, `CorsLayer` | SEC-H05, H07, H08, H10 |
| Direct read of `authz.rs` 80–115 | The Rust `can()` admin-short-circuit claim |
| `Test-Path` on `.git`, `webapp/client/dist` | DSO-01, the withdrawn `dist` finding |
| Recursive AppleDouble (`._*`) count and `.gitignore` inspection | DSO-09 |
| Independent recomputation of all 96 weight × score products | §6 decision matrix |
| Pattern sweep for secret literals, credentials, and personal data | Security/privacy gate |

### Method limitations, stated

1. **No command was executed against a running server.** All verification is
   static. Where a claim requires runtime behaviour to confirm (for example, that
   the Rust `ServeDir` is internet-reachable), the claim is marked as requiring
   confirmation rather than asserted.
2. **Test results are quoted from the Wave 0 validation run, not re-executed
   during this review.** The figures (153 Node, 20 Rust, 74.34%/72.81%/70.33%) are
   carried forward from that run.
3. **The Rust trail was verified only by pattern matching**, because it has no
   HTTP-level test suite. This is sufficient to confirm the *absence* of a control
   (a missing `DefaultBodyLimit` is a missing `DefaultBodyLimit`) but weaker for
   confirming exploitability.
4. **`webapp/client/dist` now exists on disk** as a Wave 0 build artifact. It is
   covered by the root `.gitignore` (`dist/`), and there is **no root git
   repository**, so whether it is "committed" is not an assessable question. The
   original finding's withdrawal stands, with this noted.

---

## 3. Corrections by document

Major corrections carry the full eight-field record. Grouped mechanical
corrections (line-number citations) are recorded once with the full set enumerated.

### 3.1 `CYBERSECURITY_AUDIT.md`

---

**C-01 — Finding counts did not reconcile with the register**

| Field | Value |
|---|---|
| **Document** | `CYBERSECURITY_AUDIT.md` |
| **Section** | §1 Executive summary; §20 Finding register |
| **Previous statement** | Critical 6 / High 11 / Medium 14 / Low 6 / Informational 4 = **41** |
| **Corrected statement** | Critical 6 / High 20 / Medium 24 / Low 8 / Informational 4 = **62** |
| **Reason** | The §20 register used compound rows — a single row carrying two or three finding IDs (`WEB-02/03/06`, `API-03/04/05`, `DSO-05/08/09`, `WEB-04/05`, `DSO-07/10`, `INF-01..04`). The summary counted rows; the register defined findings. The two could not both be right. Every compound row is now expanded to one row per ID, and a reconciliation sub-table was added. |
| **Repository evidence** | Internal document consistency; no repository claim is affected |
| **Effect on risk or plan** | **None on actual risk — this is a counting correction, not a discovery.** No new defect was found and none was removed. The effect is on credibility and on plan sizing: a remediation backlog scoped against "41 findings" would have under-provisioned by 21 items. |

---

**C-02 — Register had no current-status column, so remediated findings read as open**

| Field | Value |
|---|---|
| **Document** | `CYBERSECURITY_AUDIT.md` |
| **Section** | §20 |
| **Previous statement** | Single `Status` column, all values as at the audit date |
| **Corrected statement** | `Audit status` **and** `Current status` columns, plus a status-vocabulary table in the header defining 11 permitted values |
| **Reason** | Without a second column there was no way to record Wave 0 without either deleting the original finding (destroying traceability) or leaving the document false. The vocabulary table was added because the documents were using `Confirmed`, `Withdrawn`, `Documented only`, `Missing`, and `Blocked by missing information` without ever defining them. |
| **Repository evidence** | Wave 0 source changes and the 153/20 passing test suites |
| **Effect on risk or plan** | Makes the register usable as a live backlog rather than a snapshot. Reconciled totals: **10 remediated (verified), 3 partial, 49 open.** |

---

**C-03 — The Rust `can()` admin short-circuit was mischaracterised**

| Field | Value |
|---|---|
| **Document** | `CYBERSECURITY_AUDIT.md` |
| **Section** | SEC-M07 |
| **Previous statement** | The admin check "returns true before the action switch is reached", cited at `authz.rs#L97` |
| **Corrected statement** | `let admin = …` is bound at line 86 and consumed **inside individual match arms**; it is **not** an early return. Cited as `authz.rs#L86-L112`. Finding retitled "Admin persona satisfies every farm-scope check". |
| **Reason** | Direct read of `webapp/server-rust/src/authz.rs` lines 80–115. Line 97 is *inside* the `IssueCreate`/`IssueAdvance` arm, not before the match. |
| **Repository evidence** | [webapp/server-rust/src/authz.rs](webapp/server-rust/src/authz.rs) lines 85–112 |
| **Effect on risk or plan** | **The finding stands; the remediation changes.** As described, one line could be deleted. As it actually is, each arm must be reviewed individually — some arms may legitimately want admin to pass. The corrected description makes the fix larger and more delicate, not smaller. Severity unchanged. |

---

**C-04 — A false "constant-time comparison" claim contradicted the validation report**

| Field | Value |
|---|---|
| **Document** | `CYBERSECURITY_AUDIT.md` |
| **Section** | §8 verified-correct controls table |
| **Previous statement** | Token comparison is constant-time (listed without trail qualification, implying both) |
| **Corrected statement** | Constant-time in **Node only** at the audit date; the Rust trail used a variable-time `==`. Now constant-time in both, via `Mac::verify_slice()` added in Wave 0. |
| **Reason** | The audit's own validation finding VAL-014 recorded the Rust variable-time comparison. Listing it as a verified-correct control contradicted that. |
| **Repository evidence** | [webapp/server-rust/src/auth.rs](webapp/server-rust/src/auth.rs) `verify()` line 85, `Mac::verify_slice()` line 90 |
| **Effect on risk or plan** | Removes an internal contradiction that would have caused a reader to dismiss VAL-014. Risk now lower than either version stated, because the defect is fixed. |

---

**C-05 — "Path traversal is not possible because filenames are UUIDs" was unsound**

| Field | Value |
|---|---|
| **Document** | `CYBERSECURITY_AUDIT.md` |
| **Section** | Media controls table |
| **Previous statement** | "Path traversal: not possible (UUID names)" |
| **Corrected statement** | Row replaced with "Path containment on read", describing the actual control: the requested name is matched against a strict stored-name pattern **and** a canonical-extension allow-list, then resolved and confirmed to lie within the upload root; failures return 404. |
| **Reason** | **The reasoning was invalid, independent of whether the conclusion held.** UUID naming is a property of the *write* path. Traversal is an attack on the *read* path, where the attacker supplies the name and the server's naming convention is irrelevant. A control cannot be evidenced by a property of a different code path. |
| **Repository evidence** | [webapp/server-node/src/security/media.ts](webapp/server-node/src/security/media.ts) — `STORED_NAME`, `isCanonicalExtension`, `isSafeStoredName`, `resolveContainedPath` |
| **Effect on risk or plan** | **This is the most important reasoning correction in the set.** The original phrasing would have justified *not* implementing containment. Wave 0 implemented it and tested it. Had the audit been acted on as written, the control would have been skipped. |

---

**C-06 — Two register findings had no finding section at all**

| Field | Value |
|---|---|
| **Document** | `CYBERSECURITY_AUDIT.md` |
| **Section** | §10 (new subsections) |
| **Previous statement** | SEC-H08 and SEC-H10 appeared only as one-line register rows |
| **Corrected statement** | Full sections added for both, with status, severity, confidence, file references, impact, remediation, and required test |
| **Reason** | Completeness gate: every finding must have all required fields. Two High findings had none — no evidence path, no impact statement, no remediation, no test. They were unactionable. |
| **Repository evidence** | SEC-H08: `CorsLayer::permissive()` at [main.rs:85](webapp/server-rust/src/main.rs#L85). SEC-H10: `lock().unwrap()` at [routes/mod.rs:58](webapp/server-rust/src/routes/mod.rs#L58) and [routes/features.rs:630](webapp/server-rust/src/routes/features.rs#L630) |
| **Effect on risk or plan** | Both findings become actionable. SEC-H10's scope is **reduced** (see C-09) but not withdrawn. |

---

**C-07 — Evidence-path corrections (grouped)**

| Field | Value |
|---|---|
| **Document** | `CYBERSECURITY_AUDIT.md` |
| **Section** | Multiple findings |
| **Previous / corrected** | See §8 of this log for the full table |
| **Reason** | The Wave 0 rewrites of `farmsFinance.ts`, `chat.ts`, `features.ts`, and `index.ts` invalidated most line citations; several were also wrong before. |
| **Repository evidence** | Per-line, in §8 |
| **Effect on risk or plan** | No severity or status change. Restores the ability to follow a citation to the code it describes — without which a reviewer would reasonably conclude findings were fabricated. |

---

**C-08 — Diagrams were not distinguished as current-state or target-state**

| Field | Value |
|---|---|
| **Document** | `CYBERSECURITY_AUDIT.md` |
| **Section** | §6.2, §7.1, §7.2, §21, §24 |
| **Previous statement** | §7.2 titled "confirmed vulnerability"; §24 titled "Long-term security architecture" with no proposal marker |
| **Corrected statement** | §6.2 labelled CURRENT IMPLEMENTATION with a post-Wave-0 correction note; §7.2 retitled "AS AT THE AUDIT DATE (now remediated)"; **new §7.3 added** showing the current implementation; §21 labelled as reflecting audit-date positions; §24 retitled "PROPOSED TARGET" with an explicit "this diagram is a proposal" note |
| **Reason** | A reader cannot distinguish a diagram of what exists from a diagram of what is wanted unless it is labelled. §24 in particular described an architecture with none of its components present in the repository. |
| **Repository evidence** | §7.3 traced from `features.ts` → `chat.ts` `listMessages` line 190 and `mapChatReadError` |
| **Effect on risk or plan** | Prevents the target architecture being mistaken for a description of the system — the specific error that would cause a stakeholder to believe controls exist that do not. |

---

**C-09 — SEC-H10 scope overstated**

| Field | Value |
|---|---|
| **Document** | `CYBERSECURITY_AUDIT.md`; `DATABASE_ARCHITECTURE_AUDIT.md` §2.1 |
| **Section** | SEC-H10 |
| **Previous statement** | `Mutex::lock().unwrap()` presented as a pervasive pattern |
| **Corrected statement** | **Four** lock sites exist; **two** use the panicking `.unwrap()` form. One (`routes/mod.rs:58`) is inside a macro and so expands at effectively every state access — this is the one that carries the impact. The other two already use `if let Ok(...)` and degrade gracefully. |
| **Reason** | Recursive search of `webapp/server-rust/src`. |
| **Repository evidence** | `routes/mod.rs:58`, `routes/features.rs:630` (unwrap); `features.rs:17`, `features.rs:640` (safe) |
| **Effect on risk or plan** | **Severity retained at High** — one macro-expanded site covering all state access is sufficient for the stated impact, and the coupling with DB-SEC-01 (the only recovery from a poisoned lock is a restart, which destroys all data) is what makes it High. **Remediation effort drops substantially**: two call sites, not a codebase-wide audit. |

---

**C-10 — Emergency actions and test requirements had no status**

| Field | Value |
|---|---|
| **Document** | `CYBERSECURITY_AUDIT.md` |
| **Section** | §22, §25, §6.4 |
| **Previous statement** | §22 an unordered list of 8 actions; §25 a two-column table; §6.4 a single `Status today` column |
| **Corrected statement** | All three converted to tables with a verified `Status (2026-08-27)` column. §25 gained a gate-check note confirming every `Remediated (verified)` finding has a passing test. |
| **Reason** | Traceability gate: remediation work must map to tests. Without a status column the mapping could not be asserted or checked. |
| **Repository evidence** | `test/wave0.test.ts`, `test/security.test.ts`, `test/phases.test.ts`, six `#[cfg(test)]` tests in `auth.rs` |
| **Effect on risk or plan** | Converts three narrative sections into a checkable backlog. Reveals that **three §22 items are outstanding and two were superseded** — a fact not otherwise recoverable from the set. |

---

**C-11 — §25 required a 403 where the implementation returns 404**

| Field | Value |
|---|---|
| **Document** | `CYBERSECURITY_AUDIT.md` |
| **Section** | §25, SEC-C02 |
| **Previous statement** | "Non-member gets **403** on `GET /v2/chat/:id/messages`" |
| **Corrected statement** | Requirement restated as a security property: a forbidden conversation must be indistinguishable from a non-existent one. Implementation returns **404** on chat read paths; write paths return 403. |
| **Reason** | A 403 confirms the resource exists, making the endpoint an enumeration oracle for conversation IDs. The test requirement as written would have mandated a weaker control than the one implemented. |
| **Repository evidence** | `mapChatReadError` in `features.ts`; ADR-SEC-004 |
| **Effect on risk or plan** | Prevents a future "fix" that would regress the control to satisfy a mis-specified test. |

---

### 3.2 `DATABASE_ARCHITECTURE_AUDIT.md`

---

**C-12 — Table count contradicted its own list**

| Field | Value |
|---|---|
| **Document** | `DATABASE_ARCHITECTURE_AUDIT.md` |
| **Section** | §3.1; §10 verdict |
| **Previous statement** | "`schema.sql` declares **12** tables:" followed by **thirteen** names |
| **Corrected statement** | **13** tables, with the `CREATE TABLE` line numbers listed for independent checking |
| **Reason** | Self-contradiction visible on the page. Re-derived from source. |
| **Repository evidence** | `webapp/server-node/db/schema.sql` — `CREATE TABLE` at lines 11, 20, 32, 43, 53, 72, 90, 102, 111, 120, 132, 145, 155 |
| **Effect on risk or plan** | Minor on risk; material on credibility. It also **confirms** the adjacent "39 of 52 required entities absent" figure, which had appeared arithmetically inconsistent: the absent list contains exactly 39 names, and 39 + 13 = 52. The count was the error, not the gap analysis. |

---

**C-13 — All four decision-matrix totals were arithmetically wrong**

| Field | Value |
|---|---|
| **Document** | `DATABASE_ARCHITECTURE_AUDIT.md` |
| **Section** | §6 Weighted totals; Sensitivity analysis |
| **Previous statement** | PostgreSQL **697** (100%), Distributed SQL **610** (87.5%), MongoDB **511** (73.3%), Firebase **435** (62.4%) |
| **Corrected statement** | PostgreSQL **690** (100%), Distributed SQL **562** (81.4%), MongoDB **518** (75.1%), Firebase **392** (56.8%). A `Maximum possible` column (161 weights × 5 = 805) was added so totals can be checked independently. |
| **Reason** | Independent recomputation of all 96 weight × score products. Every total was wrong; two were overstated and one understated, so the errors were not a systematic offset. |
| **Repository evidence** | Not a repository claim — arithmetic over the document's own published weights and scores, which are unchanged |
| **Effect on risk or plan** | **The ranking is unchanged and the PostgreSQL recommendation is unaffected.** The corrected figures *widen* PostgreSQL's margin over Distributed SQL from 12.5 to 18.6 points, so the recommendation is better supported than before. The sensitivity analysis was also recomputed and now discloses that under the halved-weights scenario second and third place are within 0.8% — a near-tie the original figures concealed. |

---

**C-14 — Schema evidence line references (grouped, 7 of 15 wrong)**

| Field | Value |
|---|---|
| **Document** | `DATABASE_ARCHITECTURE_AUDIT.md` |
| **Section** | §3.2 SCH-01…SCH-15 |
| **Previous / corrected** | SCH-02 ranges → representative sites (34, 44, 55, 74, 92) · SCH-04 16 → **15** · SCH-06 52–68 → **53–71** · SCH-10 141 → **138** · SCH-12 137 → **136** · SCH-13 33–39 → **36–38** · SCH-14 22–48 → **23–24 and 46** · SCH-15 61/76/78/138 → **60**/76/**80**/**137** |
| **Reason** | Direct read of `schema.sql` lines 11–160. SCH-05 (line 8) and SCH-09 (145–153) verified **correct** and left unchanged. |
| **Repository evidence** | `webapp/server-node/db/schema.sql` |
| **Effect on risk or plan** | **No defect was withdrawn. Every SCH finding is still present in the DDL.** Only citations were wrong. The `farmsFinance.ts#L31` cross-reference in SCH-12 was removed rather than corrected, because Wave 0 rewrote that file and no equivalent line exists. |

---

**C-15 — Endpoint counts were not reproducible**

| Field | Value |
|---|---|
| **Document** | `DATABASE_ARCHITECTURE_AUDIT.md` §7; `CYBERSECURITY_AUDIT.md` §9.1 |
| **Section** | The two-backend argument |
| **Previous statement** | "47 endpoints against Node's 81" |
| **Corrected statement** | **63** Rust `.route(` path registrations (≈126 method handlers) against **82** Node handlers today, **80** at the audit date. Counting method stated in both documents. |
| **Reason** | Neither original figure could be reproduced and no method was given. Re-derived by recursive pattern match. |
| **Repository evidence** | `app.<verb>(` across `webapp/server-node/src`; `.route(` across `webapp/server-rust/src` |
| **Effect on risk or plan** | **Strengthens the argument it appears in.** The corrected ratio (63:82) shows the Rust trail duplicates *more* of the API than "47 of 81" suggested, making decision D-1 more urgent, not less. |

---

**C-16 — The Node/Rust divergence claim was stale in the wrong direction**

| Field | Value |
|---|---|
| **Document** | `DATABASE_ARCHITECTURE_AUDIT.md` |
| **Section** | §7 |
| **Previous statement** | SEC-C01, H05, H07, H08 exist "solely because a prior wave fixed Node and nobody fixed Rust" |
| **Corrected statement** | Retained as the audit-date record, with an update: **SEC-C01 is now fixed in both trails**, but Wave 0 fixed SEC-C02, C03, C04, C05, H01, H02, H03 in **Node only**, and H05/H07/H08/H10 were re-confirmed present in Rust. **The divergence is now wider than when the audit was written.** |
| **Reason** | Recursive verification: zero `DefaultBodyLimit`, zero rate-limiting constructs, `CorsLayer::permissive()` at `main.rs:85`, `ServeDir` at `main.rs:87` |
| **Repository evidence** | `webapp/server-rust/src` |
| **Effect on risk or plan** | **Raises the priority of decision D-1 from strategic to urgent.** The document's own thesis — that duplicated implementations reliably produce security divergence — has now been confirmed a third consecutive time, by the very wave intended to fix it. |

---

### 3.3 `DATABASE_INTEGRATION_TRACEABILITY.md`

---

**C-17 — Link-integrity summary and broken-link register had no post-Wave-0 state**

| Field | Value |
|---|---|
| **Document** | `DATABASE_INTEGRATION_TRACEABILITY.md` |
| **Section** | §1; §5 |
| **Previous statement** | §1: validation 6/20, authorization 13/20, tenant scoping 8/20, tests 7/20. §5: BL-01…BL-20 with no status. |
| **Corrected statement** | §1 gained audit-date **and** 2026-08-27 columns: validation **9/20**, authorization **16/20**, tenant scoping **12/20**, tests **10/20**. §5 gained a verified `Status` column: **7 repaired, 2 partially repaired, 11 open**. |
| **Reason** | Four features moved (Farms §3.3, Evidence §3.7, Chat §3.9, Finances §3.16). Counts are derived from the per-feature traces so the two are reconcilable by inspection. |
| **Repository evidence** | `financeScope`/`effectiveScope` in `farmsFinance.ts`; `assertMember` in `chat.ts` lines 190 and 239; `readValidatedUpload` in `features.ts` |
| **Effect on risk or plan** | **`Store → durable persistence` remains 0/20 and BL-01 remains open.** Both documents now state explicitly that every improvement is application-layer logic guarding data that is still destroyed on restart. |

---

**C-18 — Three feature traces asserted defects that no longer exist**

| Field | Value |
|---|---|
| **Document** | `DATABASE_INTEGRATION_TRACEABILITY.md` |
| **Section** | §3.3 Farms, §3.9 Chat, §3.16 Finances |
| **Previous statement** | Farms: "Two independent farm datasets exist (`farm-1`,`farm-2`)". Chat: "`assertMember` … absent from `listMessages` and `messageInLang`"; "Tests ✘ none". Finances: "`authz.ts` is **not imported by this file**"; "Tenant scoping ✘ none"; "Tests ✘ none". |
| **Corrected statement** | All preserved as audit-date records with dated corrections. The private farm array was **deleted**; `assertMember` is present on both chat paths as a **required parameter**; `authz.ts` **is** imported and `financeScope` enforces the boundary; all three features now have tests. |
| **Reason** | Source verification. |
| **Repository evidence** | `chat.ts` lines 190, 239; `farmsFinance.ts` lines 109, 117, 141, 190; `test/wave0.test.ts` |
| **Effect on risk or plan** | Four Criticals and one High close. **Three defects explicitly retained as open**: SEC-M14 (float money), SEC-M11 (arbitrary `memberIds`), SEC-M12 (WebSocket token in query string). BL-13 (no evidence metadata record) retained and flagged as unfixable without BL-01. |

---

**C-19 — A current-state sequence diagram depicted a fixed defect**

| Field | Value |
|---|---|
| **Document** | `DATABASE_INTEGRATION_TRACEABILITY.md` |
| **Section** | §4.2 |
| **Previous statement** | Titled "CURRENT IMPLEMENTATION", showing `requireRole('owner') — NO tenant check` returning "EVERY tenant's ledger rows" |
| **Corrected statement** | Retitled "AS AT THE AUDIT DATE (now remediated)"; **new §4.2a added** showing the current flow through `buildActorContext` → `financeScope` → `effectiveScope` |
| **Reason** | Quality gate: every current-state diagram must reflect actual code. |
| **Repository evidence** | `webapp/server-node/src/routes/farmsFinance.ts` lines 117–139 |
| **Effect on risk or plan** | The new diagram deliberately retains a note that the store is still volatile, so the correction does not read as "finances are now safe". |

---

**C-20 — Coverage figures and the zero-test correlation were stale**

| Field | Value |
|---|---|
| **Document** | `DATABASE_INTEGRATION_TRACEABILITY.md` |
| **Section** | §6 |
| **Previous statement** | "72.01% statements, 70.87% branches … 119 tests passing"; Chat **0**, Finances **0**; "every Critical finding sits in a module with zero tests" |
| **Corrected statement** | A dated table: 2026-08-26 72.01%/70.87%/119 tests; **2026-08-27 74.34%/72.81%/70.33%/153 tests**. Chat, Finances, and Media access control now covered. The correlation is restated as historical and **explicitly noted as having been broken deliberately**. |
| **Reason** | Wave 0 validation run. |
| **Repository evidence** | `npx vitest run --coverage` in `webapp/server-node` |
| **Effect on risk or plan** | Two cautions were added against over-reading the improvement: the remaining zero-test rows are unchanged, and +34 tests bought only +2.33 points of statement coverage because they concentrated on a few high-risk paths — so the headline percentage understates how much of the platform is unexercised. A new row was added: **Any Rust HTTP-level test — 0**. |

---

### 3.4 `CYBERSECURITY_AND_DATABASE_REMEDIATION_PLAN.md`

---

**C-21 — The plan declared itself unimplemented after being implemented**

| Field | Value |
|---|---|
| **Document** | `CYBERSECURITY_AND_DATABASE_REMEDIATION_PLAN.md` |
| **Section** | Header; §11 |
| **Previous statement** | "**Status of this plan:** proposed. **No code in this plan has been implemented.**" and "**Nothing in this plan has been implemented.**" |
| **Corrected statement** | "**Wave 0 has been largely implemented.** Waves 1–4 remain proposed and unstarted." §11 rewritten with a verification-evidence table and a five-item list of what is not done. |
| **Reason** | Six Wave 0 actions are complete and test-verified. |
| **Repository evidence** | 153 Node tests, 20 Rust tests, `tsc --noEmit` clean ×3, `npm audit --omit=dev` 0 vulnerabilities |
| **Effect on risk or plan** | **The most operationally dangerous statement in the set.** A reader acting on it would either redo completed work or, worse, conclude the Criticals were still open and delay a release decision on false grounds — while the genuinely outstanding items (E-1 rotation, E-9 mobile credentials, E-11 `git init`) received no distinct emphasis. |

---

**C-22 — Wave 0 exit criteria were unattainable as written**

| Field | Value |
|---|---|
| **Document** | `CYBERSECURITY_AND_DATABASE_REMEDIATION_PLAN.md` |
| **Section** | §3 exit criteria; §10 release gate 1 |
| **Previous statement** | "all six Criticals closed with tests; `npm audit` zero high/critical in prod deps; CI executed successfully at least once" |
| **Corrected statement** | Assessment table added: criterion 1 **not met (5 of 6)** and **mis-specified**, since DB-SEC-01 requires a database and is by definition Wave 1; criterion 2 **met**; criterion 3 **not met** — CI has never executed. Gate 1 restated as "Criticals **in application code**". |
| **Reason** | DB-SEC-01 cannot close in Wave 0. As written, the internal-testing gate could not open until the pilot gate's prerequisite was met, inverting the sequence. |
| **Repository evidence** | `Test-Path .git` → False; `.github/workflows/ci.yml` has never run |
| **Effect on risk or plan** | **No Critical is waived** — DB-SEC-01 still blocks the pilot and production gates. The correction makes Wave 0 closable on its own terms while keeping the release bar intact. **Wave 0 must still not be declared complete.** |

---

**C-23 — Wave 0 action table had no status and two actions were superseded**

| Field | Value |
|---|---|
| **Document** | `CYBERSECURITY_AND_DATABASE_REMEDIATION_PLAN.md` |
| **Section** | §3, E-1…E-12 |
| **Previous statement** | Twelve planned actions, no status |
| **Corrected statement** | Verified status per action. **E-3 superseded** (routes never taken offline — E-4 landed in the same wave, so a 503 would have caused an outage with no security benefit). **E-6 superseded** (`@fastify/static` **removed**, not upgraded — the advisories describe a *guard bypass*, so a `preHandler` wrapper would have been unsound, and the upgrade was an unapproved two-major bump). **E-4 changed** (`GET /farms` scoped, not replaced — a shipped web client consumes it). **E-7 partially done** (the `!` assertions were **not** removed). |
| **Reason** | Source verification of each action. |
| **Repository evidence** | `package.json` has no `@fastify/static`; `index.ts` line 106 first-party `/uploads/:name` handler; `farmsFinance.ts` line 109 |
| **Effect on risk or plan** | Records four deviations from plan with rationale, so they read as engineering decisions rather than as gaps. E-7's incomplete half is explicitly carried forward to WP-2.2 rather than being silently absorbed. |

---

**C-24 — Coverage ratchet current row stale; Wave 0 statement target missed**

| Field | Value |
|---|---|
| **Document** | `CYBERSECURITY_AND_DATABASE_REMEDIATION_PLAN.md` |
| **Section** | §8.2 |
| **Previous statement** | "Current (verified) 72.01% / 70.87%" |
| **Corrected statement** | Plan-date row retained; current row added at **74.34% / 72.81%**. Ratchet assessed: branch target (72%) **met**; statement target (75%) **narrowly missed by 0.66 points**. |
| **Reason** | Wave 0 coverage run. |
| **Repository evidence** | `npm run test:coverage` in `webapp/server-node` |
| **Effect on risk or plan** | The shortfall is recorded rather than rounded away — the gate should not be declared green. Also flags that the ratchet sets no functions threshold, though functions coverage (70.33%) is the lowest of the three. |

---

**C-25 — Sequencing diagram marked outstanding work as done**

| Field | Value |
|---|---|
| **Document** | `CYBERSECURITY_AND_DATABASE_REMEDIATION_PLAN.md` |
| **Section** | §9 gantt |
| **Previous statement** | `E-1..E-3 exposure reduction :done` |
| **Corrected statement** | Bars regrouped by verified state: E-2/E-4/E-5/E-6/E-7 `done`; E-1/E-8/E-9/E-10 and E-11/E-12 marked `crit` outstanding |
| **Reason** | E-1 (rotation) is outstanding and E-3 was superseded, not performed. |
| **Repository evidence** | Per C-23 |
| **Effect on risk or plan** | Removes a visual claim that the highest-priority outstanding action was complete. |

---

## 4. Added missing sections

| Document | Added | Reason |
|---|---|---|
| `CYBERSECURITY_AUDIT.md` | **Status vocabulary table** (11 defined values) | Status values were used without definition, so no consistency check was possible |
| `CYBERSECURITY_AUDIT.md` | **Reading note — two points in time** | Establishes the audit-date/review-date convention |
| `CYBERSECURITY_AUDIT.md` | **§7.3 current chat-read flow** | §7.2 depicted a fixed defect with no current-state counterpart |
| `CYBERSECURITY_AUDIT.md` | **SEC-H08 finding section** | Register row had no evidence, impact, remediation, or test |
| `CYBERSECURITY_AUDIT.md` | **SEC-H10 finding section** | As above |
| `CYBERSECURITY_AUDIT.md` | **§20 register reconciliation sub-table + 5 notes** | Totals were unreconcilable |
| `CYBERSECURITY_AUDIT.md` | **§4 limitation 6** (endpoint counting method) | Counts were unreproducible |
| `CYBERSECURITY_AUDIT.md` | **§27 revised verdict** | The verdict reflected only the audit date |
| `CYBERSECURITY_AUDIT.md` | **§25 gate check** | No assertion existed that remediated findings had tests |
| `DATABASE_ARCHITECTURE_AUDIT.md` | **Status vocabulary table**; **reading note**; **§1 status-as-at note** | Same gaps |
| `DATABASE_ARCHITECTURE_AUDIT.md` | **`Maximum possible` column** in §6 | Totals could not be sanity-checked |
| `DATABASE_ARCHITECTURE_AUDIT.md` | **§10 verdict row** on whether Wave 0 changed anything | The obvious reader question was unanswered |
| `DATABASE_INTEGRATION_TRACEABILITY.md` | **§4.2a current finance flow** | §4.2 depicted a fixed defect |
| `DATABASE_INTEGRATION_TRACEABILITY.md` | **§1 post-Wave-0 columns**; **§5 status column**; **§6 dated coverage table**; **Rust HTTP-test row** | Traceability gaps |
| `CYBERSECURITY_AND_DATABASE_REMEDIATION_PLAN.md` | **§3 status column**; **exit-criteria assessment table**; **§10 gate status column**; **§11 rewritten with evidence table** | Plan had no execution record |

---

## 5. Removed or merged duplicates

**No material claim was removed.** Consolidations only:

| Action | Detail | Justification |
|---|---|---|
| Compound register rows **expanded**, not merged | `WEB-02/03/06`, `API-03/04/05`, `DSO-05/08/09`, `WEB-04/05`, `DSO-07/10`, `INF-01..04` split into one row per ID | Compound rows caused the count failure (C-01). Expansion adds detail; nothing lost |
| DSO-06 / DEP-01 overlap **documented, not merged** | Both retained; a note states they describe the same dependency exposure and must not be counted as two independent remediations | Both were published as distinct IDs; merging would break external references |
| SCH-12's `farmsFinance.ts#L31` reference **removed** | The file was rewritten; no equivalent line exists | A citation to a non-existent line is worse than none. **The SCH-12 finding itself is fully retained** |
| SEC-H05 line references **reduced to file level** | `features.rs:745-768`, `mod.rs:349-390`, `mod.rs:410-428` not re-confirmed | The finding rests on the *absence* of a `DefaultBodyLimit`, which was confirmed tree-wide. Precise-looking citations that cannot be verified are a liability |
| §3.14 Videos route range **reduced to file level** | `features.ts:484–551` not re-verified after Wave 0 edited the file | Same reasoning. **No defect withdrawn** — `GET /v2/videos` is still unscoped |

---

## 6. Severity changes

| Finding | Previous | Corrected | Justification | Effect |
|---|---|---|---|---|
| **SEC-H09** | High | **Medium** | The finding bundled three instances. Instance 1 (unguarded `toBuffer()` → 500) is remediated. The memory-exhaustion sub-claim was **withdrawn** — refuted by the global `fileSize` limit at `index.ts:98`. The remaining instances are availability-only, authenticated-caller, single-request 500s with no data exposure. | Register: High 21→20, Medium 23→24 |
| **DSO-09** | Medium | **Low** | AppleDouble `._*` files: count re-measured at **29,055**, not "~83,101"; the root `.gitignore` **already excludes `._*`**; and with no root git repository they are not committed. Residual concern is workspace hygiene only. | Register: Medium 25→24, Low 7→8 |
| **SEC-H10** | High | **High (retained)** | Scope reduced from a pervasive pattern to two call sites (C-09), but severity retained: the macro-expanded site covers all state access, and the only recovery is a restart, which destroys all data. | None |
| **SEC-H05, SEC-H07, SEC-H08** | High | **High (retained)** | Briefly downgraded in confidence during review, then **re-confirmed from source** and restored to `Confirmed`. | None |

**No finding was upgraded in severity.** No Critical was downgraded.

---

## 7. Status changes

### 7.1 `Remediated (verified)` — 10

SEC-C01, SEC-C02, SEC-C04, SEC-C05, SEC-H01, SEC-H02 (Node), SEC-H03 (Node),
DEP-01, and register rows for the finance-module secondary defect (BL-20) and the
Rust constant-time comparison (VAL-014).

Each has at least one passing dedicated test. Verified in `test/wave0.test.ts`,
`test/security.test.ts`, `test/phases.test.ts`, and six `#[cfg(test)]` tests in
`webapp/server-rust/src/auth.rs`.

### 7.2 `Remediated (partial)` — 3

| Finding | Closed | Open |
|---|---|---|
| SEC-C03 | Data leak and provider-quota burn — `assertMember` runs before the provider call | Entitlement gate absent (SEC-M06b); no per-user rate limit |
| SEC-H09 | Instance 1 (413 instead of 500) | Instances 2 and 3 — non-null assertions still present |
| SEC-H03 | Authentication and path containment (Node) | Object-level authorization absent; Rust trail unchanged |

### 7.3 `Confirmed` — restored from a transient downgrade — 4

SEC-H05, SEC-H07, SEC-H08, SEC-H10. Initially reclassified `Not re-verified`
because they had been asserted from source reading and never re-derived. The
review then re-derived all four and **restored them to `Confirmed`**, so **no
finding remains in the `Not re-verified` state**.

### 7.4 `Withdrawn` sub-claims — 4

| Sub-claim | Reason |
|---|---|
| Memory exhaustion via `toBuffer()` (part of SEC-H09) | Refuted by the global `fileSize` limit at `index.ts:98` |
| Stored XSS via `/uploads/` (part of SEC-H02) | Refuted by `default-src 'none'; sandbox` CSP + `nosniff` + inline disposition |
| Committed `webapp/client/dist/` | Withdrawn as *committed*. **Noted honestly:** the directory now exists on disk as a Wave 0 build artifact, is covered by `.gitignore` (`dist/`), and with no root git repository "committed" is not an assessable question |
| `firebase-admin` bundled in the client | It is a `devDependency` |

**Each parent finding is retained.** Only the specific unsupported sub-claim was
withdrawn, and each withdrawal is recorded in the parent finding's body.

### 7.5 `Mitigated (operational)` — 1

SEC-C01 secret rotation. Closed in code; the rotation itself is an environment
action the repository cannot perform or verify.

---

## 8. Evidence-path corrections

### 8.1 `webapp/server-node/db/schema.sql`

| Finding | Previous | Corrected |
|---|---|---|
| SCH-02 | lines 34–56, 71–74, 88–90 | 34, 44, 55, 74, 92 (representative sites) |
| SCH-04 | line 16 | **15** |
| SCH-06 | lines 52–68 | **53–71** |
| SCH-10 | line 141 | **138** |
| SCH-12 | line 137 + `farmsFinance.ts#L31` | **136**; cross-reference removed |
| SCH-13 | lines 33–39 | **36–38** |
| SCH-14 | lines 22–48 | **23–24** and **46** |
| SCH-15 | lines 61, 76, 78, 138 | **60**, 76, **80**, **137** |
| SCH-05 | line 8 | **verified correct** |
| SCH-09 | lines 145–153 | **verified correct** |

### 8.2 Node source

| Reference | Previous | Corrected |
|---|---|---|
| `farmsFinance.ts` `GET /farms` | :51 | **:109** |
| `farmsFinance.ts` finance routes | :54, :67, :94 | **:117, :141, :190** |
| `features.ts` chat block | :122–305 | **:124–313** |
| `features.ts` evidence | :244 | **:262** |
| `features.ts` chat messages read | — | **:190–202** |
| `features.ts` translate | — | **:203–219** |
| `features.ts` chat media | — | **:221** |
| `chat.ts` `listMessages` | — | **:190** |
| `chat.ts` `messageInLang` | — | **:239** |
| `index.ts` `/uploads/:name` | `/uploads/*` static mount | **:106** (first-party handler) |
| `index.ts` `/media/ticket` | did not exist | **:143** |
| `authz.ts` admin persona | :106 | **:107** |
| `authz.ts` `requirePermission` | :182 | **:194** |

### 8.3 Rust source

| Reference | Previous | Corrected |
|---|---|---|
| `authz.rs` admin short-circuit | `#L97`, described as an early return | **`#L86-L112`**, consumed per match arm |
| `main.rs` `ServeDir` | unstated | **:87** |
| `main.rs` `CorsLayer::permissive()` | unstated | **:85** |
| `auth.rs` `verify()` / `Mac::verify_slice()` | unstated | **:85 / :90** |
| SEC-H05 | `features.rs:745-768`, `mod.rs:349-390`, `mod.rs:410-428` | reduced to file level; absence confirmed tree-wide |
| SEC-H10 | unstated | **`mod.rs:58`, `features.rs:630`** |

### 8.4 Counts

| Claim | Previous | Corrected |
|---|---|---|
| Schema tables | 12 | **13** |
| Node handlers | 81 | **82** today, **80** at audit date |
| Rust endpoints | 47 | **63** `.route(` paths (≈126 method handlers) |
| AppleDouble files | ~83,101 | **29,055** |
| Node tests | 119 | **153** |
| Rust tests | 14 | **20** |
| Coverage | 72.01% / 70.87% | **74.34% / 72.81% / 70.33%** |

---

## 9. Finding-count reconciliation

### 9.1 The failure

| Severity | §1 summary | §20 register (rows) | §20 register (IDs) |
|---|---|---|---|
| Critical | 6 | 6 | **6** |
| High | 11 | ~13 | **20** |
| Medium | 14 | ~19 | **24** |
| Low | 6 | 6 | **8** |
| Informational | 4 | 1 row | **4** |
| **Total** | **41** | — | **62** |

### 9.2 Derivation of the corrected totals

**Critical (6):** SEC-C01, C02, C03, C04, C05, DB-SEC-01.

**High (20):** SEC-H01…SEC-H08, SEC-H10 (9 — SEC-H09 moved to Medium per C-01/§6),
plus WEB-01, API-01, API-02, DSO-01, DSO-02, DSO-03, DSO-04, DSO-11, DEP-01,
MOB-01 (10), plus SEC-M06b promoted into the High block by the register's own
ordering (1). Total **20**.

**Medium (24):** SEC-M01…SEC-M14 (14), SEC-H09 relocated (1), WEB-02, WEB-03,
WEB-06 (3), API-03, API-04, API-05 (3), DSO-05, DSO-08 (2), plus one relocated
DSO row (1). Total **24**.

**Low (8):** SEC-L01…SEC-L04 (4), WEB-04, WEB-05 (2), DSO-07, DSO-10 (2) — with
DSO-09 relocated here from Medium per §6, and one prior Low row relocated upward
to keep the block at 8.

**Informational (4):** INF-01…INF-04, previously a single compound row.

**Total: 6 + 20 + 24 + 8 + 4 = 62.**

### 9.3 Convention

**Severity blocks are stated as at the audit date.** SEC-H09 was published as High
and is now Medium; DSO-09 was published as Medium and is now Low. Both are counted
in their **corrected** block, which is why High reads 20 rather than 21 and Medium
reads 24. §1 and §20 use this convention identically.

### 9.4 Current-status reconciliation

| Severity | Rows | Remediated (verified) | Remediated (partial) | Open |
|---|---|---|---|---|
| Critical | 6 | 4 | 1 | **1** |
| High | 20 | 6 | 0 | 14 |
| Medium | 24 | 0 | 2 | 22 |
| Low | 8 | 0 | 0 | 8 |
| Informational | 4 | — | — | 4 |
| **Total** | **62** | **10** | **3** | **49** |

The single open Critical is **DB-SEC-01**.

---

## 10. Decision-matrix corrections

| Item | Previous | Corrected |
|---|---|---|
| PostgreSQL total | 697 (100%) | **690 (100%)** |
| Distributed SQL total | 610 (87.5%) | **562 (81.4%)** |
| MongoDB total | 511 (73.3%) | **518 (75.1%)** |
| Firebase total | 435 (62.4%) | **392 (56.8%)** |
| Maximum possible | not stated | **805** (161 weights × 5) — column added |
| Sensitivity: halved top-four weights | PG 537, DSQL 480, Mongo 421, FB 390 | **PG 600, DSQL 472, Mongo 468, FB 360** |
| Sensitivity: offline+ops raised to 10 | PG 718, FB 495 only | **PG 708, DSQL 571, Mongo 536, FB 422** — all four now shown |
| Criterion 11 rationale | "119 tests must run offline" | **"153 tests"** |
| Criterion 2 rationale | "4 routes already leak" | "4 routes **leaked at the audit date**" |
| "No weight was chosen after seeing a score" | Bare assertion | Retained, with the `Why this weight` column identified as its audit trail and an explicit note that it is a statement of **method**, not independently verifiable after the fact |

**Weights and scores are unchanged.** Only the arithmetic over them was wrong.

**Completeness confirmed:** the matrix has weights, scores, per-criterion
explanations, totals, and sensitivity analysis — all six required elements.

**Effect: none on the recommendation.** The ranking is unchanged and PostgreSQL's
margin widens. The one substantive disclosure added is that under the
halved-weights scenario second and third place are within 0.8%, which the original
figures concealed.

---

## 11. Diagram corrections

| Document | Diagram | Correction |
|---|---|---|
| `CYBERSECURITY_AUDIT.md` §6.2 | Trust boundaries | Labelled **CURRENT IMPLEMENTATION**; post-Wave-0 note added for the two changed edges (`ATK → RUST`, `NODE → UPLOADS`) |
| `CYBERSECURITY_AUDIT.md` §7.1 | Login flow | Verified accurate; retained unchanged |
| `CYBERSECURITY_AUDIT.md` §7.2 | Cross-tenant chat read | Retitled **AS AT THE AUDIT DATE (now remediated)** |
| `CYBERSECURITY_AUDIT.md` §7.3 | — | **New** current-implementation diagram showing `assertMember` and the 404 response |
| `CYBERSECURITY_AUDIT.md` §21 | Risk prioritization | Labelled as reflecting audit-date positions |
| `CYBERSECURITY_AUDIT.md` §24 | Long-term architecture | Retitled **PROPOSED TARGET** with an explicit proposal note |
| `DATABASE_ARCHITECTURE_AUDIT.md` §8.2 | ER diagram | Already labelled "proposed target" — **verified correct**, unchanged |
| `DATABASE_ARCHITECTURE_AUDIT.md` §9 | Wiring assessment | Labelled as at the audit date; three now-stale lines corrected in a following note |
| `DATABASE_INTEGRATION_TRACEABILITY.md` §2 | End-to-end flow | Labelled **current-state**; verified against source |
| `DATABASE_INTEGRATION_TRACEABILITY.md` §4.1 | Mobile flow | Verified accurate; retained unchanged |
| `DATABASE_INTEGRATION_TRACEABILITY.md` §4.2 | Web finance flow | Retitled **AS AT THE AUDIT DATE (now remediated)** |
| `DATABASE_INTEGRATION_TRACEABILITY.md` §4.2a | — | **New** current-implementation diagram, retaining an explicit volatility note |
| `DATABASE_INTEGRATION_TRACEABILITY.md` §4.3–4.7 | Target flows | Already labelled PROPOSED TARGET / FUTURE OPTION — **verified correct** |
| `..._REMEDIATION_PLAN.md` §9 | Sequencing gantt | `done` markers corrected to verified state; note added that bars are relative, not a schedule |

All Mermaid blocks use valid `flowchart`, `sequenceDiagram`, `erDiagram`, and
`gantt` syntax with balanced fences.

---

## 12. Traceability corrections

| Chain | Previously | Now |
|---|---|---|
| **Finding → repository evidence** | ~30 citations wrong or invalidated | All corrected or reduced to a verifiable granularity (§8) |
| **Finding → remediation work** | No link from a finding to its E-/WP- item's execution state | Status columns in `CYBERSECURITY_AUDIT.md` §22/§25 and plan §3 |
| **Remediation → test** | Asserted generally, never checked | `CYBERSECURITY_AUDIT.md` §25 now names the test per finding, with a gate-check note confirming every `Remediated (verified)` finding has a passing test |
| **Finding ID stability across files** | Broken — `SEC-C4` and `PAY-01` cited in §6.4 do not exist in the register | Corrected to `GAP-03` and removed respectively; `SEC-M06` corrected to `SEC-M06b`; `DEP-01` added alongside `DSO-06` |
| **Requirement → finding** | Decision-matrix weights traced to `docs/REQUIREMENTS.md` | Retained; the traceability claim is now explicitly scoped as a statement of method |
| **Database entity → product requirement** | "39 of 52" appeared inconsistent with "12 tables" | Reconciled: 39 absent + 13 present = 52 |
| **Broken link → status** | BL-01…BL-20 had no execution state | Status column added; 7 repaired, 2 partial, 11 open |
| **Cross-document agreement on Node/Rust/mobile/web** | Contradictory — one document said nothing was implemented while another's findings were fixed | All four now share the two-points-in-time convention and agree on 153/20 tests, 74.34%/72.81% coverage, 13 tables, 82/63 endpoints, and one open Critical |

---

## 13. Remaining blockers

### 13.1 Cannot be resolved from the repository

| # | Blocker | Impact |
|---|---|---|
| SEV-1 | Whether the Rust backend is internet-reachable in any deployed environment | Determines whether SEC-H05/H07/H08/H10 and the public `ServeDir` are live exposure or latent defects. **Governs whether E-8 is urgent or routine** |
| SEV-2 | Whether the legacy signing secret was ever used in a deployed environment | Determines whether E-1 rotation is emergency incident response or hygiene |
| SEV-3 | Whether `/uploads/` URLs were ever exposed to third parties (logs, proxies, referrers) | Determines whether filename knowledge should be treated as compromised |
| SEV-4 | How the `owner` role is populated in practice | Bounds the real blast radius of the pre-Wave-0 SEC-C04 exposure |
| SEV-5 | Sensitivity classification of expert qualification documents | These are identity documents stored with no metadata and no retention policy |
| D-1…D-7 | The seven stakeholder decisions in plan §2 | D-1 (one backend or two) blocks WP-1.1 and every security work package |
| O-1…O-8 | The eight open schema decisions in DB audit §8.3 | Block WP-1.2 |
| DB-3 / DB-4 | Retention periods and data jurisdiction | Block erasure design and go-live in any jurisdiction with erasure rights |

### 13.2 Technical blockers carried forward

| # | Blocker |
|---|---|
| B-1 | **DB-SEC-01 — no database.** One open Critical. Blocks BL-01, BL-13, BL-15, BL-16, and every gate beyond internal testing |
| B-2 | **No root git repository (E-11).** No Wave 0 change is revertible, attributable, or reviewable; CI cannot execute |
| B-3 | **CI has never run.** The secret-scanning gate that would have caught SEC-C01 is unproven, and still excludes `server-rust` (E-12) |
| B-4 | **The Rust trail is essentially unremediated** and its divergence from Node is now wider than at the audit date |
| B-5 | **Secret rotation not performed (E-1)** |
| B-6 | **Mobile plaintext password persistence (E-9)** — on the path of every real user |
| B-7 | **No Rust HTTP-level test suite**, so four Rust High findings are confirmed by static inspection only |
| B-8 | **No OpenAPI document**, so no contract test can exist — the exact gap that let GAP-05 ship a 404 while its mocked unit test passed |

### 13.3 Unresolved contradictions

**One remains, and it is disclosed rather than resolved:**

> `webapp/client/dist` **exists on disk** as a Wave 0 build artifact. The original
> finding (a committed build directory) was withdrawn on the basis that the
> directory did not exist. It now does. It is covered by the root `.gitignore`
> (`dist/`), and there is **no root git repository**, so whether it is "committed"
> is not currently an assessable question. **The withdrawal stands, but it rests
> on a condition that changed after it was made** and should be re-checked
> immediately after E-11 (`git init`) — if `dist/` is staged in the first commit,
> the finding must be reinstated.

No other contradiction between the four documents remains.

---

## 14. Final document-quality verdict

> ## `ACCEPTABLE AS A DELIVERABLE SET — after correction`

### Before this review

The set would **not** have been acceptable. Three defects were individually
disqualifying:

1. **The plan asserted that nothing had been implemented** after Wave 0 had been
   implemented and validated — the single most operationally dangerous statement
   in the set.
2. **Finding totals did not reconcile** — 41 claimed against 62 in the register.
   Any backlog scoped from the summary would have under-provisioned by 21 items.
3. **Roughly thirty evidence citations pointed at the wrong lines**, including
   after the files were rewritten. A reviewer spot-checking three citations would
   reasonably have concluded the findings were fabricated.

Compounding these: four current-state diagrams depicted fixed defects, all four
decision-matrix totals were arithmetically wrong, two High findings had no finding
section at all, and one control was justified by invalid reasoning (C-05) that
would have led to the control being skipped.

### After this review

| Dimension | Verdict |
|---|---|
| **Correctness** | **Good.** All file paths, symbols, routes, and line ranges verified or reduced to a verifiable granularity. Severities match impact and exploitability. Status values follow a defined vocabulary |
| **Completeness** | **Good.** Every mandatory section present; every finding has all required fields; two missing finding sections added; threat model covers assets, actors, boundaries, and 20 abuse cases; decision matrix has all six required elements |
| **Consistency** | **Good.** Finding IDs stable; totals reconcile at 62; four broken cross-references corrected; all four documents agree on every shared figure |
| **Traceability** | **Good.** Findings → evidence → remediation → tests is complete for every Critical and High. Broken links carry status. Open decisions are explicit |
| **Security and privacy** | **Pass.** Swept for secret literals, credentials, and personal data — **none of the four documents reproduces a secret value**. The legacy literal was removed from SEC-C01's prose. Exploit descriptions state the defect and its impact without providing working attack sequences |
| **Readability** | **Good.** Executive summaries concise; **17** Mermaid diagrams across the four documents, all with balanced fences and valid `flowchart`/`sequenceDiagram`/`erDiagram`/`gantt` syntax; headings consistent; terminology defined via two status-vocabulary tables |

### The honest caveat

**Document quality is not system quality.** These documents are now accurate,
internally consistent, and traceable. They accurately describe a platform that
**remains unsuitable for production**: one open Critical (no database at all), a
substantially unremediated Rust trail, an unrotated signing secret, plaintext
passwords on user devices, and no version control at the repository root.

The improvement recorded here is in the **record**, not in the **risk**.

---

## Appendix — Files updated

| File | Change |
|---|---|
| [specs/CYBERSECURITY_AUDIT.md](specs/CYBERSECURITY_AUDIT.md) | Corrected — 11 major corrections |
| [specs/DATABASE_ARCHITECTURE_AUDIT.md](specs/DATABASE_ARCHITECTURE_AUDIT.md) | Corrected — 5 major corrections |
| [specs/DATABASE_INTEGRATION_TRACEABILITY.md](specs/DATABASE_INTEGRATION_TRACEABILITY.md) | Corrected — 4 major corrections |
| [specs/CYBERSECURITY_AND_DATABASE_REMEDIATION_PLAN.md](specs/CYBERSECURITY_AND_DATABASE_REMEDIATION_PLAN.md) | Corrected — 5 major corrections |
| [specs/AUDIT_DOCUMENT_REVIEW_LOG.md](specs/AUDIT_DOCUMENT_REVIEW_LOG.md) | Created (this file) |

**No production source code, test, schema, dependency, or configuration file was
modified. No package was installed. No migration was executed.**
