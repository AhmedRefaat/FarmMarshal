# PostgreSQL Open Decisions — FarmMarshal

**Document type:** Decision register. **No decision below has been made by this document.**
**Date:** 2026-08-27
**Status:** `OPEN — 16 decisions, 5 blocking`
**Companion documents:** [POSTGRESQL_TARGET_ARCHITECTURE.md](POSTGRESQL_TARGET_ARCHITECTURE.md) · [POSTGRESQL_SCHEMA_BLUEPRINT.md](POSTGRESQL_SCHEMA_BLUEPRINT.md) · [POSTGRESQL_SECURITY_MODEL.md](POSTGRESQL_SECURITY_MODEL.md) · [POSTGRESQL_MIGRATION_STRATEGY.md](POSTGRESQL_MIGRATION_STRATEGY.md)

> Recommendations in this register are **engineering advice, not decisions**. Each
> requires a named owner to accept it. Where a recommendation is strong, that is
> said; where the evidence is genuinely thin, that is said too.
>
> **Owners are given as roles, not names.** Assigning the actual people is itself
> a prerequisite for Phase 0.

---

## Summary

| ID | Question | Blocking | Recommendation | Owner role | Milestone |
|---|---|---|---|---|---|
| `PG-D-01` | Canonical backend: Node, Rust, or both? | **YES — blocks everything** | Retire Rust | CTO / Head of Engineering | Phase 0.1 |
| `PG-D-02` | Hosting and PostgreSQL major version | **YES** | Managed PostgreSQL 17, no extensions required | SRE lead | Phase 0.2 |
| `PG-D-03` | Organization ↔ farm cardinality | **YES** | Org is a real root; 1:N to farms | Product owner + Eng | Phase 0.2 |
| `PG-D-04` | Connection pooling mode | **YES** | Transaction pooling, verified by test | SRE lead | Phase 0.2 |
| `PG-D-05` | TimescaleDB or native partitioning | No | Native; Timescale only on measured need | Eng lead | Phase 4 |
| `PG-D-06` | Redis now or later | No | Later; first trigger likely WebSocket fan-out | Eng lead | Phase 3 |
| `PG-D-07` | Plot / area hierarchy depth | No | Farm → plot → area, exactly three levels | Product owner | Phase 2 |
| `PG-D-08` | Telemetry retention and PITR window | No | 90d raw, aggregates long-term, 30d PITR | Product + SRE | Phase 4 |
| `PG-D-09` | Robot and mission model | No | Defer to Phase 4 pending real integration | Product owner | Phase 4 |
| `PG-D-10` | Gapless invoice numbering required? | No | Confirm with finance before building it | Finance / legal | Phase 5 |
| `PG-D-11` | Firestore channel: remove or audit | **YES — security** | Remove | Security lead | Before Phase 2 |
| `PG-D-12` | Erasure, redaction, and regulatory regime | No | Establish policy before production data | Legal + Security | Phase 5 |
| `PG-D-13` | Anonymisation timing for learning cases | No | Anonymise at publish, not at read | Product + Security | Phase 5 |
| `PG-D-14` | Message delivery receipts | No | Defer; cost is high, value unproven | Product owner | Phase 3 |
| `PG-D-15` | Object-storage provider | No | S3-compatible, provider-agnostic interface | SRE lead | Phase 3 |
| `PG-D-16` | Multi-currency: required or EGP-only? | No | Build currency-capable, launch EGP-only | Product + Finance | Phase 5 |

---

## `PG-D-01` — Canonical backend owner

**Question.** Is the Node trail the sole backend, is the Rust trail retained
alongside it, or is Rust made canonical?

**Why it matters.** Exactly one service may own the schema and run migrations.
Two owners means two migration histories and a deploy-time race. This decision
also determines the migration tool, the role model, whether OpenAPI plus contract
tests become mandatory, and whether six open `High` findings are *fixed* or
*deleted*. **No migration file may be authored until it is answered.**

**Options.**

| | Option | Consequence |
|---|---|---|
| A | Retire Rust | One trail; 6 High findings close by deletion; simplest role model; Phase 1 starts immediately |
| B | Retain both, Node canonical | Rust becomes a read-mostly consumer needing `sqlx`, its own narrow role, OpenAPI, and contract tests **before** Phase 1 |
| C | Rust canonical, retire Node | Discards 153 passing tests and every Wave 0 fix. Not seriously proposed |

**Recommendation: A — retire the Rust trail.** Stated strongly. Wave 0 fixed
seven findings in Node and none of the equivalents in Rust, so the trails are
further apart now than at the audit date. The Rust trail has **zero HTTP-level
tests**, and six of the eight open `High` findings live in it. Retention converts
a one-time deletion into a permanent two-implementation tax on every phase.

**Evidence needed.** Whether any stakeholder requires Rust for a stated
non-functional reason; whether any deployed client depends on the Rust endpoints;
the cost of maintaining contract parity if B is chosen.

**Owner.** CTO / Head of Engineering. **Milestone.** Phase 0.1 — blocks all
subsequent work.

---

## `PG-D-02` — Hosting and PostgreSQL major version

**Question.** Which managed provider, which major version, and does the schema
depend on any extension?

**Why it matters.** Extension availability varies sharply between providers —
requesting `timescaledb` (as `schema.sql` line 8 does today) eliminates several
otherwise-suitable managed offerings. Version determines whether `uuidv7()` is
available natively (PostgreSQL 18+) and which partitioning improvements apply.
CI must pin the **exact** same version.

**Options.** Managed cloud PostgreSQL (RDS/Aurora, Cloud SQL, Azure Database);
managed specialist (Neon, Supabase, Crunchy); self-hosted.

**Recommendation.** Managed PostgreSQL, version 17, **with no extension
dependency**. Application-generated UUIDv7 (blueprint §2.1) removes the need for
`uuid-ossp`; native partitioning removes the need for `timescaledb`. A schema
that requires no extensions is portable between providers, which is worth
preserving before the platform is locked in.

**Evidence needed.** Data-residency requirements (Egypt-region availability is a
real constraint for this product); budget; existing cloud commitments; whether
the team can operate self-hosted PostgreSQL — the honest answer, given there is
no deployment tooling at all today (`DSO-04`, `DSO-05`), is no.

**Owner.** SRE lead. **Milestone.** Phase 0.2.

---

## `PG-D-03` — Organization ↔ farm cardinality

**Question.** Is `organizations` a real tenancy root, or is `farms` sufficient?
If real: can a farm belong to more than one organization? Can a user belong to
more than one organization?

**Why it matters.** It determines whether every tenanted table carries one key or
two, and therefore the shape of every RLS policy. **Changing it after Phase 2 is
a rewrite of every policy and every index.** The current code has no organization
concept at all — `farms` is the only root, and the demo has exactly one farm
(`f-1`), which has allowed the question to remain unasked.

**Options.**

| | Option | Assessment |
|---|---|---|
| A | Farm-only tenancy | Simplest. But billing, subscriptions, and platform administration have no home, and a co-operative with five farms cannot be modelled |
| B | Organization → 1:N farms; user belongs to one org | **Recommended.** Matches the existing subscription model (subscription binds to a farm, billing belongs above it) |
| C | Many-to-many everywhere | Maximum flexibility, substantially more complex RLS. Needs a real requirement |

**Recommendation: B.** A user may hold memberships in multiple farms **within**
their organization; cross-organization access requires the `platform_operator`
mechanism (security model §2.3).

**Evidence needed.** Whether a real customer is a co-operative or multi-farm
enterprise; whether an agronomist consultant serves farms across organizations —
this is the case most likely to force C, and the marketplace/consultation feature
suggests it may already be a requirement. **This deserves a direct product
answer, not an engineering assumption.**

**Owner.** Product owner with engineering. **Milestone.** Phase 0.2.

---

## `PG-D-04` — Connection pooling mode

**Question.** Is PgBouncer (or the provider's pooler) used, and in which mode?

**Why it matters.** RLS context is set with `SET LOCAL` inside a transaction. In
**session** pooling a plain `SET` would persist on the physical connection and be
inherited by the next request — potentially a different tenant. **This is a
cross-tenant data leak created by the mechanism intended to prevent one.** It is
the highest-severity operational hazard in this design.

**Options.** Application-side pool only; PgBouncer transaction mode; PgBouncer
session mode (**incompatible with this design as written**); provider pooler
(mode must be confirmed, not assumed).

**Recommendation.** Transaction pooling, with `SET LOCAL` strictly inside
`withTransaction`, plus the mandatory pooled-connection leak test (security model
§9, test 7). If session pooling is unavoidable, the RLS context mechanism must be
redesigned — most likely to pass tenancy as an explicit query parameter — and
that redesign must happen **before** Phase 1, not after.

**Evidence needed.** Provider pooler defaults; whether prepared statements are
needed (transaction pooling restricts them); measured connection counts.

**Owner.** SRE lead. **Milestone.** Phase 0.2, verified by test in Phase 1.

---

## `PG-D-05` — TimescaleDB or native partitioning

**Question.** Adopt TimescaleDB, or native declarative partitioning?

**Why it matters.** `schema.sql` line 8 requests `timescaledb` **today**, before
any telemetry table exists to justify it. The extension constrains hosting
choices immediately and permanently.

**Options.** Native monthly `RANGE` partitioning; TimescaleDB hypertables;
partitioning plus a separate time-series store.

**Recommendation.** Native. Projected volume — a few hundred devices at 1-minute
resolution — is single-digit millions of rows per month, which stock PostgreSQL
handles unremarkably with a correct `(device_id, time DESC)` index. Adopt
Timescale only on **measured** evidence: sustained ingest above ~50k rows/s,
continuous aggregates that materialised views cannot meet, or compression
economics demonstrated with real numbers.

**Evidence needed.** Actual device count and sampling interval. Neither appears
anywhere in the requirements documents — the telemetry design is currently based
on a 48-hour demo fixture.

**Owner.** Engineering lead. **Milestone.** Phase 4 — but **remove the extension
from `schema.sql` in Phase 0** regardless.

---

## `PG-D-06` — Redis now or later

**Question.** Introduce Redis in the target architecture?

**Why it matters.** A second stateful system carries its own security, persistence,
and failure semantics. Adding it before it is needed is a permanent operational
cost.

**Options.** No Redis; Redis for cache and rate limiting; Redis for pub/sub only.

**Recommendation.** Later. Every current need has a sufficient PostgreSQL answer
at this scale. The **most likely first trigger is WebSocket fan-out across
instances** for chat — that is a genuine architectural need Postgres does not
serve well, and it will arrive before any caching need does.

**Evidence needed.** Instance count at launch; whether chat requires cross-instance
delivery on day one; measured database CPU attributable to rate-limit checks.

**Owner.** Engineering lead. **Milestone.** Phase 3.

---

## `PG-D-07` — Plot and area hierarchy depth

**Question.** How many levels of spatial subdivision below a farm, and are they
required at launch?

**Why it matters.** The task requires `plots` and `areas`. Neither exists in
code. Today's equivalents are unvalidated free text — `Tree.sector = 'A'`,
`Video.areaTag`, `Schedule.payload.areas = ['row-12']`. Choosing a depth
determines foreign keys across tasks, issues, trees, videos, and devices.

**Options.** Flat (farm → area); three levels (farm → plot → area); arbitrary
recursion via a self-referencing tree.

**Recommendation.** Three levels. Recursive hierarchies are appealing and make
every containment query recursive, every RLS policy more expensive, and every UI
harder. Adopt recursion only if a real customer structure demands it.

**Evidence needed.** How customers actually describe their land; whether "row-12"
is an area or a label within one; whether trees attach to areas or only to farms.

**Owner.** Product owner. **Milestone.** Phase 2.

---

## `PG-D-08` — Telemetry retention and PITR window

**Question.** How long is raw telemetry kept, at what resolution, and what is the
point-in-time-recovery window?

**Why it matters.** Retention drives storage cost and partition strategy. PITR
drives backup cost and the recovery guarantee. Both need an owner willing to
accept the cost.

**Options.** 30 / 90 / 365 days raw; aggregates 1–7 years; PITR 7 / 30 days.

**Recommendation.** 90 days raw, hourly and daily aggregates retained
long-term, 30-day PITR. Aggregates are what reporting actually reads; raw data
past 90 days is rarely queried and is the bulk of the cost.

**Evidence needed.** Any regulatory or contractual retention obligation for
irrigation and energy records; whether year-over-year raw comparison is a stated
product feature; storage budget.

**Owner.** Product owner with SRE. **Milestone.** Phase 4.

---

## `PG-D-09` — Robot and mission model

**Question.** Are robots a distinct entity with missions, or a device type with
schedules?

**Why it matters.** `docs/ROBOT_INTEGRATION_SPEC.md` exists, but the code has
only `DeviceType = 'robot'` and `Schedule.kind = 'robot_mission'` with an
untyped `payload`. Building `robots` and `robot_missions` on a specification with
no implementation risks modelling something the eventual integration contradicts.

**Options.** Device type + schedules (current); distinct entities now; defer
until a real integration exists.

**Recommendation.** Defer to Phase 4 and revisit against an actual vendor
integration. Modelling ahead of a hardware contract usually produces a schema
that must be rewritten.

**Evidence needed.** Whether a robot vendor is selected; whether missions need
paths (which would trigger the PostGIS conditions in architecture §2.8).

**Owner.** Product owner. **Milestone.** Phase 4.

---

## `PG-D-10` — Gapless invoice numbering

**Question.** Do invoices require gapless sequential numbering per organization?

**Why it matters.** If yes, `bigserial` **cannot** be used — sequences gap on
rollback. Gapless numbering requires a counter row updated inside the issuing
transaction, which serialises invoice creation per organization. That is a real
throughput constraint, and it is the wrong thing to discover after launch.

**Options.** Non-gapless; gapless per organization; gapless per organization per
year.

**Recommendation.** **Confirm the requirement before building it.** Gapless
numbering is a legal requirement in many jurisdictions and an expensive
non-requirement in others. Egypt-specific invoicing rules must be checked by
someone qualified — this is not an engineering judgement.

**Evidence needed.** Egyptian e-invoicing requirements; whether the platform
issues invoices itself or delegates to a payment provider; auditor expectations.

**Owner.** Finance / legal. **Milestone.** Phase 5.

---

## `PG-D-11` — Firestore channel: remove or audit

**Question.** Is the mobile Firestore channel removed, or committed with audited
rules?

**Why it matters.** **This is a security blocker, not a preference.**
[mobile-app/src/config/firebase.ts](../mobile-app/src/config/firebase.ts)
initialises a second, independent persistence channel (`initializeApp` line 46,
`getFirestore` line 59) with placeholder config and **no committed security
rules**. Every control in
[POSTGRESQL_SECURITY_MODEL.md](POSTGRESQL_SECURITY_MODEL.md) is void while a
second door exists. This is threat T8 and finding `SEC-M13`.

**Options.** Remove the channel and its dependencies; retain and commit audited
rules; retain read-only for a specific feature.

**Recommendation. Remove.** Retention means maintaining and auditing a second
authorization model in a different technology, permanently, for a feature the
REST API already serves.

**Evidence needed.** Whether any shipped mobile build depends on it; whether a
Firebase project actually exists behind the placeholder config, and if so what it
currently contains.

**Owner.** Security lead. **Milestone.** **Before Phase 2 completes.**
PostgreSQL cannot be called *the* system of record until this is resolved.

---

## `PG-D-12` — Erasure, redaction, and regulatory regime

**Question.** Which data-protection regime applies, and what is the erasure
policy for personal data held in an immutable audit trail?

**Why it matters.** Two requirements collide directly: audit immutability
(`REVOKE DELETE`, hash-chained) and a subject's right to erasure. The resolution —
redact personal fields while retaining the audit skeleton — must be a documented
policy, not an engineer's improvisation during an incident. It also determines
whether column-level encryption becomes necessary (security model §3.2).

**Options.** Egyptian PDPL only; PDPL + GDPR (any EU subject); contractual only.

**Recommendation.** Establish the policy **before** the first production personal
record exists. Design for redaction-with-audit-retention as the default, since it
satisfies most regimes without breaking the hash chain.

**Evidence needed.** Whether EU or UK subjects will use the platform; whether
expert marketplace participants are international — the `ExpertProfile.country`
and `languages` fields suggest they are, which likely pulls GDPR into scope.

**Owner.** Legal with security lead. **Milestone.** Phase 5, policy needed
earlier.

---

## `PG-D-13` — Anonymisation timing for learning cases

**Question.** Are published learning cases anonymised at publish time, or at read
time as the current model states?

**Why it matters.** `LearningCase.anonymized` carries the comment *"Anonymization
rules applied AT READ TIME: mask names/geo."* Read-time masking means every read
path must remember to apply it — and one that forgets leaks a real farmer's name
and location into published educational content. The `snapshot` field is already
described as a frozen copy, so the safer option is largely available.

**Options.** Read-time masking (current); publish-time anonymisation into the
snapshot; both.

**Recommendation.** Publish-time, into the frozen snapshot. Fail-safe rather than
fail-open. Retain the source linkage separately for internal traceability, under
normal tenancy controls.

**Evidence needed.** Whether de-anonymisation is ever needed post-publication;
whether consent is obtained from the originating farm.

**Owner.** Product owner with security lead. **Milestone.** Phase 5.

---

## `PG-D-14` — Message delivery receipts

**Question.** Are per-recipient delivery and read receipts a requirement?

**Why it matters.** `message_deliveries` is a row **per message per recipient** —
the largest-cardinality table in the communication domain, larger than `messages`
by the average group size. Building it speculatively is expensive; retrofitting
it is also expensive. It needs a product answer either way.

**Options.** None; read receipts only; full delivery + read.

**Recommendation.** Defer. Ship without receipts and add them when a user asks,
unless the product explicitly promises them.

**Evidence needed.** Whether the mobile UI already displays receipt state;
expected group sizes.

**Owner.** Product owner. **Milestone.** Phase 3.

---

## `PG-D-15` — Object-storage provider

**Question.** Which object store backs `media_objects`?

**Why it matters.** Phase 3 cannot complete without one. It also determines
signed-URL semantics, server-side encryption options, and lifecycle-rule support
for retention.

**Options.** AWS S3; Google Cloud Storage; Azure Blob; S3-compatible (MinIO,
Cloudflare R2) self-hosted or managed.

**Recommendation.** Any S3-compatible store, accessed through a provider-agnostic
interface in the media repository. Keeping the interface narrow — put, sign-get,
delete, head — preserves the ability to change provider without touching business
code. Local disk remains a development adapter only.

**Evidence needed.** Data residency (same constraint as `PG-D-02`); egress cost
projections given video is in scope; whether the CDN and object store should be
the same vendor.

**Owner.** SRE lead. **Milestone.** Phase 3.

---

## `PG-D-16` — Multi-currency

**Question.** Is the platform EGP-only, or must it handle multiple currencies?

**Why it matters.** The current model hardcodes EGP in **column and field names** —
`amount_egp NUMERIC(10,2)` (`schema.sql` line 136), `monthlyEgp`, `bountyEgp`,
`netPayoutEgp`, `totalEarnedEgp`. The blueprint replaces these with
`amount_minor` + `currency` (§2.11). If multi-currency is genuinely required,
conversion records, rate sourcing, and rate-at-time-of-transaction storage are
also required — a substantially larger scope.

**Options.** EGP-only forever; currency-capable schema, EGP-only at launch; full
multi-currency with conversion.

**Recommendation.** **Currency-capable schema, EGP-only at launch.** The schema
change is nearly free now and expensive later; the conversion machinery is
expensive now and can wait. Note that the expert marketplace with international
participants (`ExpertProfile.country`, `languages`) makes full multi-currency
more likely than it first appears — payouts to a non-Egyptian expert are the
scenario to test this against.

**Evidence needed.** Whether experts outside Egypt are paid through the platform;
whether subscriptions are sold outside Egypt.

**Owner.** Product owner with finance. **Milestone.** Phase 5.

---

## Blocking summary

**Five decisions block work:**

| ID | Blocks |
|---|---|
| `PG-D-01` | **Every migration file.** Nothing may be authored |
| `PG-D-02` | Migration tooling, CI version pinning, extension policy |
| `PG-D-03` | Every RLS policy and every tenanted index |
| `PG-D-04` | The RLS context mechanism itself |
| `PG-D-11` | The claim that PostgreSQL is *the* system of record |

`PG-D-01` through `PG-D-04` are gating on Phase 0. `PG-D-11` gates the completion
of Phase 2.

**None of these is an engineering-only decision.** `PG-D-01` is a strategic
resourcing question, `PG-D-03` is a product question, and `PG-D-11` is a security
governance question. That is why they are recorded here rather than resolved by
this document.
