# Greenhouse Robot — Integration Design & API Specification

**Version:** 1.0 · **Date:** 2026-08-25 · **Status:** CONTRACT-FOR-VENDORS (robot itself is still in design phase)

> This document is the **contract any greenhouse robot must satisfy** to integrate with FarmMarshal.
> It is written so that (a) our own team can build a robot *simulator* today, and (b) any vendor
> can be evaluated against a concrete checklist ("conformance certification") before purchase.

---

## 1. Position in FarmMarshal architecture

```
┌─────────────────────────────┐   MQTT (control/status)    ┌──────────────────────────┐
│  GREENHOUSE ROBOT           │◄──────────────────────────►│  MQTT Broker             │
│  · executes missions        │                            │  (TLS, per-device creds) │
│  · records video per area   │   HTTPS (REST + tus)       └────────────┬─────────────┘
│  · buffers when offline     │◄────────────────────────────────────────┤
└─────────────────────────────┘                                          ▼
                                                            Fastify API (`media`, `schedules`)
                                                                     │
                                                     HLS pipeline → S3 → expert review UI
```

- Robot registers as `device(type='robot')` under a farm (same registry as water/solar devices).
- Control plane = MQTT topics; bulk data plane = direct HTTPS to the API (video never flows through MQTT).

## 2. Expectations from the robot (vendor requirements)

| ID | Requirement |
|---|---|
| R-01 | Wi-Fi station-mode connectivity with automatic reconnect; **must buffer missions/results locally during outages** and resume afterwards (field connectivity is assumed reliable-but-not-perfect). |
| R-02 | Onboard storage ≥ longest scheduled mission (recommend ≥ 64 GB). |
| R-03 | Video: H.264 + AAC in MP4 segments **≤ 2 GB each**; 1080p recommended minimum; fixed segment duration (e.g., 60 s) to enable stable HLS chunking. |
| R-04 | Real-time clock synced via NTP; all timestamps UTC ISO-8601. |
| R-05 | Globally unique `missionId` (UUIDv4) generated per run; retries reuse the same `missionId`. |
| R-06 | Resumable uploads (tus protocol v1, see §4.3). |
| R-07 | Metadata manifest per mission (§4.4): areas covered, start/end time, optional GPS/IMU route trace. |
| R-08 | Per-device credentials provisioned by admin (username=deviceId, secret); TLS only; no shared passwords across units. |
| R-09 | Graceful degradation: partial mission (battery/crash) still reports completed segments. |
| R-10 | Firmware OTA update endpoint OPTIONAL (nice-to-have, not certified). |

## 3. MQTT control plane

Topics (robot subscribes/publishes):

```
farm/{farmId}/robot/{robotId}/cmd        ← mission dispatch / cancel / go-home
farm/{farmId}/robot/{robotId}/ack        ← robot acknowledges command {cmdId, result}
farm/{farmId}/robot/{robotId}/status     ← heartbeat every 30 s {batteryPct, pos?, state}
```

Mission command payload:

```json
{
  "cmdId": "uuid",
  "type": "mission",
  "missionId": "uuid",
  "areas": ["sector-A", "row-12"],
  "mode": "record_video",
  "deadline": "2026-09-01T16:00:00Z"
}
```

Design rationale: MQTT chosen over HTTP polling because missions must reach robots that are
usually idle/offline-cheap, and heartbeats double as fleet health monitoring — same broker and
security model already required for water valves (one infra to operate).

## 4. HTTPS data plane (Fastify `/v2`)

### 4.1 Mission fetch (fallback channel when MQTT unavailable)
```
GET /v2/robot/missions?robotId={id}&status=pending      [device auth]
→ [{missionId, areas, mode, deadline}]
PATCH /v2/robot/missions/{missionId}/status {state: accepted|running|done|failed, note?}
```

### 4.2 Provisioning
```
POST /v2/devices  {farmId, type:'robot', vendor, label}   [admin]  → {deviceId, secret(once)}
```

### 4.3 Video upload — resumable (tus)
```
POST /v2/videos/upload            tus creation: Upload-Metadata: missionId,area,segmentIdx,recordedAt
HEAD /v2/videos/upload/{id}       offset query
PATCH /v2/videos/upload/{id}      binary chunk
```
Server-side: on completion → ffmpeg normalize → HLS → storyboard → `videos.status='ready'` →
event `video.ready` → notify the expert who requested/scheduled that area.

### 4.4 Mission complete manifest
```
POST /v2/robot/missions/{missionId}/complete
{
  "missionId": "uuid",
  "startedAt": "...", "endedAt": "...",
  "segments": [{"file":"seg-001.mp4","area":"row-12","startedAt":"...","durationS":60,
                "sha256":"..."}],
  "routeTrace": [{"t":"...","lat":..,"lng":..}]     // optional but recommended
}
```

## 5. Scheduling & notification loop

1. Expert creates `schedule(kind='robot_mission')` per farm (recurrence or one-off) OR requests
   an ad-hoc recording of an area.
2. Scheduler emits MQTT cmd when due (or queues it if robot offline — delivered on reconnect).
3. On `complete` → videos processed → expert notified: *"New video ready: Farm X / row-12"*.
4. Expert reviews in Video Review page (timestamped comments, scene links, SVG annotations —
   see ARCHITECTURE_EVOLUTION_PLAN §2 `video_annotations`).

## 6. Failure-mode handling (both sides)

| Failure | Expected behavior |
|---|---|
| Wi-Fi loss mid-mission | Robot keeps recording, buffers segments; resumes upload later; API accepts late backfills |
| API unreachable | Exponential backoff; local queue persisted across reboots |
| Crash mid-mission | Already-finished segments uploaded under same `missionId`; manifest marked `partial:true` |
| Duplicate upload retry | tus offset + sha256 dedupe → exactly-once storage |
| Clock drift | Server rejects manifests with skew > 10 min (forces NTP fix) |

## 7. Conformance certification (test suite a vendor must pass)

Provided by us as a **robot simulator + scenario runner** (built in P4 before hardware exists):
1. Heartbeat & reconnect storm (20 drop/reconnect cycles) → zero lost commands.
2. Buffered-upload resume after 15-min outage → byte-identical asset server-side.
3. Partial mission crash simulation → partial manifest accepted, segments playable.
4. Duplicate segment upload → stored once.
5. Wrong-credential device → rejected at broker AND API (401 everywhere).
6. Clock-skew rejection test.
7. Full happy path: schedule → dispatch → record sim → upload → HLS ready → expert notified < 5 min.

A vendor passing all 7 = "FarmMarshal Certified". Until real hardware exists, the simulator runs
these scenarios in CI continuously.

## 8. Usability fallback (no-geek rule)

Workers without a robot can fulfill the SAME expert request using the mobile app camera
("record requested video" task appears like any other task with geo-tagged evidence). The expert
sees identical review screens regardless of source (robot vs human) — robot is an upgrade, not a dependency.
