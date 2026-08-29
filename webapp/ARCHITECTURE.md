# FarmMarshal WebApp — Complete Architecture Document

> ⚠️ **SUPERSEDED SECTIONS NOTICE (2026-08-25):** the Roles table in §1 below reflects the
> ORIGINAL v1 model. The AUTHORITATIVE role/persona model (admin, learner, crowd_expert,
> academic_expert, accountant, agri_expert + farm-scoped v1 roles) lives in
> **`docs/REQUIREMENTS.md` §R1** and `docs/ARCHITECTURE_EVOLUTION_PLAN.md` §G0.1b.
> This document is retained for the legacy REST contract history; all NEW work must
> follow REQUIREMENTS.md as the single source of truth.

> 📦 **Offline demo build:** the client can be built with `VITE_DEMO_MODE=1`, which
> replaces every call described below with a recorded fixture so the app runs with
> **no backend at all** (used for the GitHub Pages stakeholder demo). If you change
> a response shape in this contract, the fixture must be re-recorded — see
> **`docs/STATIC_DEMO_DEPLOYMENT.md`**.

**FarmMarshal WebApp** is the land-owner's control tower: a web dashboard where the
**Land Owner** monitors every problem, solution, and activity happening on his land,
and **evaluates** (rates) both his moderators and workers. The same REST API also
serves the mobile app, making this server the single source of truth.

---

## 1. Roles & Permissions Model

| Role | Who | Capabilities |
|---|---|---|
| `owner` | Land owner | Sees EVERYTHING: all lands, tasks (problems/activities), solutions, comments. Rates **moderators AND workers**. Creates moderator accounts conceptually. |
| `moderator` | Field manager (= "manager" in the mobile app) | Creates tasks, reviews worker evidence, approves/rejects. Rates **workers**. Comments on any task. |
| `worker` | Field worker | Executes tasks, uploads before/after evidence. Comments on own tasks. Cannot rate anyone. |

Rating matrix (who can rate whom):

```
owner    ──rates──► moderator   ✓
owner    ──rates──► worker      ✓
moderator──rates──► worker      ✓
worker   ──rates──► anyone      ✗
```

A rating = 1–5 stars + optional written comment. Ratings are immutable once
submitted (edit = delete + re-create, keeping an audit trail).

## 2. High-Level System Topology

```
┌────────────────────┐        ┌───────────────────────────┐
│  React SPA (Vite)  │        │   Mobile apps (iOS/Android)│
│  Owner / Moderator │        │   Worker & Moderator       │
│  browser client    │        │   (Expo — migrates from    │
│                    │        │    direct-Firebase to API) │
└─────────┬──────────┘        └────────────┬──────────────┘
          │ HTTPS / JSON REST              │ HTTPS / JSON REST
          ▼                                ▼
┌────────────────────────────────────────────────────────────┐
│                FarmMarshal REST API (this repo)             │
│                                                            │
│   Trail-1: Rust + Axum        Trail-2: Node.js + Fastify   │
│   server-rust/ :8080          server-node/ :3000           │
│   (identical REST contract)   (identical REST contract)    │
└─────────┬────────────────────────────────────────────────── ┘
          │ repository layer (swappable)
          ▼
┌────────────────────┐   ┌──────────────────────┐
│ In-memory store    │   │ Static file storage  │
│ (dev) → PostgreSQL │   │ /uploads for audio    │
│ (production path)  │   │ comment files         │
└────────────────────┘   └──────────────────────┘
```

**Two trails, one contract:** `openapi.yaml`-style contract documented in §6.
Both servers implement it; pick one per environment without touching clients.

---

## 3. Static Architecture

### 3.1 Repository layout

```
webapp/
├── ARCHITECTURE.md          ← this document
├── server-node/             ← TRAIL-2 (recommended, fully implemented)
│   ├── src/
│   │   ├── index.ts         # composition root: Fastify app + routes + static
│   │   ├── types.ts         # domain model shared by all layers
│   │   ├── store.ts         # REPOSITORY layer (in-memory; swap for Postgres)
│   │   ├── auth.ts          # token issue/verify (signed HMAC tokens)
│   │   └── routes/
│   │       ├── auth.ts      # POST /auth/login, POST /auth/register
│   │       ├── users.ts     # GET /users, GET /users/:id/stats
│   │       ├── tasks.ts     # CRUD + lifecycle transitions
│   │       ├── comments.ts  # text comments + audio upload/list
│   │       └── ratings.ts   # submit/list ratings with role enforcement
│   └── package.json
├── server-rust/             ← TRAIL-1 (Rust + Axum, same endpoints)
│   ├── src/main.rs          # router + handlers + in-memory state
│   └── Cargo.toml
└── client/                  ← React 18 + Vite + TypeScript SPA
    └── src/
        ├── main.tsx         # entry, router mount
        ├── App.tsx          # layout + route guard by role + locale switcher
        ├── api.ts           # typed HTTP client (fetch wrapper)
        ├── auth.tsx         # AuthContext: session in localStorage
        ├── i18n/            # LOCALIZATION LAYER (see §11)
        │   ├── index.tsx    #   LocaleProvider, useI18n(), t(), dir, formatters
        │   ├── en.ts        #   English catalogue (reference key set)
        │   └── ar.ts        #   Arabic catalogue (default locale)
        ├── pages/
        │   ├── Login.tsx            # role-aware sign-in
        │   ├── Dashboard.tsx        # owner overview: problems/solutions/activities KPIs
        │   ├── TaskList.tsx         # filterable table of all tasks
        │   ├── TaskDetail.tsx       # evidence photos + comments + audio + ratings
        │   ├── TaskReport.tsx       # per-task audit report: people/milestones/issue/comments
        │   ├── Farms.tsx            # farm portfolio with issue buckets
        │   ├── FarmDetail.tsx       # one farm: issues by stage + event timelines
        │   ├── Finance.tsx          # ledger + category KPIs + CSV export
        │   ├── ExpertNetwork.tsx    # F6 directory, consultations, escrow actions
        │   └── Evaluations.tsx      # people directory with avg ratings; rate modal
        └── styles.css               # logical-property layout (direction-agnostic)
```

### 3.2 Layers (both trails share this shape)

| Layer | Node trail | Rust trail | Responsibility |
|---|---|---|---|
| HTTP/transport | Fastify route handlers | Axum handlers | Parse requests, validate, serialize |
| Application logic | inline in handlers | inline in handlers | Role checks, state-machine guards |
| Domain model | `types.ts` | `main.rs` structs | Task/User/Rating/Comment shapes |
| Persistence | `store.ts` (Repository trait-equivalent) | `State(Mutex<Db>)` | Data access behind an interface |
| Cross-cutting | `auth.ts` (HMAC tokens) | `auth.rs` helpers | Authentication |

### 3.3 Client component tree

```
App
├── AuthProvider                    (session context, localStorage-backed)
├── LocaleProvider                  (locale + dir; sets <html lang/dir>)
└── Layout (sidebar: Dashboard | Tasks | Farms | Finance | Experts | Evaluations)
    ├── /login          → Login                       [public]
    ├── /dashboard      → Dashboard                   [owner]
    ├── /tasks          → TaskList                    [owner+moderator]
    ├── /tasks/:id      → TaskDetail                  [all roles; permissions vary]
    │     ├── EvidencePanel (before/after photos)
    │     ├── CommentThread (text + audio player, recorder)
    │     └── RatingWidget   (visible per §1 matrix)
    ├── /tasks/:id/report → TaskReport                [owner+moderator]
    ├── /farms          → Farms (portfolio)           [owner+moderator]
    ├── /farms/:id      → FarmDetail                  [owner+moderator]
    ├── /finance        → Finance                     [owner+accountant]
    ├── /experts        → ExpertNetwork               [all roles]
    └── /evaluations    → Evaluations (people + stars + rate button) [owner+moderator]
```

## 4. Dynamic Architecture (key flows)

### 4.1 Authentication
```
POST /auth/login {email,password} → verify (demo: seeded users; prod: bcrypt)
                                  → return {token, user}
token = base64(userId.role.expiry).hmacSha256(SECRET)   # stateless
Every subsequent request: Authorization: Bearer <token>
```

### 4.2 Task lifecycle (mirrors mobile app exactly)
```
assigned → in_progress → submitted → approved
                          └→ rejected ─┘ (loop back to in_progress)
Transitions via PATCH /tasks/:id/status with server-side role guards:
  start            : assigned→in_progress      (worker)
  submitAfterPhoto : in_progress→submitted     (worker)
  review           : submitted→approved/rejected (moderator or owner)
```

### 4.3 Commenting (text + audio)
```
POST /tasks/:id/comments {text}                     # instant text comment
POST /tasks/:id/comments/audio (multipart audio/*)  # recorded voice note
   → file saved to /uploads/{uuid}.webm → returns comment with audioUrl
GET  /tasks/:id/comments                            # thread, oldest first
Audio playback client-side: native <audio controls src=audioUrl>
Recording client-side: MediaRecorder API (browser-native, no deps)
```

### 4.4 Rating flow
```
POST /ratings {rateeId, stars(1..5), comment?}
  guard: rater.role==owner && ratee.role∈{moderator,worker}
      OR rater.role==moderator && ratee.role==worker
GET /users/:id/stats → averageStars, count, recent ratings (Evaluations page)
```

## 5. Data Architecture

### 5.1 Entities

```
users:   id, name, email, role(owner|moderator|worker), createdAt
tasks:   id, title, description(problem statement), lat, lng,
         status, assigneeId(moderator who created), workerId,
         beforePhotoUrl?, afterPhotoUrl?, reviewNote?,
         createdAt, startedAt?, submittedAt?, reviewedAt?
comments:id, taskId, authorId, authorName, authorRole,
         text?, audioUrl?, createdAt
ratings: id, raterId, rateeId, stars(1-5), comment?, createdAt
```

### 5.2 Concept mapping (owner vocabulary → system entities)

| Owner asks… | System answer |
|---|---|
| "What problems exist on my land?" | open/rejected `tasks` (title+description) |
| "What solutions were applied?" | `approved` tasks + their after-photo evidence |
| "What activity is ongoing?" | `in_progress`/`submitted` tasks |
| "How good is moderator X?" | avg of `ratings` where ratee=X |
| "How good is worker Y?" | avg of `ratings` where ratee=Y (+ task success rate) |

### 5.3 Financial tracking module

A double-entry-lite ledger attached to lands/tasks:

```
finances: id, type('expense'|'income'), category(seeds|fertilizer|labor|fuel|
          equipment|harvest_sale|other), amount(number, always positive),
          currency('EGP'), taskId?, landSector?,
          note, receiptPhotoUrl?,   ← photo of paper receipt (mobile camera)
          createdById, createdAt
```

- **Mobile**: worker/moderator logs an expense at the field with a receipt photo.
- **Web**: owner gets Dashboard KPI cards (total spend by category, monthly trend)
  plus a filterable Finance table; export CSV endpoint for accountants.
- Ratings on mobile: Phase 2 addition — after a task is `approved`, the review
  screen gains "Rate worker ⭐" which POSTs to the same /ratings API.

### 5.4 Production persistence path
In-memory store implements a narrow repository interface (`list/get/insert/update`).
Swap to PostgreSQL by re-implementing `store.ts` (Node: `pg` / Rust: `sqlx`) —
no handler changes required. Audio files move to S3-compatible object storage.

## 6. REST Contract (implemented by BOTH trails)

```
POST /auth/login                {email,password} → {token,user}
GET  /users                                       → User[] (TENANT-SCOPED, see §7.1)
GET  /users/:id/stats                             → {avgStars,count,recent[]}

GET  /tasks?status=&workerId=                     → Task[]
GET  /tasks/:id                                   → Task
POST /tasks                                      → Task   [moderator|owner]
PATCH /tasks/:id/status {action:start|submit|approve|reject, note?} → Task
GET  /tasks/:id/report                           → {task,farm,reporter,assignee,worker,
                                                    issue,issueEvents,comments,milestones}

GET  /tasks/:id/comments                         → Comment[]
POST /tasks/:id/comments {text}                  → Comment
POST /tasks/:id/comments/audio (multipart file)  → Comment

POST /ratings {rateeId,stars,comment?}           → Rating
GET  /ratings?rateeId=                           → Rating[]

GET  /finances?type=&category=                   → Finance[]   [owner sees all]
POST /finances (multipart: fields + optional receipt photo) → Finance
GET  /finances/summary                           → KPI totals per category

v2 surface (excerpt — full list in EVOLUTION_PLAN §8):
GET  /v2/farms                                   → Farm[]
GET  /v2/issues?farmId=                          → Issue[]
GET  /v2/issues/:id/events                       → IssueEvent[]
GET  /v2/experts                                 → ExpertProfile[] (verified only)
GET  /v2/experts/me                              → ExpertProfile | null
POST /v2/consultations                           → Consultation
GET  /v2/consultations                           → Consultation[] (visible pool)
GET  /v2/consultations/:id                       → {consultation,responses,
                                                    isRequester,canRespond}
POST /v2/consultations/:id/responses             → ConsultationResponse
PATCH /v2/consultations/:id/choose               → {netPayoutEgp}

Static: GET /uploads/*  (audio + receipt files)
CORS: enabled for dev origins; JWT-style Bearer auth everywhere else.
Clients send Accept-Language; error bodies stay language-neutral (see §11.4).
```

## 7. Security
- Stateless signed tokens (HMAC-SHA256); expiry enforced server-side.
- Role guards live SERVER-side on every mutating endpoint (client hiding ≠ security).
- Upload validation: content-type must start with `audio/`; size capped.
- Passwords: demo store uses plaintext seed values; production swaps to bcrypt
  (`argon2` in Rust) at the same seam (`store.verifyPassword`).
- CORS restricted to known origins in production config.

### 7.1 Tenant scoping of the people directory (R16)

`GET /users` and `GET /users/:id/stats` are filtered to the caller's tenant:

```
visibleUserIds(caller) = { caller } ∪ { u : ∃ farm f, member(caller,f) ∧ member(u,f) }
```

- Derived from `farm_members`, so it follows invitations automatically — there is no separate
  tenant column to keep in sync.
- The platform `admin` persona bypasses the filter; role administration is cross-tenant by
  definition.
- Out-of-tenant `/users/:id/stats` returns **404, not 403**. A 403 confirms the id exists and
  turns the endpoint into an account-enumeration oracle.
- Implemented identically in `server-node/src/routes/users.ts` (`visibleUserIds`) and
  `server-rust/src/routes/mod.rs` (`visible_user_ids`).

## 8. Mobile-app integration plan
Phase 1 (now): webapp API runs alongside Firebase; owner/moderator workflows live here.
Phase 2: replace `src/services/taskService.ts` calls in the mobile app with HTTP
calls to this API (the data model was designed field-for-field compatible).
Phase 3: deprecate direct Firebase usage; API owns persistence (Postgres + S3).

## 9. Build & Run

```bash
# Trail-2 (recommended): Node + Fastify
cd webapp/server-node && npm install && npm run dev     # :3000

# Trail-1: Rust + Axum
cd webapp/server-rust && cargo run                      # :8080

# React client
cd webapp/client && npm install && npm run dev          # :5173
```
Seed accounts (both trails): owner@agri.com / moderator@agri.com / worker@agri.com — password `pass123`.

---

## 10. v2 Requirements Board (agreed, pending implementation)

Status legend: ✅ shipped · 🔨 designed (contract exists, code pending) · 📋 planned

### R1 — Geo-tagged photo evidence ✅ (mobile)
Photos taken by workers must carry the capture-time GPS coordinates
(`photoLat`, `photoLng`, `photoAccuracy`) stored next to `beforePhotoUrl` /
`afterPhotoUrl`. Moderators and owners see a ✓ "at task location" / ✗ "X m away"
verdict computed against the task pin (Haversine, threshold configurable,
default 150 m). Mobile: read coords from `Location.getCurrentPositionAsync()`
at shutter time (image EXIF is unreliable); Web/API: store + render verdict.

### R2 — In-app route drawing ✅ (mobile, OSRM polyline)
Optionally draw the walking/driving route inside the app MapView (polyline via
OSRM/Google Directions) instead of only handing off to native maps. Native-maps
hand-off remains the default (better voice guidance).

### R3 — Unified comment threads (mobile ⇄ web) ✅ (node trail + mobile UI; rust pending)
One `/tasks/:id/comments` API (already live on both server trails) becomes the
single discussion surface for ALL THREE roles. Mobile gains a CommentThread
component (text + record/play audio) reading/writing this API; ordering is
chronological by `createdAt` (Facebook-post style). Requires Phase-2 mobile
migration to this API.

### R4 — Farm entity + owner daily dashboard 🔨 (farms API + finance UI done; per-farm task KPIs pending)
New `farms` entity: `{id, ownerId, name, lat/lng boundary or center}`.
Tasks, finances, and users (`worker.farmId`, `moderator.farmId`) attach to a
farm. Owner dashboard gains: farm selector → per-farm KPIs (today's tasks by
state, open problems, weekly activity trend) + a "Requests / Recommendations"
channel (owner posts advisory notes visible to farm staff).

### R5 — Finance module per farm (accountant view) ✅ (node trail + web page; rust + mobile logging pending)
Ledger per ARCHITECTURE.md §5.3 extended with `farmId`; accountant role (or
owner) gets a per-farm ledger page: category totals, monthly trend, receipt
photos, CSV export. Mobile: expense logging with receipt photo from the field.

### R6 — Ratings on mobile ✅ (moderator rates worker after approval)
After approval, moderator review screen gains "Rate worker"; owner rates from
the web. Same `/ratings` API for both surfaces.

### R7 — Farm portfolio & issue buckets ✅ (web + mobile + both trails)
`GET /v2/farms` + `GET /v2/issues?farmId=` power a portfolio view that groups each
farm's issues into **New / Active / Solved** buckets (`bucketOf(issue)` derives the
bucket from the R2 workflow stage, so adding a stage does not touch the UI).
Web: `pages/Farms.tsx` → `pages/FarmDetail.tsx`. Mobile: `FarmsScreen` →
`FarmDetailScreen`, which lazily loads `GET /v2/issues/:id/events` per issue so a
farm with hundreds of issues still opens in one round trip.

### R8 — Per-task audit report ✅ (web + mobile + both trails)
`GET /tasks/:id/report` returns one aggregate — task, farm, the three people
(reporter/assignee/worker), the linked issue and its events, comments, and a
four-point milestone series (created → started → submitted → reviewed). The
aggregate exists so the report is a *single* authoritative read: assembling it
client-side from five endpoints would let the panels disagree with each other.

### R9 — Expert network surface ✅ (web + mobile + both trails)
`GET /v2/experts` (verified only), `GET /v2/consultations` (public + own +
answered), `GET /v2/consultations/:id`. The detail endpoint is the security
boundary: non-public consultations 404 for non-participants, the group thread id
is disclosed only to members, and `commissionAmount`/`netPayoutEgp` only to the
requester and the owning responder. `POST …/responses` opens (or joins) the F6b
group thread; `PATCH …/choose` is requester-only and creates the 1:1 thread.

### R10 — Tenant-scoped people directory ✅ (both trails)
See §7.1. Closed an unbounded read of every account on the platform.

### R11 — Arabic-first bilingual UI 🔨 (see §11)
Requirement R15 + `docs/LOCALIZATION_SPEC.md`.

---

## 11. Localization architecture (R15)

### 11.1 Placement in the layer model

Localization is a **cross-cutting presentation concern**. It lives above the API client and
below every page; no service, store or route handler is aware of a locale.

```
LocaleProvider (context)
   ├─ locale: 'ar' | 'en'          persisted in localStorage['farmmarshal_locale']
   ├─ dir:    'rtl' | 'ltr'        written to <html dir> and <html lang>
   ├─ t(key, vars?)                catalogue lookup + interpolation + plural selection
   └─ fmt: { date, time, number, currency }   Intl formatters, memoized per locale
```

### 11.2 Catalogue design

- `en.ts` is the **reference key set**; `ar.ts` must match it exactly. A unit test compares the
  two key sets and fails on drift — this is the mechanism that keeps coverage at 100% as pages
  are added, rather than a manual audit.
- Values are either a string or a plural record `{ zero?, one?, two?, few?, many?, other }`
  resolved through `Intl.PluralRules`. Arabic needs all six categories; English uses two.
- Interpolation is `{{name}}`. Every substitution is bidi-isolated at render time, so an
  interpolated `f-1` or `owner@agri.com` cannot reorder the surrounding Arabic sentence.
- Keys are namespaced by surface (`nav.*`, `login.*`, `task.*`, `expert.*`, `common.*`) so a
  deleted page's keys are trivially identifiable.

### 11.3 RTL strategy — logical properties, not a mirrored stylesheet

`styles.css` uses `margin-inline-*`, `padding-inline-*`, `inset-inline-*`, `border-inline-*`
and `text-align: start/end`. Setting `<html dir="rtl">` therefore flips the entire layout with
**zero duplicated CSS**. A second, mirrored stylesheet was rejected: it doubles the maintenance
surface and drifts silently the first time someone edits only one copy.

Directional glyphs (`←`, `→`, chevrons) come from `t()` so the catalogue chooses the correct
arrow per direction; they are not CSS-transformed, because `transform: scaleX(-1)` also mirrors
any text baked beside them.

### 11.4 Server boundary

The API is language-neutral (LOCALIZATION_SPEC §6). `api.ts` sends `Accept-Language: <locale>`,
and maps failures to a localized message by **HTTP status**, showing the raw server `error`
string only when `import.meta.env.DEV`. This keeps internal messages out of the product UI —
which is a security property as much as a localization one.
