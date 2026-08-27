# Architecture Decision Report

Decisions taken during Wave 0 remediation. Each is scoped to what was actually
implemented and verified; forward-looking items are marked **Proposed** and are
not claimed as done.

---

## Section A — Backend strategy

### ADR-ARCH-001 — Both backend trails receive every security fix
- **Context:** Two hand-written implementations of the same API exist
  (`server-node`, Fastify/TypeScript; `server-rust`, Axum). GAP-01 was present
  in both, byte-for-byte equivalent in behaviour.
- **Options:** (a) fix Node only and freeze Rust; (b) fix both; (c) delete one.
- **Decision:** (b) for Wave 0. (c) is the right long-term answer but is a
  stakeholder decision, not an engineering one.
- **Rationale:** Freezing a trail that still builds, still has routes, and still
  accepts registrations leaves a live privilege-escalation endpoint.
- **Negative consequence:** every future security change costs double.
- **Status:** Accepted. **Owner:** platform lead. **Review:** before Wave 2.

---

## Section B — Data architecture

### ADR-DATA-001 — `Task` gains a required `farmId`
- **Context:** `Task` had no tenancy field, so object-level authorization was
  literally undefinable — there was nothing to authorize *against*.
- **Decision:** add `farmId: string` as a required field; derive it server-side
  from the creator's farm membership; never accept it from the client unless the
  caller is a verified member of that farm.
- **Consequences:** seeded fixtures backfilled to `f-1`. Any future persistence
  schema must carry this column and index it — it is now on the hot read path.
- **Status:** Accepted, implemented, tested.

### ADR-DATA-002 — Persistence remains in-memory (deferred)
- **Context:** GAP-04. All state lives in `Map`s and is lost on restart.
- **Decision:** **not** addressed in this execution. No database instance is
  available and `db/schema.sql` has never been executed against one.
- **Consequence:** the platform cannot be piloted with real users. This is the
  primary reason for the NO-GO recommendation.
- **Status:** Deferred to Wave 2. **Blocked by:** infrastructure provisioning.

---

## Section C — Security architecture

### ADR-SEC-001 — Server-side role authority
- **Decision:** a role is only trusted after passing through
  `src/security/roles.ts` (Node) / `src/security.rs` (Rust). Route handlers must
  never cast a request field to `Role`.
- **Rationale:** the root cause of GAP-01 was trusting a compile-time type at
  runtime. TypeScript types are erased; Rust `String` fields are unconstrained.
- **Status:** Accepted, implemented, tested (62 Node + 5 Rust tests).

### ADR-SEC-002 — scrypt, not Argon2id or bcrypt
- **Context:** the directive states *"Argon2id is preferred. bcrypt is
  acceptable if Argon2id is impractical."*
- **Decision:** **scrypt** in both trails. Recorded here as a deliberate
  deviation, not an oversight.
- **Rationale:**
  - OWASP Password Storage ranks Argon2id > **scrypt** > bcrypt > PBKDF2, so
    this is *stronger* than the stated acceptable fallback.
  - Node: `crypto.scrypt` is stdlib. Argon2id requires a native node-gyp build —
    a supply-chain and build-reliability risk on the Windows target, and a
    compiled dependency in the authentication path.
  - Rust: the RustCrypto `scrypt` crate is pure Rust and mirrors the Node choice,
    so both trails store credentials in comparable formats.
  - Zero new Node dependencies (directive §4.3 prefers minimal dependency change).
- **Parameters:** N=2^15, r=8, p=1, 32-byte key, 16-byte random salt.
- **Negative consequence:** Rust debug builds are slow (~86 s test run) because
  scrypt runs unoptimised. Use `--release` in CI for timing-sensitive work.
- **Status:** Accepted with changes vs. directive §6.4. **Review:** if a policy
  mandates Argon2id.

### ADR-SEC-003 — Fail fast on insecure configuration
- **Decision:** `AUTH_SECRET` and `CORS_ORIGINS` resolve through
  `src/security/config.ts`, which **throws at import time** in any non-dev
  `NODE_ENV` when the value is missing, too short, or equal to the published
  development literal.
- **Rationale:** a silent fallback to a secret committed in source means anyone
  with repository access can forge tokens for production. Refusing to boot is
  strictly safer than serving traffic.
- **Status:** Accepted, implemented, tested.

### ADR-SEC-004 — Deny-by-default tenant scoping, 404 not 403
- **Decision:** task reads that fail the tenancy check return **404**, not 403.
- **Rationale:** 403 confirms the object exists, turning the endpoint into an
  id-enumeration oracle. Mutation attempts by a *member* who lacks the right
  role still return 403, because existence is already known to them.
- **Status:** Accepted, implemented, tested.

### ADR-SEC-005 — Two-factor upload validation
- **Decision:** an upload must satisfy **both** a MIME allow-list and a
  magic-byte signature check. The stored extension is chosen by the server from
  the allow-list and never derived from client input.
- **Rationale:** the declared MIME type is attacker-controlled. Previously it
  chose the extension of a file written into a statically served directory.
- **Defence in depth:** `/uploads/` is served with `X-Content-Type-Options:
  nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`.
- **Status:** Accepted, implemented, tested.

### ADR-SEC-006 — In-process rate limiting (interim)
- **Decision:** a local fixed-window limiter, not `@fastify/rate-limit`.
- **Rationale:** avoids a new dependency in the authentication path for ~90
  lines of auditable code.
- **Explicit limitation:** per-process only. Does **not** survive restart and
  does **not** coordinate across replicas. A shared store is required before
  horizontal scaling.
- **Status:** Accepted as interim. **Review:** before any multi-replica deploy.

---

## Section D — API architecture

### ADR-API-001 — Contract testing required (Proposed)
- **Context:** GAP-05 shipped a 100%-failing endpoint path because the mobile
  unit test mocked the transport layer. Mocking made a broken contract look
  tested.
- **Proposed decision:** generate an OpenAPI document from the Node trail and
  assert client call sites against it.
- **Status:** Proposed, deferred to Wave 3. Not implemented.

---

## Section E — Client architecture

### ADR-CLIENT-001 — Keep React; no framework change
- **Decision:** reject the audit's suggestion to evaluate React alternatives.
- **Rationale:** no defect was attributable to React. Churn without benefit.
- **Status:** Accepted (rejection of proposal).

### ADR-CLIENT-002 — Mobile `BASE_URL` remains hardcoded (deferred)
- **Context:** GAP-12 — `mobile-app/src/services/webApi.ts` pins
  `http://localhost:3000`, which cannot work on a physical device.
- **Status:** Deferred. Requires an environment-configuration strategy
  (Expo config / EAS profiles) that is out of Wave 0 scope. **Not fixed.**

---

## Section F — Integration architecture

### ADR-INT-001 — Test collection must exclude AppleDouble artefacts
- **Context:** `._*.test.ts` resource forks made esbuild abort, so every JS/TS
  suite exited non-zero regardless of results. No CI gate could ever be green.
- **Options:** (a) delete ~83,101 files; (b) exclude them.
- **Decision:** (b). Bulk-deleting files with no git history is irreversible and
  the directive forbids deleting data.
- **Status:** Accepted, implemented, verified across all three JS packages.

### ADR-INT-002 — Tests must never bind a real port
- **Context:** `NO_LISTEN` was set in `beforeAll`, which runs after module
  evaluation, so it never took effect and the suite bound `0.0.0.0:3000`.
- **Decision:** set it in `vitest.config.ts` `env`, which applies before imports.
- **Status:** Accepted, implemented, verified.
