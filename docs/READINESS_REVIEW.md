# FarmMarshal v2 — Readiness Review & Supported-Options Catalog

**Version:** 1.0 · **Date:** 2026-08-25 · **Purpose:** final cross-check of all planning docs
against your requirements; definitive list of what each app will support, for whom; and the
formal readiness verdict before implementation starts.

**Inputs reviewed:** `TECH_COMPARISON_STUDY.md`, `V2_REQUIREMENTS_ANALYSIS.md`,
`ARCHITECTURE_EVOLUTION_PLAN.md`, `IMPLEMENTATION_PLAN_AND_TESTS.md`,
`SUBSCRIPTION_AND_PAYMENTS_DESIGN.md`, `ROBOT_INTEGRATION_SPEC.md`, plus both existing
`ARCHITECTURE.md` docs.

---

## 1. Supported options — MOBILE APP (React Native / Expo)

| # | Capability | Worker | Moderator | Agri-Expert | Owner | Notes |
|---|---|---|---|---|---|---|
| M1 | Login (all roles), Arabic-first RTL UI | ✓ | ✓ | ✓ | ✓ | Large touch targets, icon nav |
| M2 | Tasks: receive, navigate, geo-tagged before/after evidence (R1), OSRM route polyline (R2) | ✓ | ✓ | — | view | Existing, unchanged |
| M3 | Review & approve/decline + rate worker after approval (R6) | — | ✓ | — | — | Web coexists |
| M4 | 7-stage issue workflow: report problem, inspect w/ photo+GPS, execute, view stage badges | ✓ | ✓ | ✓ | view | New Issues module |
| M5 | Chat with anyone, any language: text/photo/video/voice notes/emoji/pins + inline translation ("show original") | ✓ | ✓ | ✓ | ✓ | Expert inbox grouped farm→area→worker |
| M6 | Water: consumption dashboard card, valve open/close (confirm dialog), leak alerts (push) | — | ✓ | — | view | Plan-gated |
| M7 | Solar: per-farm energy summary, cleaning-task execution, dust alerts | ✓(tasks) | ✓ | view | view | Plan-gated |
| M8 | Tree QR scan → full tree history timeline | ✓ | ✓ | ✓ | view | New |
| M9 | Marketplace (Uber-style): post consultation (photos/video/bounty), answer as verified expert, 1:1 + group threads per consultation, rate answers | ask: mod/owner | ask | ask+answer(verified) | ask | Plan-gated; expert onboarding/KYC on web |
| M10 | Offline outbox: chat messages & evidence uploads queue during Wi-Fi/5G loss, drain exactly-once | all | all | all | all | ADR-011 |
| M11 | Push notifications (FCM) for chat, alerts, video-ready, task changes | all | all | all | all | Replaces local-only alerts |
| M12 | "Record requested video" fallback task when no robot assigned | ✓ | ✓ | request via web | — | Robot-spec §8 |
| M13 | Persona experience: welcome persona cards, in-app switcher (farm roles + learner + crowd/academic expert) | all | all | all | all | G0.1b — one store binary |
| M14 | Learner mode: case library (full 7-stage expert reasoning), exams incl. photo-diagnosis | — | — | author (verified) | — | P7; learners = open self-registration |

Not on mobile (by design): admin console, device provisioning, subscription billing, report CSV export, video annotation drawing → web.

## 2. Supported options — WEBAPP (React + Vite)

| # | Capability | Owner | Moderator | Agri-Expert | Accountant | Admin | Notes |
|---|---|---|---|---|---|---|---|
| W1 | Dashboard KPIs: problems/solutions/activities per farm (R4) | ✓ | ✓ | — | — | ✓ | Farm selector |
| W2 | Task management + review evidence | ✓ | ✓ | — | — | ✓ | Unchanged core |
| W3 | Evaluations/ratings directory | ✓ | ✓(workers) | — | — | ✓ | Existing |
| W4 | Finance ledger + receipt photos + CSV export (R5) | ✓ | entry | — | ✓ | ✓ | Per-farm scoping |
| W5 | Issues board (kanban by 7 stages) across kinds (water/solar/pest/equipment) | ✓ | ✓ | ✓ | — | ✓ | G0.2 engine |
| W6 | Water control tower: live consumption, cost rollups, valve status, leak queue | ✓ | ✓ | — | — | ✓ | Plan-gated |
| W7 | Solar: panel heatmap, daily reports vs weather, dust status, cleaning requests, weekly/monthly/yearly archived reports | ✓ | ✓ | view | — | ✓ | Plan-gated |
| W8 | Video Review studio: HLS player, click-to-timestamp comments, scene linking, SVG frame annotation, annotation recall | ✓ | ✓ | ✓(primary user) | — | ✓ | Robot or human uploads |
| W9 | Schedules/events per farm (robot missions, inspections) calendar | ✓ | ✓ | ✓(creates) | — | ✓ | Feeds robot spec §5 |
| W10 | Trees registry: map/table, lifecycle status, removal recommendations, history export | ✓ | ✓ | ✓ | — | ✓ | Mobile scans |
| W11 | Marketplace admin: expert onboarding & credential verification queue, commission splits, moderation, dispute resolution, payout ledger (manual→card later) | ✓ | — | participate | payouts | ✓ | Visa/MC webhook flow |
| W12 | Subscription center: plan selection/upgrades (manual now, cards next), invoices | ✓ | — | — | view | ✓ | Gates all premium features |
| W13 | Admin console: users, farms, devices, plans, feature flags, audit log | — | — | — | — | ✓ only | Single RBAC choke point |
| W14 | Basic chat threads (owner/expert follow-up from desktop) | ✓ | ✓ | ✓ | — | — | Mobile is primary chat surface |
| W15 | Academy: case publisher (anonymize closed issues), quiz builder, academic verification queue, learner progress | — | — | author (verified) | — | ✓ | P7 |
| W16 | Expert dual-identity management: farm duties + global crowd-expert earnings under one login | ✓(earn) | ✓ | ✓ | — | ✓ | Persona union permissions (G0.1b) |

## 3. Cross-cutting guarantees (both apps)

1. **Role-scoped visibility everywhere, enforced server-side**: worker sees his tasks/comments only; moderator/expert see their farms; owner sees his farms; admin sees everything.
2. **Universal 7-stage workflow** (Detect→Inspect→Identify→Recommend→Implement→Review&Evidence→Closure) applies to ALL activity kinds via one `issues` engine.
3. **Subscription-gated features**: translation provider tier, water/solar IoT, video platform, marketplace, report periods — enabled/disabled by the owner's plan; server-enforced (402 + upsell).
4. **Language coverage**: Arabic-first RTL + per-user locale; message-level translation with cached originals.
5. **Connectivity resilience**: gateway buffering + mobile offline outbox treated as normal operation, tested by outage-replay in every relevant phase.
6. **One binary, many personas** (G0.1b): single App Store/Play Store download; identity holds multiple personas (e.g., moderator + global crowd-expert + learner) with in-app switching; permissions = union of active personas; audit logs record the acting persona; learners are hard-isolated from live farm data.

## 4. Consistency findings found during this review (fixed)

| Finding | Resolution |
|---|---|
| Firebase→API mobile migration was implied but not scheduled as explicit work | Added to P0 item 7 (`IMPLEMENTATION_PLAN`): auth/task services switch behind existing service-layer interface before feature phases start |
| Entitlement system had no build slot despite gating P1+ features | Added to P0 item 5 (tables + middleware + manual payment ledger) |
| Robot had no contract while P4 needed one | Covered: ROBOT_INTEGRATION_SPEC + simulator-first strategy in P4 |
| 2nd owner review: Uber-style expert registration/KYC/commission was missing | Added F6a (onboarding, verification workflow, commission split, suspension) — schema, API, P6 plan & tests |
| 2nd owner review: consultation ↔ chat (1:1 + group threads) not wired | Added F6b — consultations link `group_conversation_id` + per-responder threads built on F3 engine |
| 2nd owner review: tree identity depended on GPS alone; no annotation→tree link | Added layered identity (QR primary + GPS+accuracy + relative code fallback) and `video_annotations.tree_id` |
| 3rd owner review: single-role model couldn't support store-download self-registration, learners, or dual expert identities | Added G0.1b multi-persona model (P0 scaffold) + F7 Learner Academy & Academic Experts (new P7) |

## 5. Deliberately deferred micro-decisions (none block P0–P2)

| Decision | Deferred to | Default if unanswered |
|---|---|---|
| Card gateway vendor (Paymob vs Stripe) | mid-P6 | Paymob (regional fit) |
| Weather API vendor | P3 start | OpenWeather (cache makes swap trivial) |
| BLE pairing need for phones ↔ valves | after P2 pilot spike | None — gateway model assumed |
| Translation provider contract rates | P1 start | Start Google tier, DeepL adapter ready |
| Plan pricing (EGP figures) | before P6 launch | 3 demo seed tiers |
| MQTT broker flavor (Mosquitto vs EMQX) | P2 start | Mosquitto (lighter pilot) |

## 6. Readiness checklist

| Gate | Status |
|---|---|
| Tech stack justified via weighted comparison matrix, decisions recorded as ADRs 001–014 | ✅ |
| Every owner requirement decomposed with IDs and traceability (G0, F1–F6) | ✅ |
| Data model designed (Postgres DDL incl. JSONB extensibility) | ✅ |
| API surface defined (v2 contract list) + WS channels | ✅ |
| Hardware/vendor uncertainty neutralized (HAL + conformance simulator strategy) | ✅ |
| Connectivity-loss, offline, and partial-failure behaviors specified | ✅ |
| Subscription/payments model covering your enable/disable rule + Visa/MC confirmation | ✅ |
| Phased working plan with dependencies, estimates, DoD per phase | ✅ |
| Test strategy mapped feature-by-feature incl. security (IDOR/MQTT ACL/injection) & UAT with non-tech users | ✅ |
| Docs update path defined for both ARCHITECTURE.md files at ship time | ✅ |
| Open blocking questions from owner | ✅ none remaining |

## 7. VERDICT

**READY FOR IMPLEMENTATION — GO for Phase 0.**

Recommended kickoff order within P0: schema migrations → authz module → issue engine →
entitlements scaffold → Firebase retirement on mobile → seed/demo → CI harness.
First checkpoint demo: end of P0 week 2 (RBAC + issues board live against Postgres).
