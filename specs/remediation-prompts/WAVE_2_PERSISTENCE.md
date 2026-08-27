# Wave 2 — Persistence and Database Foundation

> **Implementation prompt.** Planning artefact — no production file modified in
> producing it.

---

## 1. Role

You are a principal backend and database architect. Your mandate is to replace
volatile in-memory state with a durable, transactional, tenant-aware persistence
layer — **without** carrying forward the defects of the existing unexecuted schema.

---

## 2. Objective

1. Execute the canonical-backend decision.
2. Stand up PostgreSQL as the system of record.
3. Introduce a migration framework and a repository layer with explicit transactions.
4. Design a tenant-aware schema with row-level security.
5. Make audit events durable and append-only.
6. Migrate or deliberately discard existing in-memory data.

---

## 3. Verified findings in scope

| ID | Finding | Evidence | Status |
|---|---|---|---|
| **VAL-017** | No persistence layer | No driver in either manifest; `store.ts` / `store.rs` are `Map`/`HashMap` | Confirmed |
| **SEC-M08** | Audit log not durable, mutable, sparse coverage | In-memory array | Confirmed |
| — | `db/migrations/` referenced but absent | Directory does not exist | Confirmed |
| — | `db/schema.sql` never executed and **unexecutable** | Requires an extension for which no table exists | Confirmed |
| **SCH-01** | No `organizations` table | Absent | Carried forward |
| **SCH-02** | Nullable FKs, no referential actions | Carried forward | Not re-verified |
| **SCH-03** | No row-level security | Absent | Carried forward |
| **SCH-15** | `CHECK` constraints permit `NULL` state | Carried forward | Not re-verified |

> **Schema defects SCH-01 to SCH-15 were not re-verified in the validation pass.**
> Re-read `db/schema.sql` and confirm each before acting. Do not carry an
> unverified defect list into a schema design.

---

## 4. Files and components in scope

| File | Change |
|---|---|
| `webapp/server-node/db/schema.sql` | **Rewrite** — do not migrate the current file |
| `webapp/server-node/db/migrations/` | **Create** — does not exist |
| [webapp/server-node/src/store.ts](webapp/server-node/src/store.ts) | Formalise into a repository interface |
| `webapp/server-node/src/repository/` (new) | PostgreSQL adapter, in-memory adapter |
| [webapp/server-node/src/audit.ts](webapp/server-node/src/audit.ts) | Durable append-only writes |
| All route modules | Route through the repository; wrap multi-step writes in transactions |
| `webapp/server-node/package.json` | Driver and migration tool |
| [.github/workflows/ci.yml](.github/workflows/ci.yml) | Database service container for integration tests |
| `webapp/server-rust/` | Archived, or given its own adapter |

---

## 5. Explicit exclusions

| Excluded | Reason |
|---|---|
| **TimescaleDB** | The current schema hard-depends on it at line 8 for a schema with **no time-series table**. It blocks local development for zero benefit. Adopt only when measured ingest justifies it |
| **PostGIS** | No geospatial *query* exists anywhere. Adding it later is a routine migration |
| Redis | Only when a second replica actually exists |
| MQTT broker | No device, vendor, or protocol chosen — Wave 4 at the earliest |
| Analytics warehouse | Not at this scale |
| Application security fixes | Wave 3 |
| Executing the current `schema.sql` | It is unexecutable and its key type is incompatible with the application's own identifiers |

---

## 6. Prerequisites

| # | Prerequisite | Blocking |
|---|---|---|
| 1 | Wave 1 complete; authorization surface stable | **Yes** |
| 2 | **D-1 executed** — canonical backend chosen and acted on | **Yes** |
| 3 | **D-2 answered** — is `organizations` above `farms`? | **Yes** — defines the tenancy key on every table |
| 4 | **D-6** — retention periods and applicable jurisdictions | Partial — blocks retention columns |
| 5 | Business decision: is current in-memory data real or demo? | **Yes** — determines whether migration is needed at all |
| 6 | Deployment target for the database instance | **Yes** |

> **Prerequisite 5 is frequently the cheapest win in this wave.** If the current
> data is entirely demo content, discarding it is correct and removes the highest-
> risk part of the migration.

---

## 7. Required implementation sequence

```
2.1  Confirm schema defects against the real file
2.2  Design the target schema (tenant-aware)
2.3  Provision PostgreSQL (dev, staging, prod)
2.4  Migration framework + first migration
2.5  Repository interface + in-memory adapter (behaviour parity)
2.6  PostgreSQL adapter
2.7  Transactions for multi-step writes
2.8  Durable append-only audit
2.9  Row-level security
2.10 Data migration or documented discard
2.11 Re-run the Wave 1 denied-access matrix against the persistent store
```

### Task 2.1 — Confirm defects

Re-read `db/schema.sql` and verify each of SCH-01 to SCH-15 with a line citation.
Discard any that do not hold.

### Task 2.2 — Target schema design

Required characteristics:

| Characteristic | Decision |
|---|---|
| Primary keys | **UUID v7, application-generated.** The current schema's `UUID` columns cannot hold the app's own `u-owner` / `t-1` identifiers — this alone makes the existing file unusable |
| Tenancy | `org_id` **and** `farm_id`, `NOT NULL`, on every tenant-scoped table |
| Foreign keys | `NOT NULL` where mandatory; explicit `ON DELETE RESTRICT`, `CASCADE` only for owned children |
| State columns | `NOT NULL` **plus** `CHECK` — a `CHECK` alone permits `NULL` |
| Concurrency | `version INTEGER NOT NULL DEFAULT 0`, checked on write |
| Money | `NUMERIC(14,2)` **plus** an explicit `currency` column; integer minor units in the application |
| Time | `TIMESTAMPTZ`, UTC stored, farm-local rendered |
| Soft delete | `deleted_at` with partial indexes excluding deleted rows |
| Indexes | Every FK; every tenant key; `(farm_id, status)` on tasks; `(conversation_id, created_at)` on messages |
| Audit | Append-only; `REVOKE UPDATE, DELETE`; hash chain |
| Idempotency | `idempotency_keys(key, endpoint, request_hash, response, created_at)` |
| Outbox | `outbox_events` written in the same transaction as the state change |
| Telemetry | Native declarative partitioning by month — **no Timescale dependency** |

**Mark uncertain relationships as open decisions. Do not invent a model the
requirements do not support.**

### Task 2.5 — Repository interface

`store.ts` is already a usable seam — module-level functions over maps. Formalise
it into an interface with an explicit `withTransaction` boundary. **Keep the
in-memory adapter**: it is what allows unit tests to run offline and fast.

### Task 2.7 — Transactions

Known non-atomic sequences that must become transactional:

- `advanceIssue` — issue mutation + event append + audit
- Task status change + audit
- Finance mutation + audit
- Subscription assignment + audit

### Task 2.9 — Row-level security

Enable RLS with policies keyed to a session variable set per transaction. Connect
as a **non-superuser** role.

> **The definitive RLS test:** remove the application-level filter in a test and
> assert the query returns nothing. If it returns rows, RLS is not working.

### Task 2.10 — Data migration

If prerequisite 5 says the data is real: export, transform identifiers to UUID v7,
load, reconcile counts, verify. If demo: **document the discard decision and its
approver**, then proceed.

---

## 8. Security invariants

| # | Invariant |
|---|---|
| **I-1** | Data written before a restart is readable after it |
| **I-2** | No route bypasses the repository layer to reach storage directly |
| **I-3** | Multi-step state changes are atomic |
| **I-4** | Audit records cannot be updated or deleted by the application role |
| **I-5** | RLS blocks cross-tenant reads **even when the application filter is removed** |
| **I-6** | No tenant-scoped row exists with a `NULL` tenancy key |
| **I-7** | Every migration has a tested backward path |
| **I-8** | Wave 0 and Wave 1 invariants continue to hold |

---

## 9. Exact expected code changes by file and symbol

| File | Symbol | Change |
|---|---|---|
| `db/schema.sql` | entire file | Rewritten per task 2.2; Timescale extension removed |
| `db/migrations/*` | new | Versioned, forward and backward |
| `src/repository/index.ts` | `Repository`, `withTransaction` | New interface |
| `src/repository/memory.ts` | adapter | Extracted from `store.ts` |
| `src/repository/postgres.ts` | adapter | New |
| `src/store.ts` | all exports | Delegate to the active adapter |
| `src/audit.ts` | `audit`, `listAudit` | Durable, append-only, hash-chained |
| `src/issues.ts` | `advanceIssue` | Wrapped in a transaction |
| `src/routes/tasks.ts` | status change | Wrapped in a transaction |
| `src/routes/farmsFinance.ts` | ledger mutation | Wrapped in a transaction |
| `package.json` | dependencies | Driver + migration tool — **justify each addition** |
| `.github/workflows/ci.yml` | `server-node` job | Database service container |

---

## 10. Secure structured logging

| Event | Level | Fields | Never log |
|---|---|---|---|
| Migration applied | info | version, direction, duration | connection string |
| Transaction rollback | warn | operation, reason class | row contents |
| RLS policy denial | **warn + alert** | table, tenant context | row contents |
| Pool saturation | warn | in-use, waiting, max | credentials |
| Audit write failure | **error + alert** | event type | payload |

**Never log connection strings, credentials, or row-level personal data.**

---

## 11. Tests to write before or with the changes

- Repository interface conformance — same suite passes against both adapters
- Restart durability: write, restart, read
- Transaction rollback on partial failure
- Audit append-only: `UPDATE` and `DELETE` rejected for the application role
- Audit hash-chain continuity detects tampering
- **RLS with the application filter removed returns nothing**
- `NULL` tenancy key rejected by constraint
- Optimistic locking: concurrent update rejected on stale version
- Migration forward, backward, and idempotent re-run
- **Restore rehearsal after migration**
- Full Wave 1 denied-access matrix re-run against PostgreSQL

---

## 12. Commands to run

```powershell
cd webapp/server-node
npm run check
npm run test                 # unit — in-memory adapter
npm run test:coverage
npm run test:integration     # new — against a real database

# Migrations (never against production from a workstation)
npm run migrate:up
npm run migrate:down
npm run migrate:up

# NOTE: `npm run schema:apply` targets the OLD file. Retire it in this wave.
```

---

## 13. Expected output

| Command | Expected |
|---|---|
| `npm run check` | Exit 0 |
| `npm run test` | Exit 0; all prior tests pass unchanged against the in-memory adapter |
| `npm run test:integration` | Exit 0 against a real database |
| `migrate:up` / `down` / `up` | Exit 0 each time; schema identical after the round trip |
| `npm run test:coverage` | Exit 0; raise thresholds after tests land |

---

## 14. Verification checklist

- [ ] D-1 executed; a single canonical backend owns migrations
- [ ] D-2 answered; tenancy key present and `NOT NULL` on every scoped table
- [ ] Old `schema.sql` **not** executed; new schema reviewed
- [ ] `db/migrations/` exists with a tested backward path
- [ ] Data survives restart
- [ ] RLS blocks cross-tenant reads with the application filter removed
- [ ] Audit is durable, append-only, and hash-chained
- [ ] Multi-step writes are atomic
- [ ] Integration tests run against a real database in CI
- [ ] Data migration completed **or** discard decision documented and approved
- [ ] Restore rehearsal performed and recorded

---

## 15. Regression checklist

- [ ] Every Wave 0 and Wave 1 test passes
- [ ] Denied-access matrix passes against PostgreSQL
- [ ] Task, issue, chat, finance, upload flows behave identically
- [ ] Response latency measured and acceptable
- [ ] No route reaches storage outside the repository

---

## 16. Rollback plan

| Task | Rollback |
|---|---|
| 2.4–2.6 | Switch the adapter back to in-memory via configuration |
| 2.7 | Revert transaction wrappers |
| 2.9 | Disable RLS policies; application checks remain |
| 2.10 | **Migration rollback must be tested before cutover, not assumed** |

**Cutover:** dual-read with the in-memory adapter as fallback, then switch. Keep
the fallback until integration tests have run clean in staging for a full cycle.

> **This is the highest-risk wave in the programme.** It is the only one likely to
> require a maintenance window.

---

## 17. Evidence to capture

Under `specs/evidence/wave-2/`:

1. Re-verified SCH defect list with line citations
2. Reviewed schema and migration files
3. Restart-durability demonstration
4. **RLS proof: query with the application filter removed returning zero rows**
5. Migration round-trip output
6. **Restore rehearsal record with timing**
7. Denied-access matrix results against PostgreSQL
8. Data migration reconciliation counts, or the signed discard decision
9. Latency comparison, before and after

---

## 18. Acceptance criteria

1. All invariants in §8 hold.
2. Data survives restart in every environment.
3. RLS proven with the application-filter-removed test.
4. Audit durable, append-only, tamper-evident.
5. Migrations run forward and backward with tests.
6. Restore rehearsed and recorded.
7. Wave 1 matrix passes unchanged against the new store.
8. Security and architecture review sign-off.

---

## 19. Stop conditions

| Condition | Action |
|---|---|
| D-1 or D-2 unanswered | **Stop.** Do not design a schema around a guess |
| Anyone proposes running the existing `schema.sql` | **Stop.** It is unexecutable and its key type is incompatible |
| TimescaleDB or PostGIS proposed for launch | **Stop.** Explicitly excluded; require a measured justification |
| Backward migration untested | **Stop before cutover** |
| RLS test passes with the filter removed *returning rows* | **Stop.** RLS is not working |
| Migration reconciliation counts mismatch | **Stop.** Do not cut over on unreconciled data |
| Latency regresses materially | **Stop.** Profile before proceeding |

---

## 20. Handover to Wave 3

| Deliverable | Consumed by |
|---|---|
| Durable storage | Media metadata records, session lifecycle, rate-limit state |
| Repository + transactions | Input-validation persistence paths |
| Durable audit | Wave 5 forensic verification |
| Idempotency table | Request-limit and webhook work in Wave 4 |
| Integration test harness | All later waves |

**Open questions carried forward:** retention periods (D-6), organisation model
detail, whether a read replica is needed — **measure before adding one**.
