# FarmMarshal v2 — Detailed Working Plan & Test Strategy

**Version:** 1.1 · **Date:** 2026-08-25 · **Status:** PLAN (execution started; see phase table)

> **Test documentation map (owner question: "are tests documented with traceability?")**
> - Requirement → test-ID matrix: **`docs/TEST_COVERAGE_TRACEABILITY.md`** §1
> - Measured coverage numbers + honest gap plan: same doc §2–§4
> - Manual procedures per platform (iOS/Windows): **`docs/PLATFORM_TESTING_GUIDE.md`** T1–T12
> - This file keeps the per-phase test *strategy* and the critical-case catalogue.

> Phases are sequenced by dependency, not by business priority alone. Every phase ends with a
> demo + test gate. Durations assume the current small team (1–2 devs) — adjust freely.

---

## Phase overview

| Phase | Name | Delivers | Depends on | Est. |
|---|---|---|---|---|
| P0 | Foundation & RBAC | ✅ **SHIPPED (core)** — persona authz matrix + issues engine + entitlements + flags/audit/event bus + schema.sql + mobile Firebase→REST migration. Remaining: Postgres-backed store adapter (schema ready; memory store active until DATABASE_URL is provisioned), CI wiring | — | done* |
| P1 | Chat & Translation | ✅ **SHIPPED (server + mobile screen)** — conversations/messages/pins/reactions, idempotent sends, translation cache + pluggable providers (mock/google/deepl), WS gateway `/ws` + polling fallback, expert inbox endpoint. Pending: media upload UI (transport ready), FCM push | P0 | done* |
| P2 | Water IoT | ✅ **SHIPPED (server)** — devices/telemetry/valve control (`valve.control` moderator-only, mandatory reason, audited), tiered tariffs/cost, night-flow leak rule → DETECTED issues. Pending: real MQTT bridge (HTTP ingest path live), broker deployment | P0 (+hardware pilot) | done* |
| P3 | Solar & Weather | ✅ **SHIPPED (server)** — panels, daily report job w/ weather-adjusted expectation + sibling median, dust heuristic (cloud-aware, fixture-tested) → cleaning issues. Pending: real inverter adapters, weather API vendor | P2 infra | done* |
| P4 | Video Platform | ✅ **SHIPPED (server)** — video lifecycle, completion contract, timestamped/tree-linked annotations, schedules API. Pending: ffmpeg HLS worker, tus resumable upload, robot simulator conformance suite | P0, S3 | server* |
| P5 | Tree Registry | ✅ **SHIPPED (server)** — QR-primary identity + GPS-accuracy + relative-code resolution (fixture-tested), lifespan estimator → end-of-life recommendations, tree events timeline. Pending: QR print UI, mobile scan screen | P0 | server* |
| P6 | Expert Marketplace | ✅ **SHIPPED (server)** — Uber-style apply→credential→admin verification gate, reputation cards, consultations with escrow split (commission/net fixture-tested), 1:1 thread linkage, rating feed. Pending: web admin queue UI, card checkout | P1 | server* |
| P7 | Learner Academy | ✅ **SHIPPED (server)** — case publication from closed issues (anonymized snapshot), quiz builder with SERVER-ONLY answer keys, exact-boundary grading (89.9 fails @90). Pending: learner mobile screens, certificate generation | P0 (+P6) | server* |
| P8 | Arabic-first localization | ✅ **DONE** — in-house i18n layer + `ar`/`en` catalogues on both clients, RTL via logical properties (web) and `I18nManager` (mobile), Gregorian/Western-digit formatters, locale switcher, catalogue-parity tests. All 10 web pages + shell and all 13 mobile screens converted. Normative rules in `docs/LOCALIZATION_SPEC.md`. Remaining gate: **L3 native-speaker copy review** | P1–P7 UI surfaces | L1–L6 |

Continuous tracks: usability reviews with real field users each phase; docs updated at ship time
(per EVOLUTION_PLAN §7); security review before any hardware is attached to real valves.

> **P0 scope note (multi-persona):** the authz module is built persona-based from day one
> (`users` + `user_personas`, permission = union of active personas, audit logs record the acting
> persona) so later personas (learner, crowd_expert, academic_expert) are data rows + UI, not
> refactors. The welcome-screen persona cards and switcher ship in P0; learner content ships in P7.

---

## Phase working plans

### P0 — Foundation & RBAC (do first: unblocks everything)
1. Provision Postgres + TimescaleDB; write schema migrations for §2 of EVOLUTION_PLAN
   (farms, farm_members, roles incl. admin/agri_expert/accountant, issues, issue_events, audit_log).
2. Build `authz` module: single `can(actor, action, resource)` matrix; refactor every existing route through it.
3. Implement `issues` module: stage machine + guards + timeline endpoint; migrate "review/reject"
   semantics to sit beside tasks (tasks untouched).
4. Event bus (in-process) + feature flags table.
5. **Entitlements scaffold:** `plans` / `plan_features` / `subscriptions` tables +
   `requireEntitlement(featureKey)` middleware + manual payment ledger entry UI
   (SUBSCRIPTION_AND_PAYMENTS_DESIGN.md §1–3 stage 1).
6. Seed script v2 (farms, demo devices, all roles, 3 demo plans).
7. **Mobile Phase-2 API migration:** switch `authService`/`taskService` from Firebase to the new
   REST API behind the existing service-layer interface (screens untouched) — completes the
   long-planned Firebase retirement before any feature phase builds on two backends.
8. Update both ARCHITECTURE.md docs (§7 mapping) and ADRs 004/006/009.

### P1 — Chat & Translation
1. WS gateway (`/ws`) with auth token handshake + presence.
2. Messages CRUD (idempotency keys), media upload via signed URLs (photo/video/voice), pins, reactions.
3. Translation adapter interface + BOTH providers (Google + DeepL); active provider resolved from
   the farm's plan entitlement; cache translations on message row; auto-detect language;
   "show original" toggle.
4. Mobile chat UI: inbox grouped **farm → area → worker**, composer (attach/photo/video/voice),
   pin list, RTL layout. Web: basic thread view for owner/expert.
5. FCM server push for backgrounded recipients (replaces local-only notifications for chat).

### P2 — Water IoT
1. Stand up broker (Mosquitto/EMQX) w/ TLS + per-device credentials + topic ACLs.
2. `ingest` module: subscribe, validate, write Timescale hypertable; backfill endpoint.
3. Device registry admin screens (web) + provisioning flow (device claims secret).
4. Valve control: command topic, ack tracking, interlocks, full audit trail, mobile confirm dialog.
5. Tariff config + cost aggregation jobs (continuous aggregates for hourly/daily rollups).
6. Leak rule engine v1 (night-flow, z-score deviation) → auto-create DETECTED issues + notify.
7. Dashboards: web water page (charts, cost, valve board, leak queue); mobile summary card.

### P3 — Solar & Weather
1. Inverter/panel telemetry ingestion (same pipe as P2; vendor adapter pattern proven here).
2. Nightly job: per-panel energy vs expected (weather-aware) vs siblings → dust_status.
3. Weather cache integration (hourly per farm).
4. Cleaning request flow → RECOMMENDED issue → task conversion.
5. Reports service: daily/weekly/monthly/yearly generation + immutable archive versions + viewer UI.

### P4 — Video platform
1. tus resumable upload endpoint + **robot simulator implementing docs/ROBOT_INTEGRATION_SPEC.md**
   (conformance suite §7 runs in CI from day one — hardware arrives later without rework).
2. ffmpeg HLS transcode worker + storyboard thumbnails; `video.ready` event → notify expert.
3. Schedule entity + UI (expert creates missions/events per farm; calendar view).
4. Player page: HLS playback, click-timeline → timestamped comments, in/out-point scene links,
   SVG overlay drawing, annotation list recall.
5. Retention policy config per farm.

### P5 — Trees
1. Trees CRUD + QR code generation/print sheets; mobile scan → tree timeline.
2. **Identity flow:** GPS capture with accuracy read; weak-GPS path stores sector/row/position
   relative code; all cross-references (tasks/issues/annotations) carry `treeId`.
3. Species table + lifespan/yield-curve estimator; status transitions with expert confirmation;
   archived (never deleted) trees remain queryable for history.
4. Video annotations linkable to trees (`tree_id`) → shown in the tree timeline with
   jump-to-timestamp.

### P6 — Marketplace (Uber-style)
1. **Expert onboarding funnel:** registration → credential upload → admin verification queue
   (auto checks + human review) → verified badge; expiry re-checks; suspension/deactivation.
2. Consultation lifecycle (escrow→open→finalists→chosen→settled/disputed), public/targeted scope,
   language tagging with P1 translation reuse; **commission split** computed at acceptance.
3. **Linked communication:** group thread while open + 1:1 threads per accepted responder,
   both built on the F3 chat engine and embedded in the consultation page.
4. Reputation: /ratings aggregates + acceptance rate + earnings on public profile card;
   min-rating gate config; dispute flag + admin resolution screen.
5. Payout ledger (manual settle now, gateway later).
6. Card payments stage 2: hosted checkout (Visa/Mastercard via gateway) + idempotent signed
   webhook that authoritatively confirms with the bank/gateway and extends the subscription
   (SUBSCRIPTION_AND_PAYMENTS_DESIGN.md §3).

### P7 — Learner Academy & Academic Experts
1. Persona activation UX: learner self-registration card, academic/crowd-expert application forms,
   in-app persona switcher (P0 scaffold becomes user-facing).
2. Case publisher (web): pick a closed issue / settled consultation → anonymization rules →
   publish to library; crop/topic tags.
3. Learner mobile+web experience: case library browser, case reader showing the full 7-stage chain
   with evidence; hard rule: learners can never query live farm data.
4. Quiz builder (web, academics/verified experts): MCQ / true-false / photo-diagnosis questions
   from case media; answer keys stored server-only.
5. Exam player + scoring (mobile & web): server-side grading, attempts history, pass thresholds;
   learner progress profile.
6. Academic expert verification path (institutional email/staff ID) inside the F6a review queue;
   "Academic Expert · N yrs" badge; authoring privileges gated on verification.

### P8 — Arabic-first localization (R15)

Normative rules: **`docs/LOCALIZATION_SPEC.md`**. Decisions: ADR-025–ADR-029.

1. **i18n layer per client** (`src/i18n/`): `LocaleProvider` + `useI18n()` exposing
   `{ locale, setLocale, dir, t, fmt }`. Catalogue lookup, `{{}}` interpolation,
   `Intl.PluralRules` selection, and formatters pinned to `-u-ca-gregory-nu-latn`.
   Provider sits **above** the auth provider so the sign-in surface is already localized.
2. **Catalogues**: `en.ts` (reference key set) and `ar.ts` (default locale), namespaced by
   surface. Arabic authored to the §2 glossary in simplified MSA; six plural categories where
   the rule set produces them.
3. **Web RTL**: rewrite `styles.css` onto CSS logical properties; `LocaleProvider` writes
   `<html lang>` / `<html dir>` and the document title. Locale switcher in the sidebar and on
   the Login card.
4. **Mobile RTL**: `I18nManager.allowRTL/forceRTL` at startup, reload-on-switch dialog,
   `textAlign:'start'` + `writingDirection` in shared text styles, locale switcher on Login
   and on both role home screens.
5. **String sweep**: every page/screen converted — headers, labels, buttons, placeholders,
   status badges, empty states, confirm dialogs, validation and error copy. Status badges
   translate through the catalogue, never by title-casing the wire value.
6. **Error boundary**: clients map HTTP status → localized copy; raw server text only in dev.
7. **Formatting sweep**: replace every `toLocaleDateString()` / `toLocaleString()` /
   manual `${n} EGP` with `fmt.*`.
8. **Parity tests** (`i18n/__tests__`): identical key sets across catalogues; Arabic plural
   completeness; no bare `toLocale*` left in UI code.
9. **Native review**: one Egyptian + one Gulf reviewer sign off per LOCALIZATION_SPEC §7 (L3).

---

## Test strategy (per phase, mapped to features)

### Levels & tooling
| Level | Tool | Scope |
|---|---|---|
| Unit | Vitest (API/web), Jest (RN) | permission matrix, stage guards, tariff math, leak/dust heuristics, translation caching |
| Contract | OpenAPI schema validation on every endpoint | prevents client/server drift; runs in CI |
| Integration | Testcontainers (Postgres/Timescale/Mosquitto/MinIO) | route→DB roundtrips, ingest pipeline |
| E2E web | Playwright | role-scoped navigation, dashboards, video annotation flows |
| E2E mobile | Detox/Maestro | login, task flow regression, chat send/receive, tree scan |
| Load | k6 | telemetry ingest rate, WS concurrent chats, report queries |
| IoT simulation | Python/Node device simulator publishing MQTT | no-hardware CI testing |
| UAT | scripted sessions with real workers/moderators | usability rule compliance each phase |

### Critical test cases by feature (the ones that prove correctness)

**P0 RBAC & workflow**
- Full permission-matrix table test: every role × every endpoint → allowed/403 exactly as specified (admin sees all farms; worker sees only own tasks; accountant finances only).
- Stage machine: every legal transition succeeds with required evidence; every illegal one 409s; closed issues immutable; concurrent transition race resolved deterministically.

**P1 Chat**
- Two users, different locales: A sends Arabic → B sees English automatically; original preserved; toggle works.
- Idempotency: duplicate message IDs create ONE row (retry-safe offline outbox).
- Media: oversized/wrong-MIME uploads rejected; voice note plays; pin/unpin reflects on both clients < 1 s over WS; FCM received while app backgrounded.
- Load: 200 concurrent WS clients × mixed traffic stays under latency budget (p95 < 500 ms).

**P2 Water**
- Simulator publishes readings incl. gaps/backfills → aggregates match hand-computed sums.
- Cost: tiered tariff fixture → known EGP result; tariff change applies from effective date only.
- Leak rules: replay night-flow dataset → issue created once (no duplicates); benign dataset → zero false positives on fixture set.
- Valve: open/close round-trip with simulated ack updates status; unauthorized role → 403; every attempt lands in audit log; broker down → command queued not lost.

**P3 Solar**
- Fixture: cloudy day + low output → status OK (no false dust flag); clear day + sibling −25% → suspect; confirmed → cleaning request pre-filled with correct panel IDs.
- Reports: weekly = sum of dailies (exact); closed period immutable; history versions retrievable.

**P4 Video**
- Interrupted upload resumes and yields byte-identical asset; HLS seeks to annotated second ±0.5 s; overlay SVG renders on the exact frame; annotation list recalls in order; notification fires to requesting expert only.

**P5 Trees**
- QR scan resolves tree across roles (worker sees read-only); identity survives GPS drift: same tree found via relative code when accuracy > threshold; every task/issue/annotation referencing the tree appears in its timeline; end_of_life recommendation appears only when age > lifespan OR yield trend below threshold; archived tree still fully queryable.

**P6 Marketplace**
- Verification workflow: pending→verified/rejected transitions admin-only; unverified expert blocked from answering; expired credential flips to re-verify.
- Commission math: known bounty × rate fixture → exact platform/net split recorded on settlement; escrow never releases without `chosen`.
- Threads: group thread contains requester + responders only (outsider 403); narrowing to finalists makes non-finalists read-only; accepted responder's 1:1 thread auto-created and pre-contextualized; translation round-trip EN↔AR inside consultation threads.
- Non-expert responder blocked if below rating threshold; choose-response locks further answers; rating persists to reputation card; payout status transitions audited.

**P0/P7 Multi-persona & Academy**
- Persona union permissions: moderator+crowd_expert user gets both capability sets; farm actions audited under farm persona, marketplace earnings under crowd persona.
- Learner isolation (IDOR-style sweep): learner token cannot read any live task/issue/telemetry/farm endpoint — only `/v2/cases*` and `/v2/quizzes*`.
- Anonymization: published case masks farm/worker names & exact geo per rules; source issue changes after publication do NOT leak into the case snapshot.
- Exam integrity: answer keys absent from every client payload; MCQ/photo-diagnosis grading matches fixture scores exactly; double-submit of an attempt creates one record; pass threshold boundary honored (89.9 fails, 90.0 passes at 90%).
- Academic gating: unverified academic cannot author quizzes; verified badge appears only after admin approval; expired institutional credential revokes authoring.

**Cross-cutting security tests**
- IDOR sweep: authenticated user A requests B's resources by ID → 403/404 everywhere (automated fuzz of all GET-by-id routes).
- User directory: non-admin `GET /users` returns ONLY farm co-members; `GET /users/:id/stats` for an out-of-tenant id returns **404** (a 403 would confirm the account exists). Admin still sees everyone. Both trails. (R16 / ADR-024)
- MQTT: device cred cannot publish to another farm's topics.
- Injection/XSS on comment/annotation text; path traversal on media URLs.

**P8 Localization (test IDs L1–L6, requirement R15)**
- **L1 catalogue parity**: `ar` and `en` expose an identical key set; a key added to one and not the other fails CI. Arabic plural records supply every category `Intl.PluralRules('ar')` can return.
- **L2 no literal strings**: no user-facing literal remains in `pages/**` / `screens/**`; enforced by a sweep test over the source.
- **L3 register review**: native review by an Egyptian and a Gulf reviewer; any dialect or transliteration (LOCALIZATION_SPEC §4) is a blocking finding.
- **L4 RTL layout**: every screen rendered in `ar` at the largest OS font size — no clipping, no LTR leakage, directional icons mirrored, media controls not mirrored.
- **L5 formatting**: dates render Gregorian with Western digits in BOTH locales (guards the `ar-SA` Hijri default); currency renders `ج.م` for EGP; counts select the correct Arabic plural category for 0/1/2/3/11/100.
- **L6 bidi**: Arabic sentences embedding Latin ids/emails/coordinates render in the intended order (isolation applied); verified on task ids, farm ids and GPS pairs.

### Definition of Done (every phase)
1. All new endpoints covered by contract + integration tests; CI green.
2. Permission-matrix tests extended for new features.
3. UAT session with ≥ 2 non-technical users completed without moderator help.
4. ARCHITECTURE.md(s) + ADR statuses updated; seed/demo data refreshed.
5. Demo to you with sign-off before next phase starts.

---

## Resolved decisions (owner answers, 2026-08-25)

| # | Question | Decision | Plan impact |
|---|---|---|---|
| 1 | Hardware vendors | **Not selected yet** → build vendor-neutral HAL with adapters; design rationale documented per option class (pulse meters, Modbus-via-gateway, MQTT-native valves) — EVOLUTION_PLAN §10 | P2/P3 build against canonical model + simulator; vendor choice later = one adapter |
| 2 | Field connectivity | Farm **Wi-Fi + gateway** (gateway buffers during outages); mobile on Wi-Fi/5G; connectivity loss is a first-class failure case | Outage-replay tests mandatory in P2/P3/P4; offline outbox in mobile chat/uploads |
| 3 | Translation & budget | **Both providers built; enabled/disabled by the owner's subscription plan** — generalized: ALL features gate on the owner's plan tier | New cross-cutting entitlement system in P0 (`plan_features` + `requireEntitlement`); see SUBSCRIPTION_AND_PAYMENTS_DESIGN.md |
| 4 | Payments | Manual ledger first; then Visa/Mastercard via gateway with **bank/gateway webhook confirmation** as authoritative signal | Stage-1 manual in P0 admin UI; card checkout + idempotent webhooks in P6; payouts stay manual-ledger-first |
| 5 | Robot | Still in design → we publish the contract: `docs/ROBOT_INTEGRATION_SPEC.md` (API, expectations, 7-scenario conformance simulator) | P4 builds spec-driven robot simulator + conformance suite BEFORE hardware exists; mobile-camera fallback path included |

### Additional test cases added by these decisions
- **Entitlement matrix:** every plan tier × gated endpoint → 200 vs 402(upgradeRequired); mid-cycle downgrade flips access ≤ 60 s; translation provider switches per tier; char-quota exhaustion falls back gracefully.
- **Payments:** webhook replay/duplicate → single activation (idempotent); forged webhook signature rejected; failed bank confirmation leaves subscription untouched; manual and card rails reconcile.
- **Robot conformance suite:** the 7 scenarios in ROBOT_INTEGRATION_SPEC §7 run continuously in CI against the simulator.
- **Connectivity:** gateway 15-min outage replay → zero reading loss after backfill; mobile airplane-mode chat/evidence upload → drains outbox exactly-once on reconnect.

## Original open-question log (all answered — kept for audit)
1. Water/solar hardware vendors already chosen? 2. Field internet coverage? 3. Translation provider & budget? 4. Payment rail? 5. Robot vendor vs integration spec? — See table above for outcomes.
