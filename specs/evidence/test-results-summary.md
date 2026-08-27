# Evidence — Test Results Summary

## Before / after

| Suite | Baseline tests | Baseline exit | Now tests | Now exit |
|---|---|---|---|---|
| `webapp/server-node` | 57 passed | **1** (3 files failed) | **119 passed** | **0** |
| `webapp/server-rust` | 9 passed | 0 | **14 passed** | **0** |
| `webapp/client` | 2 passed | **1** (1 file failed) | **2 passed** | **0** |
| `mobile-app` | 3 passed | **1** (2 files failed) | **3 passed** | **0** |
| **Total** | **71** | 3 of 4 suites red | **138** | **all green** |

Every suite now exits 0. Before this execution, three of four exited non-zero
regardless of test outcome, so no CI gate was possible.

## server-node breakdown (verbatim summary lines)

```
 Test Files  4 passed (4)
      Tests  119 passed (119)
```

| File | Tests |
|---|---|
| `test/p0.test.ts` | 16 |
| `test/phases.test.ts` | 21 |
| `test/routes.test.ts` | 20 |
| `test/security.test.ts` | **62 (new)** |

## server-rust breakdown

```
running 14 tests
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

9 pre-existing + 5 new in `src/security.rs`:
`public_registration_never_grants_privilege`, `password_round_trip`,
`distinct_salt_per_hash`, `malformed_stored_values_are_rejected`,
`password_policy_boundaries`.

## Security regression tests added (62)

| Finding | Tests | Representative assertions |
|---|---|---|
| GAP-01 / SEC-C1 | 23 | no role → `worker`; `admin`/`owner`/`moderator` → **403**; unknown role → 400; `{role:{...}}`, `[...]`, `42`, `true` → 400; missing fields → 400; bad email → 400; duplicate → 409; role not encoded in user id |
| GAP-01 elevation | 5 | non-admin elevation → 403; admin elevation → 200 **plus** an audit record with `{from:'worker',to:'moderator'}`; unknown role from admin → 400; unknown target → 404; **stale token honours demotion** |
| SEC-C3 passwords | 11 | hash starts `scrypt$`, never contains the plaintext; distinct salt per hash; 5 malformed stored values return `false` rather than throwing; weak password → 400; register→login round trip; **identical 401 body for unknown user vs wrong password** |
| SEC-C4 BOLA | 12 | non-member sees `[]`; individual task → **404 (not 403)**; state transition → 404; evidence upload blocked; server-derived `farmId`; cross-tenant `farmId` → 403; foreign worker → 400; out-of-range lat/lng → 400; emails hidden from unprivileged callers |
| GAP-02 / SEC-C2 | 3 | unauthenticated `POST /v2/videos` → **401**; non-member → 401/402/403; `uploadedBy` always from session |
| SEC-H7 throttling | 2 | repeated failed logins → **429 + Retry-After**; counter clears after success |
| SEC-H5 / SEC-H8 config | 6 | production without `AUTH_SECRET` throws; published dev secret in production throws; short secret throws; strong secret accepted; production without `CORS_ORIGINS` throws; security headers present on every response |
| SEC-H6 uploads | 8 | valid PNG/JPEG accepted with server-chosen extension; non-allow-listed type → 415; **HTML bytes declared as `image/png` → 415**; empty → 400; oversize → 413; filename traversal stripped |
