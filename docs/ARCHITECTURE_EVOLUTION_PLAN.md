# FarmMarshal — Architecture Evolution Plan (v2)

**Version:** 1.0 · **Date:** 2026-08-25 · **Status:** PLANNED CHANGES (nothing implemented)

> This is the *how*: the exact changes to make to the system and to the two
> `ARCHITECTURE.md` documents, the new data model, service topology, and API additions.
> Sequencing lives in `IMPLEMENTATION_PLAN_AND_TESTS.md`.

---

## 1. Target topology (after all phases)

```
 Mobile (Expo RN)          Web SPA (React+Vite)
        │  REST + WebSocket       │
        └───────────┬─────────────┘
                    ▼
      ┌──────────────────────────────────┐        ┌─────────────────────┐
      │   API Gateway = Fastify (Node)   │◄──────►│ MQTT Broker         │
      │   modules:                       │        │ (EMQX/Mosquitto,    │
      │   auth · tasks · issues · chat   │        │  TLS + per-device   │
      │   water · solar · video · trees  │        │  tokens)            │
      │   marketplace · admin            │        └────────┬────────────┘
      └───┬──────────┬─────────┬─────────┘                 │ publish/subscribe
          ▼          ▼         ▼                           ▼
     PostgreSQL  Redis    S3-compatible           [future] Axum ingest svc
     +TimescaleDB (cache/  object storage                  for >100 msg/s
      (time-series) queue) media/HLS/receipts              telemetry
                    │
          [future] Python FastAPI CV svc — dust detection on panel photos
```

Key structural decisions:
1. **Modular monolith first.** One deployable Fastify app with strict module boundaries +
   in-process event bus (`issues.detected`, `video.ready`, `message.created` …). Microservices
   (Axum ingest, Python CV) are extracted ONLY when load demands it — clients never notice.
2. **One database engine**: PostgreSQL (+ TimescaleDB extension for telemetry). Ends the
   dual-store ambiguity; Firestore is retired at Phase-2 cutover (already planned).
3. **MQTT broker as the device edge**, never direct HTTP from sensors.
4. **S3-compatible storage** (MinIO self-hosted start → S3/R2 later) for photos, voice notes,
   video HLS, receipts.

## 2. Data model changes (PostgreSQL DDL sketch)

New/changed tables (JSONB `metadata` on every core table = the "dynamic system" requirement):

```sql
-- G0.1 roles & tenancy
users(id, name, email, role CHECK(role IN ('admin','owner','agri_expert','moderator','worker','accountant')), locale, farm_ids UUID[], ...)
farms(id, owner_id, name, center_lat, center_lng, boundary JSONB, metadata JSONB)
farm_members(farm_id, user_id, role_in_farm)             -- visibility scoping

-- G0.2 universal issue workflow
issues(id, farm_id, kind, stage CHECK(stage IN ('detected','inspected','identified',
       'recommended','implemented','reviewed','closed')),
       source ENUM('sensor_rule','human_report','ai_detection'),
       title, severity, metadata JSONB, created_by, closed_at,
       UNIQUE open-constraint: partial index where stage <> 'closed')
issue_events(id, issue_id, from_stage, to_stage, actor_id, note, evidence JSONB, at)

-- F1 water
devices(id, farm_id, type ENUM('water_meter','valve','inverter','panel_sensor','robot','gateway'),
        vendor, secret_hash, status, last_seen_at, metadata JSONB)
telemetry(time TIMESTAMPTZ, device_id, metrics JSONB)    -- Timescale hypertable, continuous aggs
valve_commands(id, device_id, action, requested_by, reason, issued_at, acked_at, result)
water_tariffs(farm_id, effective_from, tiers JSONB)      -- tiered EGP/m³
weather_cache(farm_id, ts, temp_c, cloud_pct, irradiance_est, raw JSONB)

-- F2 solar
panels(id, farm_id, string_id, nameplate_kwp, install_date, gps, metadata)
daily_panel_reports(panel_id, date, energy_kwh, expected_kwh, sibling_ratio, cloud_pct,
                    dust_status ENUM('ok','suspect','confirmed'), report_version)
report_archive(farm_id, period_type, period_start, payload JSONB, generated_at) -- immutable history

-- F3 chat
conversations(id, kind, title, farm_id, metadata)
conversation_members(conversation_id, user_id, last_read_at)
messages(id, conversation_id, sender_id, type ENUM('text','photo','video','voice','system'),
         original_text, original_lang, translations JSONB, media_url, duration_s,
         pinned BOOLEAN, reply_to_id, idempotency_key UNIQUE, created_at)
message_reactions(message_id, user_id, emoji)

-- F4b video
videos(id, source_device_id, farm_id, area_tag, hls_url, duration_s, status ENUM('uploading','processing','ready'), recorded_at)
video_annotations(id, video_id, author_id, t_start_s, t_end_s, text, overlay_svg, scene_id,
                  tree_id? REFERENCES trees)   -- links expert review notes to a specific tree
schedules(id, farm_id, kind ENUM('robot_mission','irrigation','inspection'), cron_or_once, payload, created_by)

-- F5 trees (identity: QR primary + GPS secondary, see V2_REQUIREMENTS F5)
trees(id, farm_id, sector, qr_code UNIQUE, species_code, planted_at, gps,
      gps_accuracy_m?, location_method ENUM('gps','relative_code','manual'),
      relative_code?,            -- "row-12/pos-3" fallback when canopy GPS is weak
      status ENUM('productive','aging','end_of_life_recommended','removed_archived'), metadata)
tree_events(tree_id, event_kind, note, evidence JSONB, at)
species(codes→expected_lifespan_years, yield_curve JSONB)

-- G0.1b multi-persona identity (one app binary for all personas)
user_personas(id, user_id, persona ENUM('admin','owner','agri_expert','moderator','worker',
              'accountant','learner','crowd_expert','academic_expert'),
              status ENUM('active','pending_verification','suspended'),
              is_active_persona? per-user pointer, metadata JSONB)
-- farm-scoped personas additionally appear in farm_members; permissions = union of active personas

-- F7 learner academy
academic_profiles(id, user_id, institution, title, years_experience, publications_url?,
                  verification_id REFERENCES expert_verifications)
case_library(id, source_type ENUM('issue','consultation'), source_id,
             published_by, anonymization JSONB,      -- name/geo masking rules applied at read time
             crop_tags[], learning_objectives, status ENUM('draft','published','retired'))
quizzes(id, title, author_id, case_ids UUID[], pass_threshold_pct, status)
quiz_questions(id, quiz_id, type ENUM('mcq','true_false','photo_diagnosis'), prompt,
               media_url?, options JSONB, answer_key JSONB /* server-only */, points)
quiz_attempts(id, quiz_id, user_id, answers JSONB, score_pct, passed,
              started_at, completed_at)

-- F6 marketplace (Uber-style: onboarding/verification + commission + linked threads)
expert_profiles(id, user_id, country, languages[], specializations[], years_exp,
                status ENUM('pending','verified','rejected','suspended'), avg_stars_cache,
                answers_count, acceptance_rate, total_earned)
expert_verifications(id, expert_id, doc_type, doc_url, expires_at?,
                     review_status ENUM('auto_ok','in_review','approved','rejected'),
                     reviewed_by?, reviewed_at?)
consultations(id, requester_id, question, media JSONB, bounty_egp, platform_commission_pct,
              scope ENUM('public','targeted'), status ENUM('escrow','open','finalists','chosen','settled','disputed'),
              chosen_response_id, language,
              group_conversation_id REFERENCES conversations)   -- open discussion thread
consultation_responses(id, consultation_id, responder_id, answer, media JSONB,
                       conversation_id REFERENCES conversations,  -- 1:1 thread per accepted responder
                       rating_stars?, commission_amount, net_payout,
                       payout_status ENUM('none','pending','paid'))

-- existing tables kept: users(extended), tasks(+issue_id FK), comments, ratings, finances(+farm_id)
```

Migration order matters: farms/farm_members first (everything hangs off them), then RBAC roles,
then features in phase order.

## 3. New/changed services & modules (Fastify monolith internals)

| Module | Owns | Emits events |
|---|---|---|
| `authz` | role/farm permission matrix, single choke point used by ALL routes | — |
| `issues` | 7-stage machine, guard rules, issue timeline | `issue.stage_changed` |
| `ingest` | MQTT subscribe, validation, backfill writes | `reading.recorded` |
| `rules` | leak rules, dust heuristics, scheduled jobs | `issue.detected`, `cleaning.recommended` |
| `chat` | WS gateway, translation provider adapter, pins, media refs | `message.created` |
| `media` | S3 upload signing, ffmpeg HLS pipeline, storyboards | `video.ready` |
| `reports` | daily/weekly/monthly/yearly rollups, archive versions | — |
| `trees` | registry, QR lookup, lifespan estimator | — |
| `market` | consultations lifecycle, payouts ledger | — |

Cross-cutting: feature flags per farm, audit log table (admin-visible), OpenAPI `/v2` contract.

## 4. Mobile app changes

- Replace remaining Firebase calls with REST/WS to the API (Phase-2 migration completes here).
- Add screens: Chat (inbox grouped by farm→area→worker; composer with photo/video/voice/pin),
  Water dashboard (per-farm consumption, valve toggles with confirm dialog), Issues list
  (stage badges), Tree scan (QR → timeline), Consultation ask/answer,
  **Persona switcher + welcome-screen persona cards ("I work on a farm / own land / want to
  learn / am an expert")**, **Learner mode** (case library reader, exam player with
  photo-diagnosis questions). BLE/local-network module for valve/meter pairing (native module
  escape hatch documented).
- BLE/local-network module for valve/meter pairing (native module escape hatch documented).
- Arabic-first RTL i18n across every screen; large-target UI kit alignment. **→ P8, see §4.1.**

### 4.1 Mobile status (as built, 2026-08-28)

| Screen | State |
|---|---|
| Login, TaskList, TaskDetail, ManagerTasks, CreateTask, ReviewTask | ✅ shipped |
| ChatScreen (F3 inbox → thread, media) | ✅ shipped |
| IssueReportScreen (R2 stage-gated capture, ADR-022 evidence) | ✅ shipped |
| FarmsScreen / FarmDetailScreen (portfolio, issue buckets, event timelines) | ✅ shipped |
| TaskReportScreen (aggregate audit report) | ✅ shipped |
| ExpertNetworkScreen / ConsultationDetailScreen (F6 marketplace) | ✅ shipped |
| Water dashboard, Tree scan, Learner mode, persona switcher | 📋 planned |
| Arabic/RTL localization of all of the above | 🔨 P8 in progress |

## 5. Web app changes

- New pages: Admin (users/farms/devices/flags), Water, Solar (panel heatmap + drilldown),
  Reports viewer (period selector + history versions), Video Review (HLS player + timeline
  annotations + SVG overlay editor), Trees map/table, Marketplace, Issues board (kanban by stage).
- Role-aware sidebar; expert gets inbox-centric home.
- Academy pages: case publisher (pick closed issue → anonymize → publish), quiz builder,
  academic verification queue, learner progress overview.
- **Bilingual Arabic/English shell**: `LocaleProvider` above the router, `dir` on `<html>`,
  CSS logical properties throughout, locale switcher in the header and on Login (P8).

### 5.1 Web status (as built, 2026-08-28)

✅ `Login`, `Dashboard`, `TaskList`, `TaskDetail`, `TaskReport`, `Farms`, `FarmDetail`,
`Finance`, `ExpertNetwork`, `Evaluations`. 📋 Admin, Water, Solar, Video Review, Trees, Academy.

## 6. Security additions

- Per-device credentials (username=deviceId, random secret) + TLS; topic ACLs `farm/{id}/#`.
- Signed upload URLs only; content-type/size caps; virus-scan hook optional.
- Valve command endpoint requires step-up confirmation + full audit trail.
- Translation provider key server-side only; PII minimal in prompts.
- RBAC matrix unit-tested exhaustively (see test plan).
- **Tenant-scoped people directory** (R16): `GET /users` and `GET /users/:id/stats` restricted
  to the caller's farm co-members; `admin` exempt; out-of-tenant reads answer 404 rather than
  403 so the endpoint cannot enumerate accounts. Both trails.

## 7. Changes to be applied to existing ARCHITECTURE.md docs

When implementation of each phase lands, edit:

**mobile-app/ARCHITECTURE.md**
- §2.4 add packages: `react-native-webrtc`? (no—defer), `expo-av` chat media, `@shopify/flash-list`
  chat lists, `react-native-svg` annotation display, BLE lib (TBD after spike).
- §3.1 replace Firestore schema section with pointer to Postgres contract + offline queue notes.
- §4 add flows: chat send/translate/receive; valve control confirm; tree scan.
- §7 limitations table updated per shipped phase.

**webapp/ARCHITECTURE.md**
- §2 topology replaced by §1 diagram above; Trails section rewritten as "Fastify primary,
  Rust/Axum reserved for ingestion microservice (see TECH_COMPARISON_STUDY.md)".
- §5 entities extended with §2 DDL summary; §6 REST contract gains v2 endpoints (below).
- §10 v2 requirements board updated statuses as phases ship.

## 8. New API surface (v2, contract-first)

```
WS   /ws                          {auth} → chat + notifications multiplexed
POST /v2/issues                   create human-reported issue
GET  /v2/issues?farmId=&kind=&stage=
PATCH /v2/issues/:id/stage        {toStage, note, evidence}  (guards per G0.2)
POST /v2/devices                  register device [admin]
POST /v2/devices/:id/command      valve open/close [moderator+, audited]
GET  /v2/farms/:id/water/summary?period=daily|weekly|monthly|yearly
GET  /v2/farms/:id/water/leaks    open leak issues
GET  /v2/farms/:id/solar/panels?date=      daily panel reports
POST /v2/farms/:id/solar/cleaning-request   → creates RECOMMENDED issue
GET  /v2/farms/:id/weather?from=&to=
GET  /v2/reports/:farmId?type=&period=&version=
POST /v2/conversations  GET /v2/conversations?role=inbox   (expert grouping)
POST /v2/messages (multipart)  PATCH /v2/messages/:id/pin
POST /v2/translate                {messageId, targetLang}
POST /v2/videos/upload (resumable/tus)  GET /v2/videos?farmId=&area=
POST /v2/videos/:id/annotations   {tStart,tEnd,text,overlaySvg}
GET/POST /v2/schedules            robot missions & farm events
GET/POST /v2/trees  GET /v2/trees/:qr  POST /v2/trees/:id/events
POST /v2/experts/apply                       expert registration (profile + credentials)
GET  /v2/experts/:id/profile                 public reputation/history card
GET  /v2/admin/verifications?status=in_review   [admin] credential review queue
PATCH /v2/admin/verifications/:id            approve/reject [admin]
POST /v2/consultations  POST /v2/consultations/:id/responses
PATCH /v2/consultations/:id/choose           (escrow split → commission + payout ledger)
POST /v2/consultations/:id/thread            {kind:'group'|'direct', responderId?} → F3 chat
POST /v2/ratings                             (exists — reused for expert answers)

-- G0.1b personas & F7 academy
POST /v2/auth/register            {entryPersona: learner|...} → open self-registration paths
GET  POST /v2/personas            list own personas · apply for {learner,crowd_expert,academic_expert}
POST /v2/personas/switch          set active persona (audit-logged)
GET  /v2/cases?crop=&topic=       published learning cases [learner+]
GET  /v2/cases/:id                full 7-stage chain (anonymization applied)
POST /v2/quizzes                  author exam [academic_expert|verified crowd_expert]
GET  /v2/quizzes?case=            browse exams
POST /v2/quizzes/:id/attempts     submit answers → server-side scoring
GET  /v2/learners/me/progress     attempts, scores, passed exams
```

## 9. Architecture Decision Records (index)

| ADR | Decision | Status |
|---|---|---|
| ADR-001 | Keep React Native (Expo) for mobile | Accepted (see comparison study §A) |
| ADR-002 | Keep React + Vite for web; Angular evaluated and declined | Accepted (§B) |
| ADR-003 | Node+Fastify primary backend; polyglot escape hatches defined | Accepted (§C) |
| ADR-004 | PostgreSQL+TimescaleDB replaces in-memory & Firestore | Accepted, P0 |
| ADR-005 | MQTT broker as sole device edge; adapters per vendor | Accepted, P2 entry |
| ADR-006 | Modular monolith + event bus before any microservices | Accepted |
| ADR-007 | Translation via pluggable external provider, cached per message | Accepted, P1 |
| ADR-008 | Video as HLS + SVG overlays + timestamped comments | Accepted, P4 |
| ADR-009 | Issues = universal 7-stage workflow entity; tasks remain execution units | Accepted, P0 |
| ADR-010 | Vendor-neutral Hardware Abstraction Layer (HAL) — no vendor selected yet (owner, 2026-08-25) | Accepted, P2 entry |
| ADR-011 | Connectivity assumption: farm Wi-Fi + gateway with buffering; mobile devices use Wi-Fi/5G; loss is a first-class failure case | Accepted |
| ADR-012 | Feature entitlements driven by owner's subscription plan; translation providers tier-gated (both Google & DeepL adapters built) | Accepted, see SUBSCRIPTION_AND_PAYMENTS_DESIGN.md |
| ADR-013 | Card payments (Visa/MC) via gateway webhook confirmation + manual ledger stage 1; payouts manual-ledger-first | Accepted |
| ADR-014 | Greenhouse robot defined by OUR integration spec + conformance simulator (robot itself still in design phase) | Accepted, see ROBOT_INTEGRATION_SPEC.md |
| ADR-015 | Translation behind `TranslationProvider` interface; mock default (no key needed in dev); Google/DeepL HTTP adapters via env (`TRANSLATION_PROVIDER`, keys) | Implemented P1 (`src/chat.ts`) |
| ADR-016 | Mobile transport = polling-first with identical payloads to WS push; WS used for chat live updates; FCM lands later | Implemented P1 |
| ADR-017 | Physical actuation gets its OWN permission action: `valve.control` = moderator+ only (workers explicitly denied even as farm members) — discovered by smoke test, now matrix-tested | Implemented P2 (`src/authz.ts`) |
| ADR-018 | Generic list endpoints authenticate via `device.view` (any persona) then scope per-item handler-side through `hasFarmAccess()`; item reads by id return **404** (not 403) to outsiders so resource existence never leaks | Implemented P1–P7 routes |
| ADR-019 | Scheduled jobs (solar daily report, leak scan) are exposed as authenticated HTTP endpoints so any scheduler (cron/K8s job/Expo task) can trigger them without new infra | Implemented P2/P3 |
| ADR-020 | Learning cases freeze an ANONYMIZED snapshot at publish time; identity fields are omitted (not masked) — source changes can never leak into published cases | Implemented P7 (`src/community.ts`) |
| ADR-022 | Universal evidence capture (owner mandate): photo/video capture is available EVERYWHERE a case or message needs proof — chat composer (📷), issue reporting flow (create→upload→advance-to-inspected in one call), task evidence. Server owns storage + gates (`/v2/evidence`, `/v2/chat/:id/media`, `/v2/issues/:id/advance-with-evidence`); clients only orchestrate capture | Implemented P1+ (mobile ChatScreen 📷, IssueReportScreen, Node endpoints; Rust parity pending) |
| ADR-023 | Test strategy layers: unit fixtures (Node 57 / Rust 9 / client 2 / mobile 3) + HTTP route tests via `inject()` (no port binding; `NO_LISTEN=1`) + manual procedures T1–T12. Coverage measured via `vitest --coverage`; staged gates replace the hollow "100%" claim | Active — see TEST_COVERAGE_TRACEABILITY.md |
| ADR-024 | People directory is tenant-scoped by **farm co-membership** derived from `farm_members`, not by a denormalized tenant column. `admin` is exempt; out-of-tenant `/users/:id/stats` answers 404 so the endpoint cannot enumerate accounts (extends ADR-018 to the user resource) | Implemented (R16, both trails) |
| ADR-025 | **In-house i18n layer, no i18n library.** A ~150-line typed module per client provides catalogue lookup, `{{}}` interpolation, `Intl.PluralRules` selection and locale-pinned formatters. Rejected `react-i18next`/`i18n-js`: their value is the plugin ecosystem (backends, detectors, ICU parsing) we do not use, against a runtime and dependency-audit cost we do pay. The seam is a hook — swapping in a library later is a provider change, not a component rewrite | Accepted, P8 |
| ADR-026 | **One country-neutral `ar` catalogue**, not `ar-EG` + `ar-SA`. Regional variance in this product is *formatting*, which `Intl` derives from the device region; splitting the catalogue would double the translation surface for a handful of words and guarantee drift between the copies. Register is simplified MSA (LOCALIZATION_SPEC §1) | Accepted, P8 |
| ADR-027 | **All locales pin `-u-ca-gregory-nu-latn`.** `Intl` resolves `ar-SA` to the Umm al-Qura calendar and some Arabic locales to Arabic-Indic digits; farm operations, invoices, GPS and audit trails are Gregorian/Western-digit. A bare `toLocaleDateString('ar')` is therefore a defect, not a style choice | Accepted, P8 |
| ADR-028 | **RTL via CSS logical properties** (`margin-inline-*`, `text-align: start`), not a mirrored stylesheet. One stylesheet serves both directions; a duplicated RTL sheet drifts the first time someone edits only one copy. On mobile the equivalent is `I18nManager` + `textAlign:'start'`, with direction consumed from context rather than the mutable `I18nManager.isRTL` global | Accepted, P8 |
| ADR-029 | **API stays language-neutral.** Errors carry a machine-readable code + developer-facing English string; clients map status → localized copy and show raw server text only in dev builds. Keeps internal messages out of the product UI (a security property as much as a localization one) and avoids a second translation surface on the server | Accepted, P8 |
## 10.1 Implementation status map (as built)

| Module file | Implements | Key exports |
|---|---|---|
| `src/authz.ts` | G0.1/G0.1b RBAC matrix, persona union, `hasFarmAccess` | `can()`, `requirePermission()`, `buildActorContext()` |
| `src/issues.ts` | G0.2 7-stage engine + evidence gates + timeline | `advanceIssue()`, `STAGE_RULES` |
| `src/entitlements.ts` | ADR-012 plan gating → 402 upsell | `requireEntitlement(key, farmResolver?)` |
| `src/chat.ts` | F3 conversations/messages/pins/reactions, translation cache, providers | `sendMessage()`, `messageInLang()` |
| `src/agri.ts` | F1 water (tariffs/leaks/valves) · F2 solar dust · F5 trees identity/lifecycle | `computeCost()`, `detectNightFlowLeaks()`, `classifyDust()`, `resolveTree()` |
| `src/community.ts` | F4b video · F6 marketplace KYC/escrow split · F7 academy cases/quizzes | `chooseResponse()`, `gradeAttempt()`, `publishCaseFromIssue()` |
| `src/routes/features.ts` | Full /v2 feature surface + `/ws` push gateway | route registrations |
| `src/logger.ts` / mobile `services/logger.ts` | LOG_LEVEL/LOG_FORMAT control model | `makeLogger(scope)` |

Dev-seed fixtures embedded in `store.ts` (used by the test suite): night-flow leak on
`dev-meter-1`, dusty `panel-B`, GPS-tagged tree 0001 vs relative-code tree 0002.

## 10.2 Verification log

Every phase was verified by three layers before being called done:
1. **Unit/fixture tests** (`test/p0.test.ts`, `test/phases.test.ts`) — permission matrix,
   stage guards, tariff math, leak/dust heuristics, bounty splits, grading boundaries.
2. **Live curl smoke tests** against a booted server per phase — including NEGATIVE tests
   (worker→valve 403, outsider→tree 404, unverified expert→403).
3. **Typecheck** on both apps (`tsc --noEmit`).

**Coverage status & requirement traceability:** see `docs/TEST_COVERAGE_TRACEABILITY.md` —
the measured matrix (Node ≈63% stmts on domain code; Rust fixture tests; clients pending)
plus the full requirement → test-ID → manual-procedure traceability table and the staged
gap-closure plan. 100% coverage is NOT yet achieved; the doc states exactly where the gaps are.

Bugs caught by verification (kept as evidence the process works): admin bypass defeating
fail-closed; missing farm resolvers on issue/valve routes (IDOR-class); worker passing valve
RBAC via over-broad action → ADR-017; entitlement resolver gap on `:id` routes; Rust
create-issue returning without persisting.

---

## 11. RUST TRAIL (`webapp/server-rust`) — Full Parity Architecture

**Purpose (ADR-003):** the Rust server is an **exact behavioural copy of server-node** — same
routes, same JSON shapes, same status codes, same seed fixtures, same logging control model.
Run either one; clients switch by changing ONE base URL (`:8080` vs `:3000`). Its long-term
role remains the high-performance path (telemetry ingestion, video chunk processing).

### 11.1 Static architecture (component separation)

```
server-rust/src/
├── main.rs            Composition root: state, CORS, /uploads static, router, :8080 listener
├── types.rs           Wire-contract structs — serde camelCase mirrors types.ts EXACTLY
├── store.rs           In-memory Db + seed fixtures (mirror of store.ts; ADR-004 swap seam)
├── auth.rs            HMAC token issue/verify — byte-compatible token format with Node
├── authz.rs           Permission matrix + persona union + valve.control (mirror of authz.ts)
├── issues.rs          7-stage machine with evidence gates (mirror of issues.ts)
├── agri.rs            Water/solar/trees pure domain fns + fixture tests (mirror of agri.ts)
├── community.rs       Marketplace split/grading fns + fixture tests (mirror of community.ts)
├── logger.rs          LOG_LEVEL/LOG_FORMAT control (dev/json/off) — mirror of logger.ts
├── util.rs            now_ms() shared time helper
└── routes/
    ├── mod.rs         Legacy core handlers + guard/entitlement helpers + router assembly
    ├── v2core.rs      P0 surface: issues/personas/plans/subscriptions/audit   [include!]
    └── features.rs    P1–P7 surface + /ws push gateway                        [include!]
```

### 11.2 Dynamic analysis (runtime behaviour)

| Flow | Behaviour |
|---|---|
| Request lifecycle | Bearer token → `auth::verify` (HMAC-SHA256, constant-time) → `build_actor_context` (persona union from `users.role` + active `user_personas`) → `can()` matrix → handler → domain fn → JSON |
| Concurrency | Single `Mutex<Db>`; guards never held across `.await` (MutexGuard is !Send — enforced by the compiler). Mirrors Node's single-threaded mutation semantics |
| Stage transitions | Read-phase validates (closed-immutable, single-forward-step, persona gate, evidence gates), then write-phase mutates + appends timeline event |
| WS push | `/ws?token=` upgrade → per-user mpsc queues in a global registry; `send_msg` pushes to every OTHER member; clients may fall back to REST polling |
| Telemetry ingest | HTTP backfill endpoint stands in for the MQTT bridge until P2 broker deployment; buffer bounded at 50k readings (TimescaleDB in production) |

### 11.3 Parity contract & verified equivalence

Verified live against the SAME smoke scripts used for Node:

| Check | Node result | Rust result |
|---|---|---|
| Water summary 24h (seed fixture) | 138 m³ / 74 lpm / 402 EGP | identical |
| Solar daily job (dusty panel-B) | flagged=1, cleaning=1 | identical |
| Valve by worker | 403 Forbidden | 403 Forbidden |
| Stage advance w/o evidence | 400 missing_requirement | 400 |
| Stage advance w/ evidence | 200 inspected | 200 inspected |
| Worker→identify | 403 forbidden | 403 forbidden |
| Audit by worker | 403 | 403 |
| Chat translate round-trip | cached mock translation | identical |

Documented divergences (deliberate, client-invisible):
1. Leak-scan idle window uses **UTC hours** (Node uses server-local time).
2. Google OAuth exchange returns **501** on Rust (identity-provider SDK is Node-only for now).
3. Translation provider adapter = mock pass-through (env-based Google/DeepL HTTP adapters land behind the same seam).
4. Tree GPS proximity resolution degrades gracefully until Postgres gives typed geo columns.

### 11.4 Rust toolchain notes

- Tests: `cargo test` (6 fixture tests mirror the Node numbers exactly).
- Deps kept minimal: axum(+multipart,ws), tokio, serde, hmac/sha2/base64, uuid, tower-http(cors,fs), futures-util.
- Logging scopes identical to Node (`boot/http/authz/issues/chat/agri/community/v2/features`) so
  one dashboard query pattern covers either server.

### 11.5 Can you build MOBILE APPS in Rust?

**Short answer: not the UI, and you shouldn't here.** Rust has no mainstream native-UI story
comparable to SwiftUI/React Native; options exist (Tauri Mobile, Dioxus, Slint, egui) but they
are immature for production mobile apps, fight platform conventions, and none matches Expo's
OTA updates or the team's existing RN investment (see TECH_COMPARISON_STUDY §A).

Where Rust DOES belong on mobile: **shared core logic compiled as a library via FFI**
(UniFFI generates Kotlin/Swift bindings) — e.g., the leak-detection math running on-device, or
offline sync engines. Recommendation: keep React Native for all FarmMarshal UI; consider a Rust
FFI module ONLY if on-device computation ever becomes a bottleneck.

## 10. Hardware Abstraction Layer (HAL) — vendor-neutral device design

No water/solar vendor has been chosen yet. Therefore the platform normalizes everything to an
**internal canonical model**, and each vendor becomes a thin adapter. Choosing a vendor later
touches one adapter file + config, never clients or schema.

```ts
// Canonical reading — what the platform stores regardless of vendor
interface CanonicalReading {
  deviceId: string; ts: Date;
  metrics: Record<string, number>;  // e.g. {m3_cumulative, flow_lpm} | {kwh_total, kw_now}
}

interface DeviceAdapter {
  readonly protocol: 'mqtt_native' | 'modbus_tcp' | 'modbus_rtu_via_gateway' | 'lorawan' | 'pulse';
  parse(raw: Buffer | object, ctx: DeviceContext): CanonicalReading[];   // ingest side
  buildCommand?(cmd: ValveCommand): {topic: string; payload: Buffer};    // control side (valves)
  healthCheck(meta: DeviceContext): 'online' | 'stale' | 'offline';
}
```

Design-decision rationale (documented per owner request):
- **Pulse-output water meters** (e.g., common Zenner/GWF-class meters): cheapest hardware, so the
  gateway firmware counts pulses and publishes MQTT JSON → adapter `lorawan`/`mqtt_native` trivial.
  Decision biased toward this class for pilot simplicity.
- **Modbus RTU/TCP devices** (typical for inverters like GoodWe/Growatt/SMA-class and industrial
  flow meters): never exposed raw to the platform; a small gateway agent translates Modbus→MQTT,
  because Modbus has no auth/TLS of its own. Decision made for security isolation.
- **Valve actuators:** spec requires any relay controller that accepts a simple open/close payload
  and returns an ack — MQTT-native controllers preferred over HTTP-only ones (offline queuing).
  If a chosen vendor is HTTP-only, its adapter wraps HTTP behind `buildCommand`.
- **LoRaWAN option** kept open via The Things Network-style integration for large farms where
  Wi-Fi coverage is uneconomical — same canonical model, different transport adapter.

### Connectivity assumptions (ADR-011)
- Farms: **Wi-Fi + local gateway**. The gateway buffers readings during outages (configurable
  hours of retention) and backfills on reconnect — outage handling is treated as a *normal*
  scenario, not an edge case, and every phase's tests include an outage replay.
- Mobile devices (workers/moderators/experts): assumed to have **Wi-Fi or 5G**; the app keeps an
  offline outbox (chat messages, evidence uploads) that drains on reconnection.

### Schema additions (subscriptions/payments — full design in SUBSCRIPTION_AND_PAYMENTS_DESIGN.md)

```sql
plans(id, code UNIQUE, name, monthly_egp, metadata JSONB);
plan_features(plan_id, feature_key, enabled, limits JSONB);   -- gates translation provider tier,
                                                              -- IoT modules, video quota, marketplace
subscriptions(id, farm_id, plan_id, status, period_start, period_end, auto_renew);
payments(id, payer_user_id, subscription_id?, amount, method ENUM('manual','visa','mastercard'),
         gateway_ref, bank_confirmed_at?, status, created_at);
```

Robot integration contract lives in `docs/ROBOT_INTEGRATION_SPEC.md` (MQTT control plane + tus
upload + manifest + conformance simulator).
