# Evidence — Blocked Checks

Checks the directive requires that were **not** performed in this execution, and
why. Nothing here is claimed as passing.

| Check | Status | Reason |
|---|---|---|
| Persistence / migration verification (GAP-04) | **Blocked** | No PostgreSQL instance available. `webapp/server-node/db/schema.sql` has never been executed. All state remains in-memory and is lost on restart. |
| 95% global coverage gate | **Not met** | Measured 72.01% statements / 70.87% branches. See `coverage-summary.md`. |
| 100% branch coverage on all security-critical modules | **Not met** | Only `src/security/**` is held to 85% branches. `authz.ts`, `entitlements.ts`, and the issue stage machine are not at 100%. |
| Rust code coverage | **Not measured** | `cargo-llvm-cov` is not installed; installing it was out of scope for Wave 0. |
| `npm audit` remediation | **Not performed** | 7 vulnerabilities remain in `server-node` (3 moderate, 2 high, 2 critical). Dependency bumps carry their own regression risk and need a dedicated wave. |
| End-to-end / UI tests | **Not performed** | No E2E harness exists in the repository. |
| Load, performance, soak testing | **Not performed** | No harness, and meaningless against an in-memory store. |
| Mobile device testing (Expo/EAS) | **Blocked** | Requires a build service and physical devices. Also blocked by GAP-12 (`BASE_URL` hardcoded to `localhost`). |
| Contract tests (client ↔ server) | **Not performed** | No OpenAPI document exists. This is exactly the gap that let GAP-05 ship. Deferred to Wave 3. |
| CI pipeline execution | **Not performed** | A workflow was authored but there is no repository-root git remote to run it against. It is unverified. |
| Penetration / DAST scan | **Not performed** | No tooling available in this environment. |
| `authz.can()` blanket-admin fix | **Deferred** | Changing it alters behaviour that six routes depend on; needs its own test wave. |
| `requirePermission()` no-resource denial (WP-1.8) | **Deferred** | Fails closed, so it is a functional defect rather than a security hole. |
| Mobile `BASE_URL` (GAP-12) | **Not fixed** | Needs an environment-configuration strategy beyond Wave 0 scope. |
