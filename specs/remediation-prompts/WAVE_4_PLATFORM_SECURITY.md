# Wave 4 — Platform and Integration Security

> **Implementation prompt.** Planning artefact — no production file modified in
> producing it.

---

## 1. Role

You are a platform security engineer and integration architect covering CI/CD,
supply chain, device integration, payments, storage, and recoverability.

---

## 2. Objective

1. Establish device identity for IoT telemetry and commands.
2. Apply safety controls to valve and robot command paths.
3. Secure payment and webhook handling **when that work begins**.
4. Move media to object storage with signed access.
5. Activate CI/CD security gates.
6. Manage dependency and supply-chain risk.
7. Implement backup and **rehearsed** restore.

---

## 3. Verified findings in scope

| ID | Severity | Finding | Status |
|---|---|---|---|
| **VAL-019** | High | `@fastify/static@8.3.0` — known advisory | Confirmed |
| **VAL-018** | High | No root git repository | Contained in Wave 0; CI activation completes it |
| **SEC-M03** | Medium | Devices authenticate with an admin token; no per-device identity | Confirmed |
| **DSO-02** | High | Secret scanning absent | Confirmed |
| **DSO-03** | High | SAST absent | Confirmed |
| **DSO-04** | Medium | No SBOM or provenance | Confirmed |
| **DSO-11** | High | No backup or restore procedure | Confirmed |
| **BL-11 / BL-12** | — | Valve and robot commands are fire-and-forget | Confirmed |
| **Payments** | — | **Documented only — no code exists.** This is design-time work, not remediation | Confirmed |

> **Payments are entirely unimplemented.** Treat §7 task 4.4 as *requirements to
> apply when payment code is written*. Do not report payment security as
> "remediated" — there is nothing yet to remediate.

---

## 4. Files and components in scope

| File | Change |
|---|---|
| [.github/workflows/ci.yml](.github/workflows/ci.yml) | Activate; add security gates |
| `.github/workflows/security.yml` (new) | Scheduled scanning |
| `webapp/server-node/package.json` | `@fastify/static` major upgrade |
| `webapp/server-node/src/routes/` | Device identity; command lifecycle |
| `webapp/server-node/src/storage/` (new) | Object storage adapter |
| `webapp/server-rust/Cargo.toml` | `cargo audit` — **only if D-1 retained the trail** |
| `docs/` | Backup and restore runbook |

---

## 5. Explicit exclusions

| Excluded | Reason |
|---|---|
| **SEC-H05, SEC-H07, SEC-H08, SEC-H10** | **Not re-verified during validation.** Verify first; do not implement on an unverified claim |
| Payment *implementation* | No payment code exists; only the security requirements are in scope |
| MQTT broker deployment | No device, vendor, or protocol selected |
| Multi-region or DR failover | Premature at this scale |
| Penetration testing | Wave 5 |
| Application-layer fixes | Wave 3 — completed |

---

## 6. Prerequisites

| # | Prerequisite | Blocking |
|---|---|---|
| 1 | Waves 0–3 complete | **Yes** |
| 2 | Root git repository with a remote — **so CI can actually run** | **Yes** |
| 3 | Durable storage (Wave 2) | **Yes** for device and command state |
| 4 | **D-4: object storage provider** | **Yes** for task 4.5 |
| 5 | Device hardware or a vendor specification | **Yes** for tasks 4.2 and 4.3 |
| 6 | Payment provider selected | Only for task 4.4 |
| 7 | Backup destination and retention approved | **Yes** for task 4.8 |

> **Prerequisite 2 is the hinge of this wave.** CI has never executed. Every gate
> below is theatre until a remote exists.

---

## 7. Required implementation sequence

```
4.1  Activate CI and add security gates      ← protects all later work
4.2  Device identity
4.3  Command safety controls
4.4  Payment and webhook security requirements
4.5  Object storage with signed access
4.6  Dependency and supply-chain management
4.7  @fastify/static major upgrade (SHIPPED ALONE)
4.8  Backup and rehearsed restore
```

### Task 4.1 — CI activation and gates

The workflow exists and its own header states it has never executed. Push to a
remote, confirm it runs, then add:

| Gate | Requirement |
|---|---|
| Secret scanning | **Must cover `webapp/server-rust/`.** A JavaScript-only pattern would have missed VAL-001 entirely — the finding that started this programme |
| SAST | Node, client, and Rust if retained |
| Dependency scanning | Fails the build on High and above |
| SBOM | Generated per build, retained as an artefact |
| Coverage gate | Enforced, not advisory |
| Branch protection | Required reviews; no direct pushes to the default branch |

Keep `permissions: contents: read`. Pin actions by commit SHA.

### Task 4.2 — Device identity

Devices currently present an admin token — **one leaked device yields
administrative access**. Issue per-device credentials with a device registry,
scoped permissions limited to that device's own telemetry and commands, rotation,
and revocation. Reject any device request bearing a user token.

### Task 4.3 — Command safety

Valve and robot commands are fire-and-forget. For an irrigation valve, a lost
"close" command means an unbounded open valve.

Required: acknowledgement, timeout with an explicit failure state, a **safe
offline default (closed)**, command idempotency using the Wave 2 table, a full
audit trail, and rate limits per device.

### Task 4.4 — Payment security requirements

Record as binding requirements for when implementation begins:

- Webhook signature verification with a constant-time comparison
- Replay protection with a timestamp window and event-id deduplication
- Idempotent processing
- No card data on our servers — provider-hosted only
- Entitlement changes written transactionally with the payment record
- Refunds and chargebacks audited
- Reconciliation against provider records

### Task 4.5 — Object storage

Move media off the local filesystem. Server-side encryption; private buckets;
short-lived signed URLs issued **only after** the Wave 3 authorization check;
lifecycle rules from D-6; versioning for accidental deletion.

### Task 4.6 — Supply chain

Automated dependency updates; a documented triage SLA by severity; `npm audit`
and `cargo audit` in CI; lockfiles committed and verified; a policy for adding
new dependencies.

### Task 4.7 — `@fastify/static` upgrade

**Ship this alone, in its own change set.** It is a major version bump — 8.x to
≥10.1.3 — with breaking changes. Combined with anything else, a regression becomes
ambiguous.

> If Wave 3 task 3.3 removed static serving for uploads, re-assess: the remaining
> exposure may be small, but the advisory still applies to any other use.

### Task 4.8 — Backup and restore

Automated encrypted backups, offsite, with access controls. **Restore must be
rehearsed on a schedule and timed.** An untested backup is not a backup. Document
RPO and RTO from measured rehearsal results, not aspiration.

---

## 8. Security invariants

| # | Invariant |
|---|---|
| **I-1** | No device authenticates with a user or admin token |
| **I-2** | A device credential grants access only to that device's resources |
| **I-3** | Every actuator command is acknowledged or explicitly failed |
| **I-4** | Loss of connectivity leaves actuators in a **safe** state |
| **I-5** | Webhooks are signature-verified and replay-protected |
| **I-6** | Signed URLs are short-lived and issued only after authorization |
| **I-7** | CI fails the build on a High or above finding |
| **I-8** | Secret scanning covers **every** language in the repository |
| **I-9** | A restore has been rehearsed and timed within the retention period |
| **I-10** | Waves 0–3 invariants continue to hold |

---

## 9. Exact expected code changes by file and symbol

| File | Symbol | Change |
|---|---|---|
| `.github/workflows/ci.yml` | jobs | Security gates; SHA-pinned actions |
| `.github/workflows/security.yml` | new | Scheduled scanning |
| `src/routes/devices.ts` | device auth | Per-device credentials |
| `src/routes/devices.ts` | command dispatch | Ack, timeout, idempotency, audit |
| `src/storage/objectStore.ts` | new | Adapter + signed URL issuance |
| `src/routes/media.ts` | delivery | Signed redirect after authorization |
| `package.json` | `@fastify/static` | `^10.1.3` — **alone** |
| `docs/BACKUP_RESTORE_RUNBOOK.md` | new | Procedure with measured RPO/RTO |

---

## 10. Secure structured logging

| Event | Level | Fields |
|---|---|---|
| Device auth failure | warn | device id, reason class |
| **User token presented on a device endpoint** | **warn + alert** | endpoint, token class |
| Command issued | info + audit | device, command, actor, idempotency key |
| **Command timeout** | **error + alert** | device, command, elapsed |
| **Safe-state fallback engaged** | **error + alert** | device, prior state |
| Webhook signature failure | **warn + alert** | provider, event id |
| Signed URL issued | info | media id, actor, TTL |
| Dependency scan finding | warn | package, severity, advisory |
| **Backup failure** | **error + alert** | target, error class |
| Restore rehearsal | info + audit | duration, verification result |

**Never log:** device secrets, webhook signing keys, storage credentials, signed
URLs in full, or payment identifiers.

---

## 11. Tests to write before or with the changes

- Device credential scoped to its own resources; foreign device data → 403
- User token on a device endpoint → 401
- Revoked device credential → immediate rejection
- Command acknowledgement recorded; unacknowledged command times out
- **Simulated connectivity loss leaves the valve closed**
- Duplicate command with the same idempotency key executes once
- Webhook: invalid signature → rejected; replayed event → ignored; duplicate id → processed once
- Signed URL expires; unauthorized request receives no URL at all
- CI: a planted test secret in a **Rust** file fails the build
- CI: a known-vulnerable dependency fails the build
- **Restore rehearsal: full cycle with data verification and timing**
- `@fastify/static` upgrade: full regression on static serving behaviour

---

## 12. Commands to run

```powershell
cd webapp/server-node
npm run check
npm run test
npm run test:coverage
npm run test:integration
npm audit --json | Out-File -Encoding utf8 ../../specs/evidence/wave-4/npm-audit.json

cd ../client
npx tsc --noEmit
npx vitest run
npm run build
npm audit --json | Out-File -Encoding utf8 ../../specs/evidence/wave-4/client-audit.json

cd ../server-rust      # only if D-1 retained the trail
cargo test
cargo audit

cd ../../mobile-app
npx vitest run
npm audit --json | Out-File -Encoding utf8 ../specs/evidence/wave-4/mobile-audit.json
```

> Redirect to files rather than reading truncated terminal output — a tail can
> hide findings that appear earlier in the output.

---

## 13. Expected output

| Command | Expected |
|---|---|
| `npm run check` | Exit 0 |
| `npm run test` | Exit 0; all prior tests plus device and command suites |
| `npm audit` | **Zero High or Critical.** Moderate documented with a triage decision |
| `cargo audit` | Zero High or Critical, or the trail is archived |
| CI run | **Green — and demonstrably executed, not merely defined** |
| Restore rehearsal | Completed within the documented RTO |

---

## 14. Verification checklist

- [ ] Root repository pushed; **CI observed running**
- [ ] Secret scanning covers Rust as well as JavaScript and TypeScript
- [ ] SAST, dependency scanning, and SBOM active
- [ ] Coverage gate enforced
- [ ] Branch protection configured
- [ ] Per-device identity; admin-token telemetry retired
- [ ] Commands acknowledged, timed out, and safe offline
- [ ] Payment security requirements recorded for future implementation
- [ ] Media in object storage behind signed URLs
- [ ] `@fastify/static` upgraded **in its own change set**
- [ ] Backups automated, encrypted, offsite
- [ ] **Restore rehearsed, timed, documented**

---

## 15. Regression checklist

- [ ] All Wave 0–3 tests pass
- [ ] Existing devices continue to report during credential migration
- [ ] Media loads for authorized users from object storage
- [ ] Static serving behaviour unchanged after the major upgrade
- [ ] CI runtime remains acceptable
- [ ] No developer workflow broken by branch protection

---

## 16. Rollback plan

| Task | Rollback |
|---|---|
| 4.1 | Set gates to advisory temporarily — **never remove them** |
| 4.2 | Dual-accept old and new credentials during migration; remove the old path only after all devices migrate |
| 4.3 | Revert to fire-and-forget **only if the safe default remains** |
| 4.5 | Dual-read from local and object storage during transition |
| 4.7 | **Straightforward revert precisely because it ships alone** |
| 4.8 | Additive; no rollback needed |

---

## 17. Evidence to capture

Under `specs/evidence/wave-4/`:

1. Screenshot or log of the **first successful CI run**
2. Planted-secret test result proving Rust coverage
3. SBOM artefacts
4. Audit output files for all four workspaces
5. Device credential scoping test results
6. **Command timeout and safe-state demonstration**
7. Signed URL expiry demonstration
8. `@fastify/static` upgrade regression results
9. **Restore rehearsal record with measured RPO and RTO**
10. Branch protection configuration

---

## 18. Acceptance criteria

1. All invariants in §8 hold.
2. CI has executed and enforces every gate.
3. Secret scanning proven to cover Rust.
4. Per-device identity in production; admin-token telemetry retired.
5. Actuator commands acknowledged with a safe offline default.
6. Media in object storage with short-lived signed access.
7. Zero High or Critical dependency findings.
8. Restore rehearsed within the documented RTO.
9. Payment requirements recorded and accepted.
10. Platform and security review sign-off.

---

## 19. Stop conditions

| Condition | Action |
|---|---|
| No root remote available | **Stop.** Every gate is unverifiable without it |
| Planted Rust secret not detected | **Stop.** Fix the scanner configuration |
| Safe-state test leaves a valve open | **Stop immediately.** This is a physical safety issue, not just security |
| `@fastify/static` upgrade bundled with other changes | **Stop.** Split it out |
| Restore rehearsal fails or exceeds RTO | **Stop.** The backup strategy is invalid |
| Device migration would strand devices | **Stop.** Extend the dual-accept window |
| Anyone proposes implementing SEC-H05/07/08/10 unverified | **Stop.** Verify first |

---

## 20. Handover to Wave 5

| Deliverable | Consumed by |
|---|---|
| Active CI with gates | Continuous verification |
| SBOM and scan results | Dependency review |
| Device and command controls | Integration security testing |
| Object storage | Storage access verification |
| Restore rehearsal | Recovery verification |
| Payment requirements | Residual-risk register — **explicitly unimplemented** |

**Open questions carried forward:** payment provider selection, device hardware
specification, retention periods (D-6), whether the Rust trail remains after D-1.
