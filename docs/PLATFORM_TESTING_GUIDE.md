# Platform Testing Guide — iOS & Windows (Mobile App + WebApp)

**Version:** 1.0 · **Date:** 2026-08-25
**Purpose:** exact prerequisites, installs, and step-by-step test procedures for every FarmMarshal
component on iOS and Windows. Follow top-to-bottom per platform; each section ends with the
expected result so failures are immediately attributable.

---

## 1. Prerequisites by platform

### 1.1 Windows (webapp + Android device testing)

| Tool | Version | Install | Verify |
|---|---|---|---|
| Node.js LTS | ≥ 20 | https://nodejs.org (MSI) | `node -v` |
| npm | bundled | — | `npm -v` |
| Git | latest | https://git-scm.com | `git --version` |
| Rust toolchain | stable | https://rustup.rs (`rustup-init.exe`) + **Visual Studio Build Tools** with "Desktop development with C++" workload | `cargo --version` |
| PostgreSQL (optional, P0 schema) | ≥ 15 | installer or `winget install PostgreSQL.PostgreSQL` | `psql --version` |
| curl / PowerShell | built-in | — | — |
| Android testing (optional) | — | Android Studio (+ SDK Platform 34, Platform-Tools); enable USB debugging on phone | `adb devices` |

### 1.2 iOS (requires a Mac — Apple does not allow iOS builds/simulation on Windows)

| Tool | Version | Install | Verify |
|---|---|---|---|
| macOS | 14+ | — | — |
| Xcode | ≥ 15 | App Store | `xcodebuild -version` |
| CocoaPods | latest | `sudo gem install cocoapods` | `pod --version` |
| Node.js LTS | ≥ 20 | brew or nodejs.org | `node -v` |
| Expo Go app | latest | App Store on the iPhone | — |
| Watchman (optional) | latest | `brew install watchman` | `watchman --version` |

> Testing the iOS app FROM Windows is possible only on a physical iPhone via Expo Go over LAN
> (dev server runs on Windows, phone scans QR). Native builds/publishing require the Mac.

---

## 2. Backend servers

### 2.1 Node trail (:3000)

```bash
cd webapp/server-node
npm install
npm run check          # typecheck gate
npm test               # 37 tests must pass
npm run dev            # boots on :3000, seeds demo data
```
Expected: `{"ok":true}` from `curl http://localhost:3000/health`; boot line
`logging configured {"level":"info","format":"dev"}`.

Logging modes to exercise:
```bash
LOG_LEVEL=off   npm start   # zero log lines while serving
LOG_FORMAT=json LOG_LEVEL=debug npm start   # customer format, verbose
```

Demo accounts: owner@agri.com / moderator@agri.com / worker@agri.com → pass123;
admin@agri.com → admin123.

### 2.2 Rust trail (:8080)

```bash
cd webapp/server-rust
cargo test             # 6 fixture tests must pass (same numbers as Node suite)
cargo run              # boots on :8080
curl http://localhost:8080/health     # {"ok":true}
```
Same env controls (`LOG_LEVEL`, `LOG_FORMAT`), same accounts, same fixtures.

**Parity spot-check (run the same calls against both ports):**
1. Login as moderator → token.
2. `GET /v2/water/summary?deviceId=dev-meter-1` → expect consumedM3≈138, costEgp=402 on BOTH.
3. Worker attempts valve open → 403 on both.
4. Solar daily-job as admin → flagged=1, cleaningIssuesRaised=1 on both.

### 2.3 Web client

```bash
cd webapp/client
npm install
npm run dev            # :5173
```
Point it at either server via its API base config; login with demo accounts.

---

## 3. Component test procedures

For each: **[Prep] → [Steps] → [Expected]**. Run against the chosen server port.

### T1 Authentication (all surfaces)
- Prep: server running.
- Steps: login worker@agri.com/pass123; logout; login wrong password.
- Expected: valid login lands on role home; wrong password shows "Invalid credentials"; no
  token persisted after logout (relaunch app → Login screen).

### T2 Tasks & evidence (mobile)
- Steps (worker): open task → Drive me there (opens native maps) → Take before photo →
  perform action → Take after photo.
- Expected: task moves assigned→in_progress→submitted; photos visible in web review;
  geo fields stored when GPS permission granted (check `/uploads/` file exists).
- Negative (moderator): approve/reject with note → worker sees status change within ~5 s
  (poll interval).

### T3 Issues 7-stage workflow (web + API)
- Steps: POST issue → advance detected→inspected WITHOUT evidence (expect 400) → WITH
  evidence photo (200) → identified/recommended need notes → implemented needs existing
  taskId → reviewed needs evidence → closed needs note → try advancing closed (409).
- Role negatives: worker→identified = 403; worker→valve = 403; worker→audit = 403.

### T4 Chat & translation (mobile ⇄ web)
- Steps: A (Arabic keyboard) sends Arabic text in thread; B taps translate; B taps original;
  resend same message twice with airplane-mode retry (offline outbox).
- Expected: B sees English inline without configuring anything; toggle restores original;
  duplicate retries create ONE message; pinned messages surface at inbox/thread top;
  voice note records/plays; reactions toggle.

### T5 Water IoT
- Steps: leak-scan endpoint as moderator → exactly one open leak issue for dev-meter-1
  (rerun = no duplicates); valve close with reason; valve close WITHOUT reason (400);
  summary before/after tariff change reflects new tier math.

### T6 Solar
- Steps (admin): daily-job with panel-B low + cloudPct 15 → B=suspect + cleaning issue;
  rerun with cloudPct 90 and all panels low → NO dust flags (cloud-aware rule).
- Expected reports listed under `/v2/solar/reports?farmId=f-1&date=...`.

### T7 Video & schedules
- Steps: register video → complete (HLS url set) → annotate at t=42s with treeId → list
  annotations → create robot_mission schedule.
- Expected: annotation recall ordered by time; expert notified pattern ready (video.ready).

### T8 Trees
- Steps: resolve by QR (confidence qr); by relative code row-3/pos-7 (relative);
  lifecycle-recommendation for tr-2 (aging/EOL band); add treatment event.
- Expected: identity survives missing GPS; recommendations match species lifespan table.

### T9 Marketplace
- Steps: worker applies (pending) → tries answering (403) → admin verifies → answer OK →
  choose response → payout pending with net = bounty − 15% → rate stars.
- Expected: unverified blocked; split exact (300 → 255 net); reputation card updates.

### T10 Academy
- Steps: publish case from OPEN issue (400) → close an issue → publish (anonymized) →
  learner lists cases (no live farm data anywhere in payload) → author quiz as verified
  expert → learner submits answers → score boundary checks (50% fails @90 threshold).
- Security sweep: learner token against ANY live endpoint → 403/404, never data.

### T11 Subscriptions gating
- Steps: assign Basic plan to farm → call water/summary & valve (expect 402
  upgradeRequired) → reassign Standard → 200 again.
- Expected: downgrade never deletes data; gated UI shows upsell screen.

### T12 RBAC matrix regression
- Re-run `npm test` (Node) / `cargo test` (Rust): the full role × action matrix must stay
  green — any new endpoint requires extending these tests in the same PR.

---

## 4. Mobile-on-iOS specifics

```bash
cd mobile-app && npm install && npx expo start
# Terminal shows QR + options: press i (iOS simulator) or scan QR with Camera (device)
```
- Simulator: press `i` (Xcode required). Device: same Wi-Fi as the Mac; if connection fails,
  set the Mac's LAN IP in `src/services/webApi.ts BASE_URL`.
- Permissions to accept on first use: Location (task evidence), Camera (photos), Microphone
  (voice notes), Notifications (chat/alerts).
- Release-behaviour check: `npx expo run:ios --configuration Release` → logs silent except errors.

## 5. Mobile-on-Windows (Android path)

```bash
cd mobile-app && npm install && npx expo start
```
- Phone: install **Expo Go**, scan QR from the Windows terminal (same Wi-Fi), or connect USB
  with `adb devices` visible and press `a` (needs Android Studio SDK).
- Set `BASE_URL` in `src/services/webApi.ts` to the PC's LAN IPv4 (ipconfig) e.g.
  `http://192.168.0.83:3000`; firewall: allow inbound :3000/:5173/:8080.
- Repeat T1/T2/T4 scenarios; verify offline outbox via airplane-mode toggles.

## 6. Test-data reset

Restarting either server reseeds everything (fixtures are deterministic). For Node+Postgres:
`npm run schema:apply` then restart. Never hand-edit seeded ids (`f-1`, `t-1`, `dev-meter-1`,
`panel-B`, `AGRI-TREE-0001/0002`) — tests and docs reference them.
