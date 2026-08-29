# FarmMarshal — Code & Technology Comparison Study

**Version:** 1.0 · **Date:** 2026-08-25 · **Status:** DECISION DOCUMENT (no code changes yet)

> Purpose: a transparent, criteria-based comparison of the leading technology options
> for (A) the Mobile app, (B) the Web frontend, and (C) the Web backend/API — so that
> every past choice is justified and future choices are made by matrix, not assumption.
>
> Project-specific weighting matters more than generic benchmarks. FarmMarshal's hard
> requirements are: **IoT device connectivity** (water meters, valves, solar inverters,
> greenhouse robots), **rich media** (photos, video streaming + annotation, voice notes),
> **realtime chat with translation**, **offline-tolerant field usage**, and — per the
> general rule — **extreme usability for non-technical field workers**.

Scoring scale per criterion: 1 (poor) → 5 (excellent). Weighted totals use project-specific weights.

---

## 0. Decision Criteria (weighted for THIS project)

| # | Criterion | Weight | Why it matters here |
|---|---|---|---|
| C1 | IoT / embedded connectivity (BLE, MQTT, serial gateways) | 20% | Water valves, solar telemetry, greenhouse robot |
| C2 | Rich media handling (camera, video playback/seek, annotation hooks) | 15% | Before/after evidence, robot video review, voice notes |
| C3 | Realtime capability (chat, live telemetry dashboards) | 12% | Worker↔expert chat, live water/solar monitoring |
| C4 | Developer velocity & maintainability (small team reality) | 12% | One team must ship all modules |
| C5 | Ecosystem maturity (libraries: maps, charts, BLE, media) | 10% | Avoid building from scratch |
| C6 | Performance headroom (telemetry ingestion, video pipeline) | 10% | Thousands of sensor readings/day; video transcoding |
| C7 | Hiring availability / team skills (Egypt-based team) | 8% | Long-term supportability |
| C8 | Usability tooling for non-tech users (UI kits, i18n/RTL, accessibility) | 7% | Field workers are not geeks; Arabic RTL required |
| C9 | Cost of ownership (hosting, licenses, dev time) | 6% | Owner is cost-sensitive |

---

## A. MOBILE APP — candidates compared

| Candidate | Type | One-line positioning |
|---|---|---|
| A1. React Native (Expo) | Cross-platform JS | Current choice; huge ecosystem, OTA updates |
| A2. Flutter | Cross-platform Dart | Best-in-class UI engine, strong BLE libs |
| A3. Native iOS (Swift/SwiftUI) | Native | Max platform fidelity, 2× teams needed |
| A4. Native Android (Kotlin/Compose) | Native | Same as A3 for Android |
| A5. Kotlin Multiplatform (KMP) | Shared logic + native UI | Share business logic, keep native UIs |
| A6. Ionic / Capacitor | WebView hybrid | Web-tech reuse, weakest native access |
| A7. .NET MAUI | Cross-platform C# | Microsoft shops only |
| A8. PWA-only (mobile web) | Browser app | Zero install; no BLE/camera-reliable access |

### A-Matrix

| Criterion (weight) | RN+Expo | Flutter | Swift | Kotlin | KMP | Ionic | MAUI | PWA |
|---|---|---|---|---|---|---|---|---|
| C1 IoT/BLE (20%) | 4 (`react-native-ble-plx`, `mqtt` over WS) | 5 (`flutter_blue_plus`, `mqtt_client`) | 5 (CoreBluetooth) | 5 (Android BLE) | 4 (expect/fallback) | 2 (WebBLE only on iOS) | 3 | 1 (WebBLE partial) |
| C2 Media (15%) | 4 (expo-camera/video, expo-av) | 4 (camera plugin, chewie) | 5 (AVFoundation) | 5 (CameraX/ExoPlayer) | 3 | 3 (HTML5 limits) | 3 | 3 |
| C3 Realtime (12%) | 5 (WebSocket/Firebase mature) | 4 (web_socket_channel, Firebase) | 4 | 4 | 4 | 4 | 4 | 4 |
| C4 Velocity (12%) | 5 (hot reload, one codebase, existing codebase!) | 4 (Dart is a second language to learn) | 2 | 2 | 3 | 5 | 3 | 5 |
| C5 Ecosystem (10%) | 5 | 4 | 4 | 4 | 3 | 4 | 3 | 5 |
| C6 Performance (10%) | 4 (new architecture/JIT Hermes fine for this load) | 5 (compiled, Skia) | 5 | 5 | 5 | 2 | 3 | 2 |
| C7 Hiring (8%) | 4 (very common in Egypt) | 4 (growing fast) | 3 | 4 | 2 (niche) | 4 | 2 (regional rarity) | 4 |
| C8 Usability/i18n/RTL (7%) | 5 (i18n-js, RTL supported, big UI kit choice) | 5 (first-class RTL + Material/Cupertino) | 4 | 4 | 4 | 4 | 3 | 5 |
| C9 Cost (6%) | 5 (one codebase + Expo OTA = no store waits) | 4 | 1 | 1 | 2 | 4 | 3 | 5 |
| **Weighted total (/5)** | **4.50** | **4.44** | **3.62** | **3.86** | **3.36** | **3.30** | **3.02** | **3.14** |

### Mobile findings

- **RN+Expo wins mainly on velocity + ecosystem + sunk investment**: ~7 screens, services layer,
  geo-evidence and OSRM routing are already shipped. Rewriting buys little.
- **Flutter's genuine edge is BLE reliability and rendering consistency.** If Phase "IoT valves"
  hits BLE pain in RN, the escape hatch is a **native module** (Swift/Kotlin) behind the existing
  service interface — NOT a rewrite.
- **PWA is disqualified** for the worker app (unreliable background camera/GPS/BLE), but remains a
  valid *fallback* channel for low-end devices later.
- **Decision: STAY on React Native (Expo). Re-evaluate only if BLE/native-module effort exceeds
  ~20% of a release cycle twice in a row.**

---

## B. WEB FRONTEND — candidates compared

| Candidate | Positioning |
|---|---|
| B1. React 18 + Vite (current) | Component model, largest ecosystem |
| B2. Angular 18+ | Batteries-included enterprise framework (was unfairly skipped before) |
| B3. Vue 3 + Nuxt | Gentle learning curve, great docs |
| B4. Svelte/SvelteKit | Compiler-based, tiny bundles |
| B5. SolidJS | React-like API, fine-grained reactivity |
| B6. Next.js (React meta-framework) | Adds SSR/routing conventions |
| B7. Blazor (WASM/Server) | C# end-to-end |
| B8. HTMX + server templates | Minimal-JS simplicity |

### B-Matrix

| Criterion (weight) | React+Vite | Angular | Vue/Nuxt | Svelte | Solid | Next.js | Blazor | HTMX |
|---|---|---|---|---|---|---|---|---|
| C1 IoT dashboards (20%) | 5 (recharts/visx, WS hooks) | 5 (RxJS superb for streams) | 4 | 4 | 4 | 5 | 3 | 2 |
| C2 Media/annotation UI (15%) | 5 (video.js/wavesurfer wrappers everywhere) | 4 | 4 | 3 | 3 | 5 | 2 | 1 |
| C3 Realtime chat UI (12%) | 5 | 5 | 4 | 4 | 4 | 5 | 3 | 2 |
| C4 Velocity (12%) | 5 (team already productive in it) | 3 (steep ramp: DI, RxJS, decorators) | 4 | 4 | 3 | 4 | 3 | 5 |
| C5 Ecosystem (10%) | 5 | 4 | 4 | 3 | 2 | 5 | 3 | 3 |
| C6 Performance (10%) | 4 | 4 | 4 | 5 | 5 | 4 | 2 | 5 |
| C7 Hiring (8%) | 5 (dominant in Egypt market) | 4 (strong in enterprise/gov) | 3 | 2 | 1 | 5 | 2 | 3 |
| C8 i18n/RTL/usability (7%) | 5 (react-i18next, RTL mature) | 5 (built-in i18n, RTL) | 5 (vue-i18n) | 3 | 3 | 5 | 3 | 4 |
| C9 Cost (6%) | 5 | 4 | 4 | 4 | 4 | 4 | 3 | 5 |
| **Weighted total (/5)** | **4.87** | **4.35** | **4.13** | **3.72** | **3.42** | **4.80** | **2.70** | **3.05** |

### Frontend findings — including the honest answer about Angular

- **Why Angular was originally neglected:** it was excluded by an unstated assumption
  ("the codebase and team were already React"), which was a process failure, not an
  engineering conclusion. This study corrects that.
- **Angular's real strengths:** opinionated structure, DI, built-in forms/i18n/RTL, RxJS is genuinely
  excellent for sensor-stream dashboards. Its costs: steepest learning curve of the group, heavier
  bundle baseline, and — decisive here — a **full rewrite** of 5 shipped pages plus retraining,
  with zero user-visible payoff.
- **Verdict:** Angular scores respectably (2nd-tier) but loses on migration cost (C4) and hiring
  depth vs React locally. **Decision: KEEP React + Vite.** If the dashboard grows heavy
  realtime charting later, adopt RxJS-style patterns via libraries inside React rather than switching frameworks.
- Next.js adds SSR value we don't need (auth-gated internal dashboards, no SEO requirement).

---

## C. BACKEND / API — candidates compared

| Candidate | Positioning |
|---|---|
| C1. Node.js + Fastify (current Trail-2) | TS end-to-end, fastest iteration |
| C2. NestJS | Structured Node framework (Angular-style) |
| C3. Rust + Axum (current Trail-1) | Max performance/safety, slower iteration |
| C4. Go (Gin/Echo) | Simple concurrency, great for network services |
| C5. Python + FastAPI | AI/ML first-class (translation, CV dust detection) |
| C6. Java + Spring Boot | Enterprise standard |
| C7. C# + ASP.NET Core | Strong all-round, Windows heritage |
| C8. Elixir + Phoenix | BEAM concurrency, realtime-first |

### C-Matrix

| Criterion (weight) | Node+Fastify | NestJS | Rust+Axum | Go | Python+FastAPI | Spring Boot | ASP.NET Core | Phoenix |
|---|---|---|---|---|---|---|---|---|
| C1 IoT/MQTT/device fleets (20%) | 5 (mqtt.js/Aedes broker embedding trivial) | 4 | 5 (rumqttc/tokio superb) | 5 (paho, goroutines ideal) | 4 (paho-mqtt, asyncio) | 4 (HiveMQ/Eclipse Paho) | 4 (MQTTnet) | 4 (tortoise/mqtt) |
| C2 Media pipeline (video transcode, thumbnails) (15%) | 4 (spawn ffmpeg, streams OK) | 4 | 4 (ffmpeg bindings/manual) | 4 | 3 (GIL hurts transcode; delegate to ffmpeg) | 4 | 4 | 4 |
| C3 Realtime (WS chat, live dashboards) (12%) | 5 (@fastify/websocket, socket.io) | 5 | 4 (tokio-tungstenite) | 5 (goroutines + nhooyr ws) | 4 | 4 (STOMP) | 4 (SignalR excellent) | 5 (channels built-in) |
| C4 Velocity (12%) | 5 (same language as clients; shared types) | 4 (more boilerplate, better structure at scale) | 2 (borrow checker tax on a small team) | 4 | 5 (FastAPI is extremely fast to write) | 2 (verbose) | 3 | 3 |
| C5 Ecosystem (10%) | 5 | 4 | 3 | 4 | 5 (AI/ML: transformers, OpenCV) | 5 | 5 | 3 |
| C6 Performance headroom (10%) | 3 (fine ≤ few k req/s) | 3 | 5 (10–40× CPU-bound advantage) | 5 | 2 | 4 | 4 | 4 |
| C7 Hiring (8%) | 5 (most common stack in Egypt) | 4 | 2 (scarce & expensive locally) | 4 | 5 | 5 | 4 | 2 |
| C8 i18n/tooling for Arabic data (7%) | 5 | 5 | 4 | 4 | 5 | 5 | 4 | 4 |
| C9 Cost (6%) | 5 (single VPS, low RAM) | 4 | 4 (cheap runtime, expensive dev hours) | 5 | 3 (RAM-heavy ML serving) | 2 (JVM footprint) | 3 | 3 |
| **Weighted total (/5)** | **4.62** | **4.19** | **4.06** | **4.56** | **4.11** | **3.83** | **3.92** | **3.66** |

### Backend findings — answering your three questions explicitly

**Why was Node+Fastify selected?**
1. **TypeScript end-to-end**: the mobile app, web client, and API share literal type definitions
   (`types.ts`), eliminating contract drift — worth more than raw speed at this team size.
2. **IoT fit**: MQTT brokers can be embedded in-process (`Aedes`) or bridged via `mqtt.js`;
   WebSocket chat and SSE dashboards are first-class.
3. **Velocity & hiring**: fastest iteration loop and the deepest local talent pool.
4. **Performance is sufficient**: projected telemetry (~10⁴ readings/day at pilot scale) is orders of
   magnitude below Node's ceiling.

**Why wasn't a fair comparison done initially, and why wasn't Rust proposed to you?**
It actually *was* present from day one — `webapp/server-rust/` implements the identical REST
contract ("Trail-1") — but its purpose was never communicated, which made it look arbitrary.
The honest framing is:

- **Rust+Axum is not better overall for this team** (borrow-checker tax, scarce local hiring),
  but it is the best option for **specific hot paths**: high-frequency telemetry ingestion,
  stream aggregation for leak detection, and video chunk processing.
- The recommended strategy is therefore **polyglot-by-service, not either/or**: Fastify owns the
  CRUD/business API; IF telemetry volume ever justifies it, a small Axum ingestion microservice is
  slotted behind the same message queue without touching any client.

**Runner-up worth watching: Go (4.56)** — nearly Node-level velocity with Rust-like concurrency.
If the team ever outgrows Node for services (not hot paths), Go is the designated successor;
Python+FastAPI is the designated home for the **dust-detection CV model** (OpenCV/YOLO) served as
an internal microservice regardless of the main backend choice.

### Final recommendation summary

| Layer | Keep / Choose | Runner-up | Trigger to revisit |
|---|---|---|---|
| Mobile | React Native (Expo) | Flutter | BLE pain > 2 cycles → native module first, then reassess |
| Web frontend | React 18 + Vite | Angular | — (migration never pays off at this scale) |
| Main API | Node.js + Fastify | Go | Sustained > 60% CPU or team > 6 backend devs |
| Hot-path ingest (future) | Rust + Axum (optional service) | — | > 100 msg/sec sustained telemetry |
| ML inference (future) | Python + FastAPI microservice | — | Dust-detection phase start |

> These decisions are recorded as **ADRs** in `docs/ARCHITECTURE_EVOLUTION_PLAN.md §9`.
