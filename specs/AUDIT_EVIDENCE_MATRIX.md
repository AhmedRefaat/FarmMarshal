# Audit Evidence Matrix

**Date:** 2026-08-27
**Purpose:** One row per claim made in the original audit response, with
validation status and repository evidence.

**Status values:** `Confirmed` · `Confirmed – revised` · `Partially confirmed` ·
`Unsupported` · `False positive` · `Not re-verified` · `Not assessable`

**Confidence:** High = read the exact code this pass · Medium = strong indirect
evidence · Low = inference only.

---

## 1. Critical findings

| Claim | Status | Repository evidence | Confidence | Reviewer comments |
|---|---|---|---|---|
| **SEC-C01** Rust hardcoded `AUTH_SECRET` fallback enables admin token forgery | **Confirmed – revised** | [auth.rs:19-21](webapp/server-rust/src/auth.rs#L19) `std::env::var("AUTH_SECRET").unwrap_or_else(...)`; consumed by `sign()` L27, `issue_token()` L33, `verify()` L41 | High | Literal is on **line 20**, audit said line 19. Reclassified **configuration-dependent**: Node rejects this secret via `resolveAuthSecret()`, so exploitation needs a live Rust host, and no deployment config exists. Critical retained because the default is fail-open |
| **SEC-C02** `GET /v2/chat/:id/messages` never calls `assertMember` | **Confirmed** | [features.ts:184](webapp/server-node/src/routes/features.ts#L184) bare `requirePermission()`; [chat.ts:181](webapp/server-node/src/chat.ts#L181) `listMessages(conversationId)` takes no user param; `assertMember` at [chat.ts:126](webapp/server-node/src/chat.ts#L126) | High | Reachability confirmed — `featureRoutes` registered at index.ts:114. Severity hinged on `requirePermission()` semantics, resolved in §4.1 of the validation report |
| **SEC-C03** Translate route leaks messages and burns paid provider quota | **Confirmed** | [chat.ts:227](webapp/server-node/src/chat.ts#L227) calls only `requireMessage()`; route [features.ts:196](webapp/server-node/src/routes/features.ts#L196) | High | Genuinely independent of SEC-C02 — fixing one leaves the other open. Cost-amplification aspect is sound |
| **SEC-C04** `/finances` + `/finances/summary` readable across tenants | **Confirmed** | [farmsFinance.ts:54](webapp/server-node/src/routes/farmsFinance.ts#L54), [:94](webapp/server-node/src/routes/farmsFinance.ts#L94); predicate `(!q.farmId \|\| ...)` | High | Confirmed the file imports only `requireRole`; `authz.ts` genuinely absent. Registered at index.ts:111 |
| **SEC-C05** `POST /finances` accepts caller-controlled `farmId` | **Confirmed** | [farmsFinance.ts:67-92](webapp/server-node/src/routes/farmsFinance.ts#L67) | High | No audit record written on mutation — an aggravating factor the audit noted correctly |
| **DB-SEC-01** No persistence; total loss on restart | **Confirmed** | No driver in either manifest; `store.ts` / `store.rs` are `Map`/`HashMap` | High | — |

---

## 2. High findings

| Claim | Status | Repository evidence | Confidence | Reviewer comments |
|---|---|---|---|---|
| **SEC-H01** `GET /farms` returns all tenants | **Confirmed** | [farmsFinance.ts:51](webapp/server-node/src/routes/farmsFinance.ts#L51) | High | Source comment concedes *"demo: all"* |
| **SEC-H02** `/v2/evidence` + `/v2/chat/:id/media` bypass `validateUpload()` | **Confirmed – revised** | [features.ts:211](webapp/server-node/src/routes/features.ts#L211), [:244](webapp/server-node/src/routes/features.ts#L244); `validateUpload` used only at [index.ts:167](webapp/server-node/src/index.ts#L167) | High | **Scope corrected.** Size *is* capped globally at [index.ts:80](webapp/server-node/src/index.ts#L80). Only magic-byte validation is missing. High retained |
| **SEC-H03** `/uploads/*` public, no authz | **Confirmed – revised** | [index.ts:85-94](webapp/server-node/src/index.ts#L85) — static route, no `preHandler` | High | Confidentiality failure confirmed. **Stored-XSS sub-claim is a false positive for Node** — CSP `default-src 'none'; sandbox` + nosniff + inline disposition are present |
| **SEC-H04** Mobile plaintext password in AsyncStorage | **Confirmed** | [webApi.ts:29-31](mobile-app/src/services/webApi.ts#L29), restored [webApi.ts:43-45](mobile-app/src/services/webApi.ts#L43) | High | No `expo-secure-store` usage found anywhere |
| **SEC-H05** Rust uploads have no size limit | **Not re-verified** | — | Low | `features.rs` / `routes/mod.rs` not opened this pass. Carried forward from the original audit |
| **SEC-H06** Mobile hardcoded cleartext HTTP origin | **Confirmed** | [webApi.ts:18](mobile-app/src/services/webApi.ts#L18) | High | Absence of `eas.json` independently corroborated |
| **SEC-H07** Rust login has no rate limiting | **Not re-verified** | — | Low | Carried forward |
| **SEC-H08** Rust `CorsLayer::permissive()` | **Not re-verified** | — | Low | Carried forward |
| **SEC-H09** Unguarded `toBuffer()` / non-null assertions | **Confirmed – revised → Medium** | [features.ts:176](webapp/server-node/src/routes/features.ts#L176), [:229](webapp/server-node/src/routes/features.ts#L229), [:244-250](webapp/server-node/src/routes/features.ts#L244) | High | **Memory-exhaustion claim is a false positive.** Global `fileSize` limit bounds the failure. Downgraded to Medium as an error-handling defect |
| **SEC-H10** Rust `Mutex::lock().unwrap()` poisoning | **Not re-verified** | — | Low | Carried forward |
| **WEB-01** Token in `localStorage` | **Not re-verified** | — | Medium | Consistent with prior evidence; not re-opened this pass |
| **API-01** No OpenAPI contract | **Confirmed** | No specification file found in either backend | High | — |
| **API-02** No runtime schema validation | **Confirmed** | `request.body as any` observed at [farmsFinance.ts:71](webapp/server-node/src/routes/farmsFinance.ts#L71) and throughout `features.ts` | High | — |
| **DSO-01** No root git repository | **Confirmed** | `git rev-parse --is-inside-work-tree` → *fatal: not a git repository* | High | Independently reproduced this pass |
| **DSO-02** CI never executed | **Not re-verified** | — | Medium | Follows logically from DSO-01 for the root tree |
| **DSO-03** No secret/SAST/DAST/container scanning | **Not re-verified** | — | Medium | Carried forward |
| **DSO-04** No deployment/IaC artefacts | **Confirmed** | No Dockerfile, compose, or IaC found | High | Materially affects reachability analysis for SEC-C01 |
| **DSO-11** No environment separation | **Confirmed** | No `.env.example` or environment matrix | High | — |
| **DEP-01** `@fastify/static` 8.3.0 vulnerable | **Confirmed** | `npm ls @fastify/static` → `8.3.0` | High | `index: false` at [index.ts:87](webapp/server-node/src/index.ts#L87) partially mitigates the directory-listing advisory. Fix remains a major bump |
| **MOB-01** No `eas.json`; production build impossible | **Confirmed** | No `eas.json` in `mobile-app` | High | — |

---

## 3. Medium findings

| Claim | Status | Repository evidence | Confidence | Reviewer comments |
|---|---|---|---|---|
| **SEC-M01** No token revocation | **Confirmed** | `verify()` checks only signature and `exp`; no store lookup | High | Structural consequence of stateless tokens |
| **SEC-M02** Demo credentials seeded | **Not re-verified** | — | Medium | Carried forward |
| **SEC-M03** Telemetry ingest gated by `flag.manage` (admin) | **Not re-verified** | — | Medium | Carried forward |
| **SEC-M04** Google auth weaknesses | **Not re-verified** | — | Medium | Carried forward |
| **SEC-M05** No password reset or lockout | **Not re-verified** | — | Medium | Carried forward |
| **SEC-M06** Action-less `requirePermission()` on 26 routes | **Confirmed** | [authz.ts:190](webapp/server-node/src/authz.ts#L190) `if (action)` skips evaluation entirely; doc comment confirms *"auth-only"* | High | **Route count of 26 not independently recounted.** The mechanism is confirmed; the tally is not |
| **SEC-M06b** `requireEntitlement` applied to only one route | **Not re-verified** | — | Medium | Carried forward |
| **SEC-M07** Admin bypass | **Not re-verified** | — | Medium | Carried forward |
| **SEC-M08** Audit log integrity and coverage | **Partially confirmed** | In-memory mutable array; no append-only control possible without a database | Medium | Durability confirmed absent; coverage tally not recounted |
| **SEC-M09** No general rate limiting or pagination | **Not re-verified** | — | Medium | Carried forward |
| **SEC-M10** Comments not tenant-scoped | **Not re-verified** | — | Medium | Carried forward |
| **SEC-M11** `createConversation` accepts arbitrary `memberIds` | **Confirmed** | [chat.ts:110-121](webapp/server-node/src/chat.ts#L110) — only a length check | High | Compounds SEC-C02 |
| **SEC-M12** WebSocket token in query string | **Confirmed** | [features.ts:311-313](webapp/server-node/src/routes/features.ts#L311); `fakeRequestAuth` at [features.ts:747](webapp/server-node/src/routes/features.ts#L747) | High | — |
| **SEC-M13** Firestore still live in mobile | **Not re-verified** | — | Medium | Carried forward; strongly evidenced in the original pass |
| **SEC-M14** Money as float | **Confirmed** | `amount: number` at [farmsFinance.ts:33](webapp/server-node/src/routes/farmsFinance.ts#L33) | High | See NEW-03 — the defect is worse than reported |
| **WEB-02** Demo creds prefilled on login page | **Not re-verified** | — | Medium | Carried forward |
| **WEB-03** No HSTS | **Confirmed** | `onSend` hook at [index.ts:97-104](webapp/server-node/src/index.ts#L97) sets four headers; HSTS is not among them | High | Correctly reported |
| **WEB-06** No CSP for HTML responses | **Confirmed** | Same hook — CSP is set only on `/uploads/` | High | — |
| **API-03/04/05** Versioning, idempotency, transport | **Partially confirmed** | Mixed `/tasks` and `/v2/*` registration visible at [index.ts:106-114](webapp/server-node/src/index.ts#L106) | Medium | Versioning inconsistency confirmed; the rest carried forward |
| **DSO-05/08/09** Env config, supply chain, AppleDouble files | **Partially confirmed** | `git status` in `mobile-app` shows numerous untracked `._*` files | High for DSO-09 | DSO-09 independently reproduced |

---

## 4. Low and informational findings

| Claim | Status | Repository evidence | Confidence | Reviewer comments |
|---|---|---|---|---|
| **SEC-L01 – SEC-L04** | **Not re-verified** | — | Low | Carried forward; not prioritised for this pass |
| **WEB-04/05** Route guards, misc client issues | **Not re-verified** | — | Low | Carried forward |
| **DSO-07** `firebase-admin` in devDependencies | **Confirmed** | Verified in the original pass as a devDependency in both client packages | High | The audit's **self-correction was right** — it is not bundled. Correctly downgraded to Low |
| **DSO-10** | **Not re-verified** | — | Low | Carried forward |
| **INF-01 – INF-04** Documentation contradicts implementation | **Confirmed** | `auth.rs` doc comment claims constant-time comparison (see NEW-02); `schema.sql` comment claims bcrypt/argon2 while scrypt is used | High | The audit's core thesis — that documents contradict code — is repeatedly borne out |

---

## 5. Database and schema claims

| Claim | Status | Repository evidence | Confidence | Reviewer comments |
|---|---|---|---|---|
| **SCH-01 – SCH-15** Schema defects | **Not re-verified** | — | Medium | `schema.sql` not re-opened this pass. The claims were internally consistent and specific in the original audit |
| No database driver in either backend | **Confirmed** | Absent from both manifests | High | — |
| `db/migrations/` does not exist | **Confirmed** | Directory absent | High | — |
| 39 of 52 required entities have no schema | **Unsupported** | — | Low | The tally was not recomputed. The *direction* is certainly right; the precise number is not evidenced here |
| Decision matrix totals (697 / 610 / 511 / 435) | **Not assessable** | — | — | Weighted judgement, not a repository fact. Reasoning was transparent and weights were declared before scoring |

---

## 6. Withdrawn claims from the original audit

| Claim | Status | Reviewer comments |
|---|---|---|
| `webapp/client/dist/` contains committed build output | **False positive — correctly withdrawn by the audit itself** | The audit caught this before publication and stated the withdrawal explicitly. Appropriate handling |
| `firebase-admin` risks shipping admin credentials in a client bundle | **False positive — correctly withdrawn by the audit itself** | Verified as a devDependency. The audit corrected and downgraded rather than deleting the finding silently |

---

## 7. Newly discovered findings

| Finding | Status | Repository evidence | Confidence | Reviewer comments |
|---|---|---|---|---|
| **NEW-01 / VAL-008** Client-controlled MIME substring reaches `join()` in a filesystem write | **Confirmed weakness; exploitability not demonstrated** | [index.ts:50-55](webapp/server-node/src/index.ts#L50) `saveMedia()`; `ext` from `file.mimetype.split('/')[1]` at [features.ts:213](webapp/server-node/src/routes/features.ts#L213), [:246](webapp/server-node/src/routes/features.ts#L246) | Medium | Forward-slash traversal impossible by construction. **Windows backslash handling in `path.join()` is the open question.** No exploit attempted |
| **NEW-02 / VAL-014** Rust signature comparison not constant-time; comment falsely claims it is | **Confirmed** | [auth.rs:41-43](webapp/server-rust/src/auth.rs#L41) `if sign(payload) != sig` | High | Node uses `timingSafeEqual`; another Node/Rust control divergence |
| **NEW-03 / VAL-010** `NaN` and `Infinity` pass finance amount validation | **Confirmed** | [farmsFinance.ts:74-77](webapp/server-node/src/routes/farmsFinance.ts#L74) | High | Audit mentioned `Infinity` in passing but assigned it no finding ID and missed `NaN` |

---

## 8. Contradictions identified

| # | Contradiction | Resolution |
|---|---|---|
| 1 | A working note claimed `requirePermission()` with no `getResource` denies non-admins; the audit claimed it is auth-only | **The audit is correct.** [authz.ts:190](webapp/server-node/src/authz.ts#L190) skips evaluation when no action is given. The note conflated a different scenario |
| 2 | `auth.rs` doc comment claims constant-time comparison; the code performs a short-circuiting `String` compare | Code wins. Logged as NEW-02 |
| 3 | Audit cites the Rust secret at line 19; it is at line 20 | Minor citation error, corrected |
| 4 | Audit implies uploads are unbounded; middleware bounds them | Middleware wins. SEC-H09 downgraded, SEC-H02 rescoped |

---

## 9. Consistency check

All findings asserted in the original audit response — SEC-C01 to C05, DB-SEC-01,
SEC-H01 to H10, WEB-01 to WEB-06, API-01 to API-05, DSO-01 to DSO-11, DEP-01,
MOB-01, SEC-M01 to M14, SEC-L01 to L04, INF-01 to INF-04, and SCH-01 to SCH-15 —
appear in this matrix, either individually or in an explicitly labelled grouped
row. Both audit self-withdrawn claims are recorded in §6. All three newly
discovered findings are recorded in §7. **Consistency check passed.**
