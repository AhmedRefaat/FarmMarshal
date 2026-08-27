# Client-Side vs Server-Side Responsibilities — Architecture Design

**Version:** 1.0 · **Date:** 2026-08-25 · **Applies to:** mobile app (Expo RN), web SPA
(React+Vite), and BOTH server trails (Node/Fastify, Rust/Axum — identical contract).

> **Governing principles**
> 1. **The server is the only source of truth.** Every permission, plan-gate, state-machine
>    transition, and money calculation is enforced server-side. Client checks are UX only.
> 2. **The client owns perception, not protection**: layout, offline queues, camera/GPS capture,
>    translation display, charts.
> 3. **One contract, many surfaces** (`/v2` REST + `/ws`): mobile and web are peers; neither is
>    allowed business logic the other lacks.

---

## 1. Responsibility matrix

| Concern | SERVER (authoritative) | MOBILE | WEB |
|---|---|---|---|
| Authentication | Token issue/verify, password seam, persona union resolution | Credential entry, secure storage (AsyncStorage), auto-relogin on 401 | Same via localStorage |
| RBAC / visibility | `authz.can()` matrix + farm scoping + 404-hiding for outsiders | Hide screens per role (structural navigation) | Hide pages/sidebar entries per role |
| Subscriptions | `requireEntitlement` → 402 upgradeRequired; downgrade policy | Upsell screen on 402; hide gated UI | Plan center, upgrade flows |
| Task lifecycle | State machine guards (start/submit/approve/reject) | Camera capture, GPS at shutter (R1), maps hand-off, offline outbox | Review tables, evidence comparison |
| Issue workflow (7 stages) | Stage gates: who may advance + required evidence/note/taskId | Field evidence capture (photos+GPS), stage badges | Issues board (kanban), timelines |
| Water IoT | Telemetry ingestion, tariff/cost math, leak rules, valve control + audit | Valve toggle w/ confirm dialog, consumption card, leak alerts | Dashboards, device registry admin, valve audit view |
| Solar | Daily report job, dust heuristic/CV, weather cache, cleaning requests | Cleaning task execution | Panel heatmap, reports viewer (periods + history) |
| Video platform | Upload lifecycle, HLS transcode, annotation storage, schedule dispatch | "Record requested video" fallback task | Review studio: player, timestamped comments, SVG overlay drawing |
| Trees | QR identity resolution, lifespan estimator, event timeline | QR scan → tree history | Registry CRUD, map/table, print sheets |
| Chat & translation | Message store, idempotency, translation provider + caching, pins/reactions, WS push | Full chat UI: inbox grouped farm→area→worker, composer (photo/video/voice), one-tap translate | Thread view for desktop follow-up |
| Marketplace | KYC verification gate, escrow split math, payout ledger, reputation aggregation | Ask/respond/rate flows | Admin verification queue, dispute + payout console |
| Academy | Case snapshot freeze/anonymization, quiz authoring gate, server-side grading | Case reader, exam player | Case publisher, quiz builder, progress overview |
| Audit & logging | Append-only DB audit trail; LOG_LEVEL/LOG_FORMAT control | Local dev logs only (silent in release) | Admin audit viewer |

## 2. Rules of engagement (for every new feature)

1. Write the requirement section first → define the API route + guard chain
   (`requirePermission` [+ `requireEntitlement`]) → then build UI.
2. If a rule can be broken by a modified client, it belongs on the server. Examples:
   valve interlocks, bounty splits, grading, anonymization.
3. Media never flows through business endpoints unvalidated: signed/limited upload paths,
   content-type + size caps, virus-scan hook point.
4. Offline behaviour is a CLIENT concern (outbox queues with idempotency keys);
   conflict resolution is a SERVER concern (idempotent receivers).
5. Realtime is dual-transport by design: WS push when connected, polling fallback identical.

## 3. What must NEVER live on a client

- Password/token verification logic, permission matrices, plan entitlement tables
- Money math (tariffs, commissions, payouts)
- Grading answer keys, anonymization rules, audit trails
- Device credentials / MQTT secrets (devices get their own per-device identities)
