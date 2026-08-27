# AgriTasks v2 — Requirements Analysis & Feature Decomposition

**Version:** 1.0 · **Date:** 2026-08-25 · **Status:** PLANNING (no implementation yet)

> Every requirement below is decomposed into: scope, user stories, data needs,
> dependencies, risks, and the workflow states it introduces. Nothing here is implemented;
> this document feeds `ARCHITECTURE_EVOLUTION_PLAN.md` (how) and
> `IMPLEMENTATION_PLAN_AND_TESTS.md` (when + how verified).

---

## Global Requirement G0 — Roles, Visibility & the Universal Issue Workflow

### G0.1 Role model expansion

Current roles: `worker`, `moderator/manager`, `owner`. New model:

| Role | Visibility | Powers |
|---|---|---|
| `admin` | EVERYTHING, all farms, all users | Full privilege: CRUD on any entity, user/farm/device management, config, feature flags |
| `owner` | His farms only | Everything admin can do *on his farms* except platform administration |
| `agri_expert` (NEW) | Farms he serves (+ crowdsourcing requests) | Video review/annotation, chat consultations, recommendations, farm schedules/events |
| `accountant` (optional) | Finances of his farms only | Ledger read, CSV export |
| `moderator` | His farm(s) | Create tasks, review evidence, rate workers |
| `worker` | Tasks/comments assigned to him only | Execute tasks, evidence, chat |

**Enforcement rule:** every list endpoint filters server-side by role+farm membership.
Client hiding is cosmetic only. A single `permissions` matrix lives in one module so it is testable.

### G0.1b Multi-persona identity model (added after owner review)

**Distribution:** there is exactly ONE downloadable app (App Store / Play Store) serving every
persona — same binary already branches UI on role today (Expo EAS also allows instant OTA updates,
so no store waits when personas evolve). What changes is the identity model:

- **Identity ≠ persona.** `users` row = authentication identity (login, locale, avatar).
  `user_personas(user_id, persona, status)` = what that person IS allowed to be. A person may hold
  **several personas at once**, e.g.:
  - moderator on Farm A **+** verified global crowdsourced expert (earns money, F6a) **+**
    learner taking exams (F7);
  - university professor = academic expert (verified, F7b) **+** crowdsourced expert **+** learner.
- **In-app persona switcher**: user picks the active persona; navigation/UI adapts. Permissions
  are evaluated as the UNION of all active-status personas, but every audit-log entry records
  WHICH persona performed an action (matters for marketplace payouts vs farm duties).
- **Entry paths per persona:**

| Persona | How obtained |
|---|---|
| worker / moderator / owner | invited/provisioned by the farm's owner or admin |
| agri_expert (farm-serving) | assigned by owner/admin |
| learner | **open self-registration** from the app's welcome screen |
| crowdsourced expert | F6a application + credential verification |
| academic expert | F6a variant verified via institution (staff ID / institutional email / degree) |
| accountant, admin | provisioned by owner / platform respectively |

- Registration UX (non-tech rule): welcome screen shows big picture cards ("I work on a farm" /
  "I own land" / "I want to learn" / "I'm an expert") — each card drives the correct minimal form;
  everything else is handled later inside the app.

### G0.2 Universal Activity Workflow ("the 7 stages")

You specified a lifecycle for water/solar issues that must generalize to ALL farm activities:

```
DETECTED → INSPECTED → IDENTIFIED → RECOMMENDED → IMPLEMENTED → REVIEWED(+evidence) → CLOSED
```

Design: an `issues` entity with a `stage` state machine + required-evidence gate per stage:

| Stage | Who acts | Required artifact to advance |
|---|---|---|
| DETECTED | system (sensor rule) or human report | auto-recorded source event or report text/photo |
| INSPECTED | worker/moderator | inspection note + photo(s) + GPS |
| IDENTIFIED | moderator/expert | root-cause category from taxonomy |
| RECOMMENDED | expert/moderator | recommendation text (may create a task) |
| IMPLEMENTED | worker | linked task reaches `submitted` |
| REVIEWED | moderator/expert | before/after evidence approved |
| CLOSED | moderator/owner/admin | closure note; metrics frozen |

The existing task state machine (`assigned→in_progress→submitted→approved`) remains untouched;
`issues` reference tasks where work is needed. One engine, many issue *kinds* (water, solar,
pest, equipment…), so future kinds plug in without schema changes (`kind`, `metadata JSONB`).

---

## F1 — Water Monitoring & Control (IoT)

**Goal:** measure consumption per farm/sector, open/close valves remotely, estimate water cost,
detect leaks, raise issues automatically.

### Decomposition
1. **Device layer:** water meters (pulse/Modbus/LoRaWAN/MQTT), electric valves (relay controllers).
   Gateway pattern: devices → local gateway/Raspberry Pi or LoRaWAN network server → MQTT broker → API ingestion service. Devices never talk HTTP directly.
2. **Telemetry ingestion:** readings `{deviceId, ts, m3_cumulative, flow_lpm, pressure?}` → time-series store (TimescaleDB recommended — Postgres extension, keeps ONE database).
3. **Control plane:** `POST /devices/:id/valve {action:open|close}` → command topic → device acks; command audit trail (who/when/why) is mandatory. Safety interlocks: valve commands require role ≥ moderator; emergency shutoff allowed for admin+auto-rules.
4. **Cost estimation:** tariff table per farm (tiered EGP/m³) → cost computed at aggregation time, not stored raw forever.
5. **Leak detection (rule engine v1):**
   - continuous night flow (flow > 0 for > N minutes during configured idle window),
   - flow vs. historical baseline deviation (z-score),
   - pressure drop correlation (if sensors exist).
   Each trigger → creates `issue(kind=leak_suspect, stage=DETECTED)` and notifies moderator/owner.
6. **Dashboards:** per-farm live consumption, daily/weekly/monthly/yearly charts, cost rollups, valve status board, leak issue queue using the G0.2 workflow.

### Risks
- Hardware variability → abstract behind `device adapter` interface; pilot with ONE vendor.
- Connectivity loss in fields → device buffers readings, gateway retries; API must accept backfills.
- Security: forged telemetry → per-device secret/token; signed payloads.

## F2 — Solar Monitoring + Dust Detection

**Goal:** same monitor/control concept as F1 plus per-panel energy reporting, dusty-panel
detection, cleaning requests, weather context, and periodic reports with history.

### Decomposition
1. **Devices:** string inverters / panel-level optimizers / smart combiner boxes publishing via MQTT (most inverters have Modbus-TCP → gateway translates).
2. **Per-panel daily report job:** nightly batch computes per-panel `energy_kwh`, expected output from:
   - irradiance estimate (weather API: cloud cover, temp),
   - sibling-panel comparison (same string/orientation),
   - own 30-day baseline.
3. **Dust classification logic (staged intelligence):**
   - v1 statistical: panel underperforms siblings by > X% while irradiance is normal AND weather ≠ cloudy → flag `dusty_suspect`.
   - v2 CV: greenhouse robot / drone / manual photo of panels → Python microservice (YOLO-classifier) scores dust visually.
4. **Cleaning request automation:** confirmed dusty panel(s) → `issue(kind=panel_cleaning, stage=RECOMMENDED)` pre-filled with panel IDs + evidence chart; moderator converts to task assigned to a worker (existing task machine!).
5. **Weather integration:** cache daily/hourly weather per farm (OpenWeather/Visual Crossing) so reports can explain "cloudy day" dips; also reused by irrigation recommendations later.
6. **Reports:** daily/weekly/monthly/yearly per farm and per panel-string; every report version is retained (history requirement) → materialized summary tables, immutable once period closes.

### Risks
- Panel-level metering may not exist on older installs → design degrades gracefully to string-level.
- Weather API cost/rate limits → cache + one call per farm per hour.

## F3 — Worker ↔ Agri-Expert Chat (rich, translated)

### Decomposition
1. **Conversations:** any-to-any DM; expert inbox groups threads by **farm → area → worker → crop expertise tag** so he instantly knows context. Thread header shows farm name, sector/GPS pin, worker profile.
2. **Message types:** text, photo, video (compressed, size-capped), voice note, emoji/reactions, pinned messages (per conversation, ordered).
3. **Translation (100%-understood guarantee):**
   - sender writes in his language; message stored as original;
   - receiver sees his language via inline translation (provider: DeepL/Google/OpenAI — abstracted behind a `translationProvider` interface);
   - each message keeps `originalText`, `originalLang`, `translations{lang:text}` cached;
   - long-press → "show original" toggle; auto-detect language;
   - voice notes: speech-to-text → translate → show transcript (v2 stretch).
4. **Transport:** WebSocket with Firebase-FCM push fallback when app backgrounded (upgrades current local-notification-only approach).
5. **Offline:** outbox queue on mobile; idempotent message IDs.

### Risks
- Translation quality for agricultural dialect terms → allow user-corrected translations saved to cache (improves over time).
- Media storage costs → compression client-side + S3 lifecycle rules.

## F4 — Extensibility Foundation ("dynamic system") + Greenhouse Robot Video

### F4a Platform extensibility (prerequisite for everything)
- **PostgreSQL migration** (from in-memory) with JSONB metadata columns on core entities → new features add fields without breaking migrations.
- **Modular monolith:** features as self-contained modules (`modules/water`, `modules/chat`, …) communicating via in-process **event bus**; extracting any module to a service later must not require client changes.
- **Plugin registration:** new device kinds, issue kinds, report types register adapters against interfaces.
- **API versioning** (`/v2/...`), OpenAPI contract-first; **feature flags** per farm.

### F4b Robot video pipeline
1. Robot (or any camera source) uploads video chunks after a mission → ingestion endpoint → ffmpeg pipeline: normalize → HLS segments (enables frame-accurate seeking) → storyboard thumbnails → S3.
2. **Scheduling:** expert views/creates missions per farm schedule (`events`: robot route, area, recurrence); on completion, expert is notified "new video ready for [area]".
3. **Timestamped comments:** comment anchored at `(videoId, seconds)`; clicking jumps playback.
4. **Scene linking:** comments attach to detected scene boundaries or manual in/out points.
5. **Annotation overlay:** expert draws on a paused frame (shapes/text) → stored as SVG overlay keyed to timestamp; replayable list "all annotations in this video".

### Risks
- Upload reliability from field Wi-Fi → resumable uploads (tus protocol).
- Storage growth → retention policy per farm tier.

## F5 — Per-Tree Registry & Lifecycle

- Entity `trees{id, farmId, sector, gps, species, plantedAt, variety, photos[]}`.
- **Tree identity guarantee (strengthened after owner review):** a tree's identity never depends
  on GPS alone. Layered identification:
  1. **QR tag = primary key**, physically attached to the tree at registration (weather-proof
     print sheet generated by webapp); scanning it is always authoritative.
  2. **GPS + accuracy captured at registration** (phone reading includes `accuracy_m`);
     if accuracy > threshold (e.g., 10 m under canopy), the app walks the worker through
     **relative positioning**: "3rd tree from the corner post, row 12" style sector/row/position
     code stored alongside GPS.
  3. Every reference to a tree — tasks, issues, photos (R1 geo-evidence), harvests, expert video
     annotations — carries `treeId`, so history aggregation never relies on fuzzy location.
- **History per tree:** linked issues, treatments, harvest records, photos, AND video annotations
  made by experts while reviewing robot/human footage (`video_annotations.tree_id` → appears in
  the tree timeline with a jump-to-timestamp link).
- **Lifecycle estimation:** species table holds expected productive lifespan; system computes age vs. lifespan → statuses: `productive / aging / end_of_life_recommended`; low-yield trends accelerate recommendation. Expert confirms → tree marked for removal (never hard-deleted; archived for history).
- Mobile: scan/QR tag on tree → opens its timeline (simple for non-tech users).

## F6 — Crowdsourced Agri-Expert Marketplace ("Uber for agri-experts")

### F6a Expert onboarding, verification & reputation (added after owner review)

- **Registration funnel (Uber-style driver signup):** sign-up (mobile/web) → profile
  (photo, languages, country, specializations/crops, years of experience) → upload credentials
  (degree, professional license, certificates) → verification → active status.
- **Credential verification workflow:** automated checks (file validity, expiry dates) followed by
  an **admin human-review queue**; states `pending → verified | rejected(reason)`; verified badge
  displayed on the expert's public card; re-verification required when documents expire.
  Only `verified` experts can answer paid consultations.
- **Commission model:** platform takes a configurable % of each accepted bounty
  (Uber-style split); remainder credited to the expert's payout ledger. Rates may vary per plan/market.
- **History & reputation:** lifetime profile = answers count, avg stars (reuses `/ratings`),
  acceptance rate, total earned, dispute count; visible to requesters before choosing.
  Admin can suspend/deactivate an expert for low ratings or unresolved disputes (Uber-style).
- **Payments:** requester pays bounty up-front into escrow (manual record first, card rail later);
  on acceptance, split executes: commission → platform revenue, net → expert payout ledger
  (SUBSCRIPTION_AND_PAYMENTS_DESIGN §4).

### F6b Consultation lifecycle & communication (added after owner review)

- Requester = the farm-side main expert/moderator/owner posts a consultation
  (photos/video/question/bounty; scope `public` worldwide or `targeted`).
- Responders submit answers/advice with supporting media; requester chooses the winning answer.
- **Chat wiring (uses F3 engine):**
  - accepting a response auto-creates a **1:1 conversation** between requester and that responder,
    linked to the consultation (full features: translation, photos, voice notes);
  - while the request is open/public, a **group conversation** exists with requester + all
    responders for open discussion; when the requester narrows to finalists, others become
    read-only;
  - the consultation page embeds its thread(s); messages inherit consultation context header
    (farm, crop, question) so any party knows exactly what is being discussed.
- Moderation: spam filter, min-rating threshold to answer, dispute flag → admin resolution.
- i18n: requests carry language; translation provider (F3) makes cross-border Q&A fully understood.

## F7 — Learner Academy & Academic Experts (added after owner review)

### F7a Learner persona (university students / trainees)

- **Open self-registration** as learner; learners see ONLY the published case library — never live
  farm operational data (hard privacy boundary, server-enforced).
- **Case library:** closed/approved issues and settled consultations are auto-offered for
  publication as learning cases (publisher can anonymize farm/worker names). A case shows the
  full 7-stage chain exactly as experts worked it: problem statement → inspection notes/photos →
  expert **classification & identification** → recommended solution → implementation evidence
  (before/after) → review outcome. Learners thus learn from real expert reasoning, not theory.
- **Exams:** quizzes authored by verified experts/academics:
  - question types: MCQ, true/false, and **photo-diagnosis** ("identify the problem from this
    field evidence") reusing case media;
  - attempts are scored server-side (answer keys never sent to client); pass threshold per exam;
  - results accumulate on the learner profile; certificate generation is a later stretch goal.
- Learners may later convert to worker/expert personas through normal entry paths — learning
  pipeline feeds the labor market (owner's ecosystem vision).

### F7b Academic agriculture experts (university staff)

- New `academic_expert` persona: carries institution, academic title, years of experience,
  optional publications; verification via institutional email/staff ID inside the F6a review queue.
- Privileges: author/edit exams, review & endorse case classifications in the library, act as
  crowdsourced experts globally (earning like F6a), badge shown as "Academic Expert · N yrs".
- Universities themselves may subscribe (plan-gated) so their students get the academy module.

## Usability Rule (applies to ALL above)

- Arabic-first UI with RTL, large touch targets, icon-driven navigation, minimal text entry,
  voice notes preferred over typing where possible, offline-tolerant flows, and every new screen
  validated in UAT sessions with actual field workers before release (see test plan §UAT).

---

## Traceability index

| Req ID | Summary | Depends on | Phase |
|---|---|---|---|
| G0.1 | Admin role + RBAC everywhere | Postgres migration | P0 |
| G0.2 | Universal 7-stage issue workflow | G0.1 | P0 |
| F1 | Water IoT monitoring/control/leaks/cost | G0.2, MQTT infra | P2 |
| F2 | Solar + dust detection + weather + reports | F1 infra | P3 |
| F3 | Chat + translation + rich messages | WS infra, S3 | P1 |
| F4a | Extensibility foundation | Postgres migration | P0 |
| F4b | Robot video + annotations | F4a, S3/HLS | P4 |
| F5 | Tree registry/lifecycle | G0.2, R1 evidence | P5 |
| F6 | Expert crowdsourcing marketplace | F3, ratings | P6 |
| G0.1b | Multi-persona identity (one app binary, in-app switching) | — | P0 |
| F7 | Learner Academy (case library + exams) & Academic experts | G0.1b, G0.2 closed cases | P7 |
