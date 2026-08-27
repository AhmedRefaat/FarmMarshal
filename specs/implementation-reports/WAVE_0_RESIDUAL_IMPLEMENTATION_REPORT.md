# Wave 0 Residual — Implementation Report

**Wave:** `wave-0-residual`
**Date:** 2026-08-27
**Repository root:** `C:\BMW_Work\Workspace\Scripts\WebApp_Demp`
**Status:** **Completed** (approved scope implemented, verified and committed)

---

## 1. Scope

### In scope (approved)

| ID | Title | Outcome |
|---|---|---|
| SEC-H04 | Plaintext password / sensitive authentication data stored in mobile AsyncStorage | Confirmed open → **remediated in source** |
| SEC-H06 | Hardcoded cleartext HTTP endpoint / transport configuration in the mobile app | Confirmed open → **remediated in source** |
| E-11 / DSO-01 | Missing root version-control repository and reliable rollback mechanism | Confirmed open → **remediated** |

Directly related work performed under the approved scope: mobile regression
tests, transport configuration validation, platform (Android/iOS) transport
settings, and mobile security documentation.

### Explicitly out of scope (not touched this run)

- All Rust findings, including `webapp/server-rust` code and tests.
- All PostgreSQL work: schema, migrations, RLS policies, session tables,
  finance ledger persistence, telemetry partitioning, outbox.
- The unresolved Node-versus-Rust canonical-backend decision.
- Backend authorization logic (`authz.ts`), finance routes
  (`farmsFinance.ts`), chat membership (`chat.ts`), upload validation
  (`features.ts`), the `@fastify/static` major upgrade.
- Firestore retirement / dual-backend persistence.
- Certificate pinning (explicitly excluded; no safe tested rotation mechanism
  exists in the current mobile stack).
- HSTS (a server response header; not implementable in a mobile client).

No backend source, schema, dependency or configuration file was modified.
Every change in this run is inside `mobile-app/`.

---

## 2. Repository state

| Item | Value |
|---|---|
| Resolved repository root | `C:\BMW_Work\Workspace\Scripts\WebApp_Demp` |
| Root Git repository before this run | **none** (confirmed: `fatal: not a git repository`) |
| Nested Git repositories found | `mobile-app/.git` only (1 commit: `279ec1b Initial commit`, with uncommitted modifications) |
| Root Git initialization | performed, branch `main` |
| Root baseline commit | **`38b73ee`** — `chore(dso-01): root repository baseline and safe ignore policy` (130 files, working tree as found, no source modifications) |
| Root implementation branch | `security/wave-0-residual-mobile-hardening` |
| Root ending commit | `38b73ee` + this report (see §9) |
| Mobile baseline commit | **`0b42550`** — `chore(dso-01): mobile baseline before wave-0-residual security work` |
| Mobile implementation branch | `security/wave-0-residual-mobile-hardening` |
| Mobile ending commit | **`a96ccc6`** |
| Remote | none configured; **nothing was pushed** |

### Nested-repository decision

`mobile-app/` already owned a Git history. It was **preserved untouched** — no
`.git` directory was removed or rewritten.

Staging it from the root would have produced a *gitlink* with no `.gitmodules`
remote, which would record a commit pointer while versioning **none** of the
mobile sources — the opposite of the rollback guarantee E-11/DSO-01 requires.
It was therefore **excluded** from the root index via `.gitignore`, with the
reason documented inline in that file.

Consequence: rollback is two-repository.

- Backend, client, docs and specs → root repository.
- Mobile → `mobile-app/` repository.

**Human decision required:** whether to consolidate the two histories or
register `mobile-app` as a real submodule once a remote exists. This was not
done autonomously because either option rewrites or relocates existing history.

### Baseline safety review

- Secret scanners: `gitleaks` and `trufflehog` are **not installed**; a
  heuristic pattern sweep (AWS keys, private-key headers, Slack/GitHub/Google/
  OpenAI token shapes, credentialed connection strings) over all source,
  config and documentation returned **zero** hits.
- Staged set contains no `.env`, certificate, key, keystore, provisioning
  profile, database, backup, log, `node_modules`, `dist/`, `target/`,
  `coverage/` or `uploads/` path. Largest staged files are lock files and
  audit markdown.
- `src/config/firebase.ts` contains `YOUR_API_KEY`-style placeholders only —
  no live Firebase credentials.
- `webapp/server-rust/src/auth.rs` was checked because prior notes claimed a
  hardcoded secret. **That claim is stale**: the file now calls
  `security::resolve_auth_secret(...)` which fails closed in production
  (`auth.rs:35`, tests at `auth.rs:101-150`). No production secret is present
  in the baseline. This is recorded as an observation only; no Rust file was
  modified.

### Root ignore policy added

Environment files, `*.local`, `secrets/`, certificates and private keys
(`*.pem *.key *.crt *.cer *.p8 *.p12 *.pfx *.jks *.keystore *.mobileprovision`),
local databases and backups, scratch output (`.local-run/`), IDE metadata,
mobile build artifacts (`.expo/`, `web-build/`, `*.apk *.aab *.ipa`), plus the
pre-existing rules for `node_modules/`, `dist/`, `build/`, Rust `target/`,
`coverage/`, `uploads/`, logs and macOS AppleDouble `._*` files.

`mobile-app/.gitignore` additionally gained `._*`, `.env` / `.env.*` (with
`!.env.example`) and `coverage/`.

---

## 3. Finding verification

### SEC-H04 — plaintext credentials in AsyncStorage

**Original claim:** the mobile app persists a plaintext password in AsyncStorage.

**Current source evidence (before the fix), `mobile-app/src/services/webApi.ts`:**

```
L21  const CREDS_KEY = 'agritasks.apiCreds';
L28  export function setWebCredentials(email: string, password: string) {
L30    AsyncStorage.setItem(CREDS_KEY, JSON.stringify(credentials)).catch(() => {});
```

Verification checklist:

| Question | Finding |
|---|---|
| Which file stores authentication information | `src/services/webApi.ts` (token + credentials), `src/services/authService.ts` (profile) |
| Is a password stored | **Yes** — `{ email, password }` as plaintext JSON under `agritasks.apiCreds` |
| Is a raw token stored | **Yes** — under `agritasks.apiToken`, also in AsyncStorage |
| Is AsyncStorage used | Yes — `@react-native-async-storage/async-storage`, unencrypted |
| Does the value survive restart | Yes — that was its stated purpose ("cold starts") |
| Does logout clear it | **No.** `logout()` cleared the token and profile but **never** `agritasks.apiCreds`. The password outlived logout. |
| Does token refresh exist | No — `ensureToken()` replayed the stored password against `/auth/login` |
| Does the app regenerate auth from stored credentials | Yes — `ensureToken()` and the `apiGet` 401 path |
| Was OS secure storage available | Yes (Expo SDK 57) but **not used** |
| Did a secure-storage dependency exist | **No** — `expo-secure-store` was absent |
| Did tests cover secure storage | **No** — mobile baseline was 3 tests, none touching auth storage |
| Did a previous Wave 0 run address it | **No.** Verified directly in source; the documentation claim that Wave 0 shipped Node fixes is not evidence for this mobile finding. |

**Classification: Confirmed open** (not remediated, not partially remediated).

Also observed: `setWebCredentials` was called *twice* per sign-in — once in
`authService.login()`/`register()` and again in `LoginScreen.submit()`.

**Files affected:** `src/services/webApi.ts`, `src/services/authService.ts`,
`src/screens/LoginScreen.tsx`.

**Existing mitigation:** none.
**Missing control:** OS-backed secure storage; a no-password-persistence rule;
logout completeness; fail-closed restore.

### SEC-H06 — hardcoded cleartext endpoint

**Original claim:** a hardcoded cleartext HTTP endpoint ships in the mobile app.

**Current source evidence (before the fix):**

```
webApi.ts:18   export const BASE_URL = 'http://localhost:3000';
webApi.ts:181  return path.startsWith('http') ? path : `${BASE_URL}${path}`;
chatService.ts:85,148   m.mediaUrl.startsWith('http') ? ... : `${BASE_URL}${...}`
```

Verification checklist:

| Question | Finding |
|---|---|
| Which file contains the cleartext URL | `src/services/webApi.ts:18` |
| Used in production builds | **Yes** — a module-level constant with no build-profile branch; it ships in every bundle |
| Can environment configuration override it | **No** — no env read, and no `eas.json` exists |
| What does the URL point to | `localhost` — i.e. a production build is not merely insecure, it is non-functional |
| Is TLS available for the target backend | Not configured in-repo; a TLS-terminating deployment is a manual prerequisite (see §7) |
| Android cleartext traffic enabled | Yes, by platform default — `app.json` set no `usesCleartextTraffic` |
| iOS transport-security exceptions | None declared — relied on platform defaults |
| WebSocket traffic insecure | No WebSocket client exists yet; only design comments in `chatService.ts` / `taskService.ts`. Chat uses HTTP polling. |
| Media URLs cleartext | **Yes** — derived from `BASE_URL`, with `startsWith('http')` prefix checks that also accept an attacker-supplied absolute `http://` URL from the server |
| Tests validating production transport | **None** |
| Previously corrected | **No** |

**Classification: Confirmed open.**

**Files affected:** `src/services/webApi.ts`, `src/services/chatService.ts`,
`app.json`.

**Existing mitigation:** none.
**Missing control:** environment-driven endpoints, parser-based scheme/host
validation, fail-closed production behaviour, platform transport restrictions.

### E-11 / DSO-01 — missing root version control

**Classification: Confirmed open.** No `.git` at the repository root; the only
history was `mobile-app/.git`. Every prior remediation claim was therefore
unverifiable and non-revertable. **Remediated** — see §2.

---

## 4. Implementation

### 4.1 SEC-H04 — secure authentication storage

**New module `mobile-app/src/services/secureStore.ts`.**

- **Secure-storage design.** `expo-secure-store` `~57.0.2` (SDK-matched, added
  via `npx expo install`; the only new dependency) backs the single entry
  `agritasks.auth.token` with `keychainAccessible:
  WHEN_UNLOCKED_THIS_DEVICE_ONLY` — iOS Keychain / Android Keystore-backed
  EncryptedSharedPreferences, unavailable while locked and excluded from
  device backups. No custom crypto, no obfuscation, no locally-held key.
- **Passwords.** `setWebCredentials()` is deleted. Nothing writes a password to
  any store. The password parameter exists only for the duration of the
  `/auth/login` request.
- **Token shape validation.** `isWellFormedToken()` accepts only the server's
  `base64url.base64url` format (2–3 segments, 16–4096 chars). `saveAuthToken()`
  refuses to persist anything else.
- **Legacy-storage cleanup.** `purgeLegacyAuthStorage()` detects
  `agritasks.apiCreds` and `agritasks.apiToken` via `AsyncStorage.getAllKeys()`
  and removes them with `multiRemove()`. **The values are never read** and never
  logged — only a reason category (`sec_h04_migration`) and a key count.
  **Nothing is migrated:** a credential blob cannot be made safe, and a token
  that sat in unencrypted storage is treated as compromised. Affected users
  re-authenticate.
- **Startup behaviour.** `restoreApiSession()` purges legacy keys once per
  process, then reads the token from secure storage.
  `authService.restoreSession()` now requires that token: without it the cached
  `agritasks.profile` snapshot is deleted and the user is signed out. A profile
  alone can no longer imply a session.
- **Fail-closed reads.** An unreadable keychain returns `null` (signed out,
  never "trusted"). A malformed entry is deleted and returns `null`. A corrupt
  profile snapshot is deleted.
- **Logout behaviour.** `logout()` clears the secure token and the profile; the
  legacy keys are already gone from the startup purge.
- **Authentication failure.** A `401` on any authenticated verb clears the
  token, fires the registered sign-out handler and raises
  `SessionExpiredError`. The old credential-replay retry in `apiGet` is gone,
  so a rejected token can no longer be silently re-minted from a stored
  password. `authService` registers the handler via `onSessionExpired()`,
  avoiding a circular import.
- **Pre-existing defect fixed as a necessary consequence.** `login()` called
  `apiPost('/auth/login')`, which called `ensureToken()` — so a first-time
  sign-in on a clean install threw `Not signed in`. `apiPostPublic()` was added
  for `/auth/login` and `/auth/register` only; every other call still carries a
  bearer token. This is not an authentication bypass: these two endpoints are
  unauthenticated by definition and the server performs the credential check.
- **Structured logging.** Every new log line carries `{ reason: <category> }`
  and, where useful, a status/count. No value, no error message text, no
  email, no token, no password, no header reaches a log line.

### 4.2 SEC-H06 — validated transport configuration

**New module `mobile-app/src/config/endpoints.ts`.**

- **Endpoint validation.** `validateEndpoint()` parses with the WHATWG `URL`
  implementation supplied by the Expo runtime (SDK 52+) — never string prefix
  matching. It rejects: empty/whitespace values, unparsable URLs, URLs with
  embedded credentials, missing hosts, and unsupported schemes
  (`ftp:`, `file:`, `javascript:`, …). Error messages deliberately contain the
  **configuration key name only**, never the URL, which may carry credentials.
- **Production restrictions.** `https:` for API/media, `wss:` for the push
  channel. An `http:`/`ws:` production endpoint throws. A missing
  `EXPO_PUBLIC_API_URL` in a production build throws at startup. There is **no
  fallback path** from production to cleartext.
- **Development exceptions.** `allowInsecureDevHttp` is computed as
  `isDev && env.EXPO_PUBLIC_ALLOW_INSECURE_DEV_HTTP === 'true'` — the `isDev`
  conjunct is evaluated **first**, so a production bundle cannot activate the
  exception no matter what environment it is launched with. Even when enabled,
  cleartext is confined to `localhost`, `127.0.0.1`, `::1`, the Android
  emulator alias `10.0.2.2`, Genymotion's `10.0.3.2`, and anchored RFC 1918
  ranges. Host comparison uses the full parsed hostname, so
  `localhost.evil.com` and `10.0.2.2.evil.com` are rejected.
  An unconfigured development machine still gets `http://localhost:3000` from a
  compile-time constant routed through the same validator, so local
  development is unchanged.
- **WebSocket configuration.** `EXPO_PUBLIC_WS_URL` is validated separately
  under the `ws` kind; when unset it is derived from the API URL
  (`https:`→`wss:`, `http:`→`ws:`). No WebSocket client exists yet, so this is
  configuration-only — the policy is in place before the channel is built.
- **Media configuration.** `EXPO_PUBLIC_MEDIA_URL` is validated separately and
  defaults to the API origin. `resolveMediaUrl()` replaces the
  `startsWith('http')` checks in `webApi.audioFullUrl()` and
  `chatService`: relative paths are joined onto the media origin; absolute
  `https:` passes through; absolute `http:` is **upgraded to https** (never
  downgraded) outside the dev exception; URLs with embedded credentials or a
  non-HTTP scheme are dropped.
- **Log safety.** `redactUrl()` renders scheme + host only, discarding
  credentials, path, query and fragment. Media warnings log `{ host }` or
  `{ scheme }` only.
- **Android configuration change.** `app.json` → `expo.android.usesCleartextTraffic: false`.
- **iOS configuration change.** `app.json` → `expo.ios.infoPlist.NSAppTransportSecurity`
  with `NSAllowsArbitraryLoads: false`, `NSAllowsArbitraryLoadsInWebContent: false`
  and `NSAllowsLocalNetworking: true`. The last keeps LAN/loopback development
  working *without* granting a blanket public-cleartext exception.
- **Public API preserved.** `webApi.BASE_URL` still exists with the same type,
  now bound to the validated origin, so no consumer needed rewriting.

### 4.3 Documentation

`mobile-app/.env.example` documents every variable with its dev/staging/
production requirement. `mobile-app/ARCHITECTURE.md` §6.1 and §6.2 document the
credential-storage and transport models.

---

## 5. Testing

### Baseline (recorded before any change)

| Suite | Command | Result |
|---|---|---|
| Mobile | `npx vitest run` (in `mobile-app`) | **3 passed**, 0 failed, exit 0 |
| Mobile types | `npx tsc --noEmit` (in `mobile-app`) | exit 0 |
| Node | `npx vitest run` (in `webapp/server-node`) | **153 passed**, 0 failed, exit 0 |
| Client | `npx vitest run` (in `webapp/client`) | **2 passed**, 0 failed, exit 0 |

The previously reported counts of 153 Node / 2 client were confirmed accurate.
Rust was not run — no Rust file was changed.

### Tests added — 57 new tests

`mobile-app/src/config/__tests__/endpoints.test.ts` (32) — SEC-H06:

- production https accepted; production wss accepted
- production http rejected; production `ws://` rejected
- missing production URL rejected (`undefined`, `null`, `''`, whitespace)
- malformed URL rejected (`not a url`, `https://`, `//host`, bare host)
- unsupported schemes rejected (`ftp:`, `file:`, `javascript:`)
- URLs with embedded credentials rejected
- **error messages never echo the URL or its credentials**
- lookalike host `localhost.evil.com` rejected (no prefix matching)
- trailing-slash normalization
- development localhost http accepted **only** when explicitly enabled
- emulator (`10.0.2.2`) and RFC 1918 hosts accepted when enabled
- cleartext to a public host refused even in development
- full production config resolution; wss/media derivation
- production build with no API URL / http API URL / insecure ws / http media — all rejected
- **production build cannot activate the development exception** (both the
  throw and `allowsInsecureTransport === false`)
- configured http dev endpoint requires the explicit flag
- unconfigured dev machine still resolves to loopback
- `redactUrl` drops credentials/path/query/fragment and does not leak unparsable input
- `resolveMediaUrl`: relative join, https passthrough, http→https upgrade,
  credential/scheme rejection with no leak in the warning, dev cleartext
  passthrough, empty input

`mobile-app/src/services/__tests__/authStorage.test.ts` (25) — SEC-H04:

- login succeeds and returns the profile (**existing workflow preserved**)
- sign-in works with no pre-existing token, sending no `authorization` header
- **login stores no password in AsyncStorage** (key absent *and* full-value scan)
- **login stores no password in secure storage** (full-value scan)
- token present in secure storage only; absent from every AsyncStorage value
- registration obeys the same rules
- logout removes the secure token and the profile snapshot
- logout leaves no legacy keys and no password anywhere
- a 401 drops the token, signs the user out, and raises `SessionExpiredError`
- **no credential-replay retry after a 401** (exactly one fetch)
- startup purges `agritasks.apiCreds`
- **neither the legacy password nor the legacy token is migrated** into secure storage
- a legacy-only user is signed out and the cached profile is dropped
- a valid secure token restores the session
- missing secure data ⇒ signed out; `ensureToken()` rejects
- **corrupt secure-storage data fails closed and the entry is deleted**
- an unreadable keychain fails closed rather than trusting a cached profile
- a corrupt profile snapshot is discarded
- **a secure-storage write failure leaks neither token nor password into any console stream**
- **the legacy purge logs neither the password nor the email**
- a failed auth request logs the status but not the submitted credentials
- malformed tokens are refused for persistence; the server format is accepted
- authenticated calls carry the bearer token from secure storage
- login → authenticated call succeeds end to end

All fixtures are synthetic (`fixture-not-a-real-password`,
`worker@example.invalid`, structurally-valid but meaningless base64url tokens).
No snapshot files exist in this project, and no realistic secret appears in any
fixture.

### Commands executed after the change

| Command | Working dir | Result | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| `npx vitest run` | `mobile-app` | exit 0 | **60** | 0 | 0 |
| `npx tsc --noEmit` | `mobile-app` | exit 0 | — | — | — |
| `npx expo config --type public --json` | `mobile-app` | exit 0 | — | — | — |
| `npx vitest run` | `webapp/server-node` | exit 0 | **153** | 0 | 0 |
| `npx vitest run` | `webapp/client` | exit 0 | **2** | 0 | 0 |
| `npm audit --json` | `mobile-app` | 20 advisories | — | — | — |

Mobile went from 3 → 60 tests. Node and client are byte-identical to baseline
(no backend file was changed); they were re-run as regression evidence.

### Security regression evidence

- Development-build config resolution verified: Android
  `usesCleartextTraffic = false`; iOS
  `NSAppTransportSecurity = {NSAllowsArbitraryLoads: false, NSAllowsArbitraryLoadsInWebContent: false, NSAllowsLocalNetworking: true}`.
- Production-configuration validation is asserted by unit tests rather than a
  full production bundle build (see "not executed" below).
- Post-change source sweep for `setWebCredentials`, `apiCreds` and
  `'http://localhost:3000'` returns only: test fixtures, the documented
  dev-fallback constant, and the legacy key constants that exist **in order to
  delete them**.

### Dependency scan

`npm audit` in `mobile-app` reports 20 advisories: 18 moderate, 1 high
(`vite`), 1 critical (`vitest`). Both the high and the critical are
**dev-toolchain only** and **pre-existing**. `expo-secure-store` appears in no
advisory path. No dependency upgrade was performed — broad upgrades are out of
scope for this wave.

### Not executed — with reasons and residual risk

| Command | Reason | Residual risk |
|---|---|---|
| `npm run lint` (mobile) | **No linter is configured.** `mobile-app/package.json` defines only `start/android/ios/web/test`, and there is no ESLint config or dependency. | Style/lint regressions are not mechanically caught. `tsc --noEmit` (strict) passes and is the effective static analysis. |
| Static analysis (SAST) | None configured in the repository. | No automated taint analysis of the changed code. Mitigated by review and the 57 targeted tests. |
| `gitleaks` / `trufflehog` | **Not installed** on this machine. | Secret detection relied on a heuristic pattern sweep, which is weaker than a real scanner. Recommend adding one to CI. |
| Production build validation (`npx expo export` / `eas build --profile production`) | Requires a configured production `EXPO_PUBLIC_API_URL` (owner-supplied, see §7) and, for EAS, authenticated cloud build access. Running it with a placeholder value would prove nothing. | **The production fail-closed path has not been exercised in a real bundle.** It is covered by unit tests over the same pure resolver the bundle uses. Must be confirmed once the real endpoint exists. |
| Android/iOS on-device transport tests | No emulator/simulator or physical device is available in this environment. | The Keychain/Keystore write path and the ATS/cleartext manifest behaviour are verified by config resolution and mocked-adapter tests, **not** on real hardware. Device smoke testing is a required manual step. |
| Rust tests (`cargo test`) | No Rust file was changed. Deliberately skipped per scope. | None for this change set. |
| Mobile integration tests | No integration harness exists in the mobile project (no Detox/RNTL setup). | End-to-end login/logout on a device is unverified; see the manual actions in §7. |

No test was suppressed, deleted, weakened or had its expectations altered.
No threshold was lowered.

---

## 6. Security review of the final diff

| Check | Result |
|---|---|
| Every change within approved scope | Yes — all changes are in `mobile-app/` plus the root ignore file and this report |
| No password-storage path remains | Yes — `setWebCredentials` deleted; no store receives a password; asserted by tests |
| No production cleartext fallback remains | Yes — production rejects `http:`/`ws:` and rejects missing configuration |
| No secret added | Yes — no credential, token or key in any changed file; fixtures are synthetic |
| No sensitive logging added | Yes — new log lines carry reason categories, status codes and counts only |
| No broad Android cleartext permission for production | Yes — `usesCleartextTraffic: false` |
| No broad iOS transport exception for production | Yes — `NSAllowsArbitraryLoads: false`; only `NSAllowsLocalNetworking` |
| No unrelated formatting changes | Yes — 8 modified files, 5 added; diff is +226/−68 in modified files |
| No generated build output staged | Yes — `.gitignore` blocks it; staged set reviewed |
| No local environment file staged | Yes — only `.env.example`, which contains placeholders |
| No test fixture contains a realistic secret | Yes |
| Root ignore file protects sensitive local artifacts | Yes — see §2 |
| Baseline and implementation commits distinguishable | Yes — `chore(dso-01)` baselines vs `fix(sec-h04)` / `fix(sec-h06)` / `test(...)` |
| Rollback performable through Git | Yes — see §9 |

---

## 7. Deployment

### Required environment variables (mobile build)

| Variable | development | staging | production |
|---|---|---|---|
| `EXPO_PUBLIC_API_URL` | optional (defaults to `http://localhost:3000`) | **required**, `https://` | **required**, `https://` |
| `EXPO_PUBLIC_WS_URL` | optional (derived) | optional (derived), `wss://` | optional (derived), `wss://` |
| `EXPO_PUBLIC_MEDIA_URL` | optional (defaults to API) | optional, `https://` | optional, `https://` |
| `EXPO_PUBLIC_ALLOW_INSECURE_DEV_HTTP` | `true` only for an explicit `http://` LAN/emulator endpoint | must not be set | ignored by the runtime |
| `LOG_LEVEL` | `debug` | `warn` | unset (release default `error`) |

`EXPO_PUBLIC_*` values are inlined into the JS bundle at build time. They must
contain **endpoints only, never secrets**.

- **Development.** No configuration needed for emulator work. For a physical
  device on the LAN, set `EXPO_PUBLIC_API_URL=http://<LAN-IP>:3000` **and**
  `EXPO_PUBLIC_ALLOW_INSECURE_DEV_HTTP=true`. On Android, local HTTP requires
  Expo Go or a debug build supplying its own cleartext manifest — a release
  build cannot talk HTTP at all.
- **Staging / production.** Set `EXPO_PUBLIC_API_URL` to the HTTPS origin.
  A missing or non-HTTPS value makes the app fail closed at startup; this is
  intentional and must be caught in the build pipeline, not by users.
- **Backend prerequisite.** The Node backend must be reachable over TLS
  (terminating proxy or managed load balancer) before a production mobile
  build is shipped. **No TLS configuration exists in this repository** — this
  is a manual infrastructure action.

### Impact

| Question | Answer |
|---|---|
| User-session impact | **All existing users are signed out once.** Legacy `agritasks.apiCreds` / `agritasks.apiToken` entries are deleted on first launch and deliberately not migrated. |
| Will existing users be signed out | **Yes**, exactly once. They re-enter their credentials; the new session is stored securely. |
| Mobile application release required | **Yes.** These are client-side changes; they take effect only in a new build. `expo-secure-store` is a native module, so an **OTA/EAS Update cannot deliver this** — a full native rebuild is required. |
| Backend deployment required | **No backend code change.** TLS termination in front of the backend is an infrastructure prerequisite, not a code deployment. |
| Store review / distribution required | **Yes** for public distribution (App Store / Play Store review), since a native rebuild is involved. Internal distribution channels can ship sooner. |

---

## 8. Rollback

### Git rollback

Root repository (documentation and ignore policy):

```
cd C:\BMW_Work\Workspace\Scripts\WebApp_Demp
git checkout main                  # baseline 38b73ee
# or inspect first:
git log --oneline security/wave-0-residual-mobile-hardening
```

Mobile repository (the security implementation):

```
cd C:\BMW_Work\Workspace\Scripts\WebApp_Demp\mobile-app
git log --oneline                  # a96ccc6 <- 340d213 <- aa1dc70 <- 0b42550
git checkout main                  # returns to baseline 0b42550
```

Partial rollback, preferring `revert` over `reset` so history is preserved:

```
git revert a96ccc6                 # tests + docs only
git revert aa1dc70                 # SEC-H06 transport configuration only
```

### Configuration rollback

Unset `EXPO_PUBLIC_*` variables in the EAS build profile and rebuild. Note that
a production build with them unset **will fail closed by design** — that is the
control working, not a regression.

### Mobile release rollback

Re-promote the previously published binary through the store/internal channel.
There is no OTA path, because `expo-secure-store` is a native module.

### Security limitations of rollback

- **Reverting `340d213` reintroduces SEC-H04** — plaintext password persistence
  in AsyncStorage, including the bug where `logout()` never cleared it. **Do
  not do this.**
- **Reverting `aa1dc70` reintroduces SEC-H06** — a hardcoded cleartext endpoint
  and unrestricted Android/iOS transport settings.
- If a functional rollback is genuinely required, roll back **only** to a
  secure, compatible build, or disable persistent login entirely (ship with no
  token persistence, forcing sign-in each launch). Never restore plaintext
  password persistence.
- Rollback does **not** restore deleted legacy storage entries. The purge is
  one-way and intentionally irreversible; users on a rolled-back build would
  simply sign in again.
- Rollback of the mobile changes does not undo the root repository baseline,
  and it should not — E-11/DSO-01 is the mechanism that makes rollback
  possible at all.

---

## 9. Remaining risks

### Unresolved architecture decisions (blocking other waves, not this one)

- **Node versus Rust canonical backend** — undecided. Security fixes must
  currently be applied twice, and divergence between the two trails is itself a
  risk.
- **Open Rust findings** — not implemented this run and not independently
  re-verified beyond the `auth.rs` secret check noted in §2. The rest of the
  Rust trail remains unverified.
- **PostgreSQL implementation blockers** — hosting, version, pooling mode,
  organization/farm parentage, whether current in-memory data is real or
  demonstration data, retention periods and jurisdictions, and the final
  media-storage target all remain open. All persistence work stays blocked.
- **Firestore channel** — `onSnapshot` listeners remain live in
  `ReviewTaskScreen` and `TaskDetailScreen`, and `LoginScreen`'s Google
  sign-in path still authenticates through Firebase Auth **outside** the
  hardened token flow implemented here. That path was deliberately not
  modified. Firestore removal/transition strategy is undecided.
- **Finance authorization** — `farmsFinance.ts` tenant scoping remains open
  (Wave 1). Possible cross-tenant financial access may require legal or
  regulatory assessment by authorized stakeholders.
- **Media path handling** — the `saveMedia` client-controlled extension and
  path-containment concern is unresolved on the server. This run hardened only
  how the **client** resolves media URLs; it does not fix server-side path
  containment.
- **Production seed behaviour** — unreviewed.

### Coverage and verification gaps

- **CI execution status** — `.github/workflows/ci.yml` exists but was not
  executed or validated in this run, and no CI run is available as evidence.
- **Missing independent verification** — Wave 5 has not run. Everything here is
  self-reported implementation evidence.
- **Missing mobile test coverage** — there is no component/integration harness
  (no Detox, no React Native Testing Library). `AuthContext`, `RootNavigator`
  and the screens have **no** automated coverage; the SEC-H04 sign-out path is
  proven at the service layer only. Native secure-storage behaviour is proven
  against a mocked adapter, not real Keychain/Keystore.
- **No secret scanner** in the toolchain or CI.
- **No linter** in the mobile project.
- **Two-repository history** — until `mobile-app` is consolidated or registered
  as a submodule, a single atomic cross-cutting rollback is not possible.
- **Dev-toolchain advisories** — 1 critical (`vitest`) and 1 high (`vite`)
  remain, plus the separately-tracked production-reachable `@fastify/static`
  advisory on the Node backend.

---

## 10. Manual actions required by authorized personnel

1. **Provision TLS for the backend** and publish the HTTPS origin. Until this
   exists there is no valid production `EXPO_PUBLIC_API_URL`.
2. **Set production/staging environment variables** in the EAS build profiles
   (`EXPO_PUBLIC_API_URL`, optionally `EXPO_PUBLIC_WS_URL` /
   `EXPO_PUBLIC_MEDIA_URL`). Confirm `EXPO_PUBLIC_ALLOW_INSECURE_DEV_HTTP` is
   **not** set outside development.
3. **Approve the mobile release** and accept that all users are signed out once.
   Prepare user communication.
4. **Run a device smoke test** on real Android and iOS hardware: fresh install
   login, cold-start session restore, logout, upgrade-from-legacy sign-out, and
   media loading over HTTPS.
5. **Store deployment** — submit the native rebuild for App Store / Play review.
6. **Decide the `mobile-app` repository disposition** — consolidate history or
   register it as a submodule with a remote. Requires authorization because it
   relocates existing history.
7. **Configure a remote and push** — nothing was pushed; no remote is
   configured and no push authorization was available.
8. **External secret rotation** — none required by this change. No secret was
   discovered, exposed or modified in this run.
9. **Legal / regulatory review** — for the separately-tracked possible
   cross-tenant financial access finding, not for this wave.

---

## 11. Implementation status

**Completed.** Root version control established with a clean baseline and a
dedicated security branch; SEC-H04 and SEC-H06 verified as open in current
source and remediated; 57 automated security regression tests added; all
existing suites pass with no new failures; no secret, no sensitive logging and
no unrelated change in the diff. No stop condition was encountered.
