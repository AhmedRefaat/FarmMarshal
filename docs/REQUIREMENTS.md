# FarmMarshal — Master Requirements & Features Reference

**Version:** 1.0 · **Date:** 2026-08-25 · **Status:** SINGLE SOURCE OF TRUTH
All artifacts (mobile app, web client, server-node, server-rust, architecture docs) MUST
conform to this file. When a requirement changes: update HERE first, then code, then tests
(traceability rows in docs/TEST_COVERAGE_TRACEABILITY.md).

---

## R1 — Roles, Personas & Permissions

### R1.1 Persona catalogue (G0.1b — one login may hold SEVERAL personas)

| Persona | How obtained | Scope of visibility |
|---|---|---|
| `admin` (IT admin) | Platform-provisioned only | EVERYTHING: all farms, users, devices, plans, audit |
| `owner` | Registers/owns a farm | Everything on HIS farms |
| `moderator` (field manager; "manager" in mobile UI) | Invited by owner | His farms: tasks, review, worker ratings |
| `worker` | Invited by owner/moderator | Only his own tasks/comments/evidence |
| `agri_expert` (farm-serving) | Assigned by owner/admin | Farms he serves + video/schedule tools |
| `crowd_expert` | Self-apply → credential verification (F6a) | Global consultations he answers; earnings |
| `academic_expert` | F6a variant with institution verification (staff ID/institutional email) | Like crowd_expert + exam authoring + case endorsement; badged "Academic Expert · N yrs" |
| `learner` | OPEN self-registration from welcome screen | ONLY published case library + exams. NEVER live farm data |
| `accountant` | Provisioned by owner | Finances of his farms only |

### R1.2 Rating matrix (extended)

```
owner      ──rates──► moderator            ✓
owner      ──rates──► worker               ✓
moderator  ──rates──► worker               ✓
moderator  ──rates──► crowd/academic expert (per consultation answer)  ✓
crowd_expert / academic_expert ──rate──► anyone ✗ (they RECEIVE ratings)
learner    ──rates──► anyone               ✗
worker     ──rates──► anyone               ✗
admin      ──rates──► n/a (manages, does not rate)
```

### R1.3 Universal rules
1. Visibility & permissions enforced SERVER-side on every endpoint (`authz` module both trails).
2. Audit trail records WHICH persona performed every sensitive action.
3. Learners are hard-isolated from live operational data.

## R2 — Universal activity workflow (G0.2)
`DETECTED → INSPECTED → IDENTIFIED → RECOMMENDED → IMPLEMENTED → REVIEWED (+evidence) → CLOSED`
Applies to ALL activity kinds. Stage entry requires specific evidence (photos/GPS, root-cause
note, taskId, closure note). See V2_REQUIREMENTS_ANALYSIS §G0.2 for the full gate table.
Evidence capture (ADR-022): photo/video capture available at report time, inspection,
implementation AND resolution — mobile IssueReportScreen + task evidence flow + chat 📷.

## R3–R8 Feature modules (full detail in V2_REQUIREMENTS_ANALYSIS.md)
| ID | Module | Key acceptance criteria |
|---|---|---|
| R3 | Tasks & evidence (v1 core) | state machine guards; geo-tagged before/after photos; native-maps hand-off |
| R4 | Water IoT (F1) | telemetry ingest; tiered cost math; night-flow leak rule w/ dedup; audited valve control (moderator+) |
| R5 | Solar + weather (F2) | per-panel daily reports; cloud-aware dust heuristic → cleaning requests; periodic reports w/ history |
| R6 | Chat + translation (F3) | any-to-any; photo/video/voice/pins/reactions; per-language translation cache; expert inbox grouped farm→area→worker; camera capture IN chat |
| R7 | Video platform (F4b) | robot/human uploads; HLS; timestamped + tree-linked annotations; schedules/events per farm |
| R8 | Trees (F5) | QR-primary identity + GPS accuracy + relative-code fallback; lifespan estimator; archived never deleted |
| R9 | Marketplace (F6) | Uber-style KYC; escrow bounty split (commission/net); 1:1 + group threads; reputation & suspension |
| R10 | Academy (F7) | anonymized case snapshots from closed issues; quizzes w/ server-only keys; exact grading boundary |
| R11 | Subscriptions (owner plan gates ALL premium options) | 402 upgradeRequired; manual ledger → Visa/MC webhook confirmation |
| R12 | Extensibility (F4a) | modular monolith; JSONB metadata; plugin adapters for devices/issues/reports; robot conformance spec |
| R13 | Non-tech usability | Arabic-first RTL (see R15); big targets; persona cards at signup; voice over typing; offline outbox |

## R14 — Artifact parity contract
Mobile (iOS+Android via one Expo binary), web SPA, server-node, server-rust implement THE SAME
requirement set. Route parity is verified by automated diff; divergences must be listed in
EVOLUTION_PLAN §11.3 (currently only: Google-OAuth exchange Node-only, UTC leak window).

### R14.1 Surface parity matrix (as built)

| Capability | Web SPA | Mobile | server-node | server-rust |
|---|---|---|---|---|
| Farm portfolio (per-farm issue buckets) | `Farms` | `FarmsScreen` | `GET /v2/farms`, `GET /v2/issues` | ✓ |
| Farm detail + issue event timeline | `FarmDetail` | `FarmDetailScreen` | `GET /v2/issues/:id/events` | ✓ |
| Per-task audit report | `TaskReport` | `TaskReportScreen` | `GET /tasks/:id/report` | ✓ |
| Expert directory + consultation pool | `ExpertNetwork` | `ExpertNetworkScreen` | `GET /v2/experts`, `GET /v2/consultations` | ✓ |
| Consultation detail, choose, rate | `ExpertNetwork` | `ConsultationDetailScreen` | `GET /v2/consultations/:id` | ✓ |
| Chat (F3) | — (mobile-first) | `ChatScreen` | `/v2/conversations` | ✓ |

## R15 — Language & localization (Arabic-first, Egypt + Gulf)

NORMATIVE DETAIL: **`docs/LOCALIZATION_SPEC.md`**. Summary of the binding requirements:

| ID | Requirement |
|---|---|
| R15.1 | Every user-facing surface ships in **Arabic and English**. Arabic is the default locale of a fresh install. Coverage includes screens, modals, toasts, empty states, validation messages, status badges and the browser document title — 0 untranslated strings. |
| R15.2 | Arabic register is **simplified Modern Standard Arabic**, country-neutral so that Egyptian and GCC users read the same catalogue. Dialect and transliterated English are rejected at review (LOCALIZATION_SPEC §4). |
| R15.3 | Agricultural, IoT and marketplace terminology follows the normative glossary (LOCALIZATION_SPEC §2). Terms are frozen; changes require a glossary edit first. |
| R15.4 | **Western digits and the Gregorian calendar everywhere**, enforced by pinning `-u-ca-gregory-nu-latn` on every formatter. A bare `toLocaleDateString('ar')` is a defect because `ar-SA` resolves to the Hijri calendar. |
| R15.5 | Counts use `Intl.PluralRules`; Arabic's six plural categories (`zero/one/two/few/many/other`) must all be authored where the rule set produces them. |
| R15.6 | Full RTL: web via `dir=rtl` + CSS logical properties; mobile via `I18nManager`. Directional icons mirror; numbers, Latin identifiers and media controls do not. |
| R15.7 | Interpolated values of unknown script are wrapped in a bidi isolate (`<bdi>` / FSI‑PDI) to prevent visual reordering of IDs, emails and coordinates. |
| R15.8 | Sentences are **single catalogue keys with placeholders**. Concatenating translated fragments in code is prohibited — Arabic word order and agreement differ from English. |
| R15.9 | The locale choice is user-selectable at any time, persisted per device, and applied without data loss. Server APIs stay language-neutral: machine-readable error codes, clients own the wording (LOCALIZATION_SPEC §6). |
| R15.10 | User-authored content is stored verbatim in the author's language and never auto-translated at rest; F3 translation stays an on-demand, cached, reversible view. |

## R16 — Tenant isolation of the people directory

`GET /users` and `GET /users/:id/stats` return only the caller and users who share at least one
farm with the caller. The platform `admin` persona is exempt (role administration is
cross-tenant by definition). Out-of-tenant reads return **404, not 403**, so the response cannot
be used to enumerate accounts on other farms. Enforced identically in both server trails.

## Traceability
Requirement IDs here map to: test IDs (TEST_COVERAGE_TRACEABILITY §1), phases
(IMPLEMENTATION_PLAN_AND_TESTS), ADRs (EVOLUTION_PLAN §9–10).

## Branding
The product is **FarmMarshal**. The legacy name "AgriTasks" is retired across code, storage keys
(`farmmarshal_*`), database roles and documentation. The mark ships as
`webapp/client/public/logo.png` (web favicon + sign-in + header) and as the Expo
`icon`/`splash-icon`/`favicon`/`android-icon-*` set under `mobile-app/assets/`.
