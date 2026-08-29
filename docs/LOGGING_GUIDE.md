# FarmMarshal — Logging Guide (dev vs customer vs off)

**Owner requirement:** see the app's logs, enable/disable them overall, and separate
*customer* logging from *developer* logging. This guide is the single reference.

---

## 1. Server (`webapp/server-node`)

Two environment variables — no code changes ever needed:

| Variable | Values | Effect |
|---|---|---|
| `LOG_LEVEL` | `off` \| `error` \| `warn` \| `info` *(default)* \| `debug` | `off` = **total silence** (even HTTP request logs disappear). Each step up adds more detail. |
| `LOG_FORMAT` | `dev` *(default outside production)* \| `json` *(default in production)* | `dev` = coloured human-readable terminal lines. `json` = one machine-parseable JSON object per line for log collectors (CloudWatch/Datadog/ELK). |

```bash
# Developer: everything including internal decisions
LOG_LEVEL=debug npm run dev

# Production/customer default: milestones + warnings only, collector-ready
LOG_FORMAT=json npm start

# Turn logging OFF entirely (audit trail in the DATABASE still runs!)
LOG_LEVEL=off npm start
```

### What gets logged at each level

| Level | Examples (scope in brackets) |
|---|---|
| `error` | unhandled failures |
| `warn` | permission denials `[authz]`, plan-gated 402s `[entitlements]`, rejected uploads `[http]`, leak suspects `[agri]`, verification verdicts `[v2]`/`[features]`, subscription/persona changes `[v2]` — the security/revenue signals worth alerting on |
| `info` | boot config `[boot]`, stage transitions `[issues]`, messages sent `[chat]`, evidence stored `[http]`, valve commands `[agri]`, reports generated `[agri]`, cases published `[community]`, attempts graded `[community]` |
| `debug` | granted permission checks `[authz]`, duplicate-send collapse `[chat]`, mobile poll ticks `[chatService]`/`[taskService]`, WS lifecycle `[features]` |

**Scope index:** `boot` · `http` · `authz` · `issues` · `entitlements` · `chat` · `agri` ·
`community` · `v2` · `features` — grep any of them in JSON mode: `"scope":"chat"`.

### Hard rules
- Logging **never throws** and never blocks a request.
- **Audit ≠ logs**: `audit_log` (DB) records security-relevant actions and runs even when
  `LOG_LEVEL=off`. Logs are ephemeral; audit is compliance evidence.
- Secrets (passwords/tokens/user content) are never logged — identifiers only.

## 2. Mobile app (`mobile-app/src/services/logger.ts`)

| Build | Default behaviour |
|---|---|
| Dev client (`__DEV__`) | full `debug` output in Metro/adb console |
| Release build | silent except `error` (customer devices leak nothing) |
| Any build + `LOG_LEVEL=off` env (via EAS/app config) | completely off |

Usage identical to server: `const log = makeLogger('taskService')`. Wired into
`webApi` (failed requests/uploads), `taskService` (offline polls — debug), `auth`
(login/register/logout outcomes, never credentials), `chatService` (poll ticks/failures).

## 3. Code-comment convention (for new team members)

Every module carries a file-header block containing:
1. **WHAT it does** — plain-language summary.
2. **HOW it works / decision order** — the mental model (e.g. `issues.ts` lists the exact
   5-step transition judgment).
3. **REQUIREMENT TRACEABILITY** — pointers to the governing docs/sections:
   - `docs/V2_REQUIREMENTS_ANALYSIS.md` §G0.x / F# (owner requirements)
   - `docs/ARCHITECTURE_EVOLUTION_PLAN.md` ADR-### (decisions)
   - `docs/SUBSCRIPTION_AND_PAYMENTS_DESIGN.md`, `docs/ROBOT_INTEGRATION_SPEC.md`,
     `docs/READINESS_REVIEW.md` as applicable.
4. Inline comments explain WHY at decision points; requirement IDs appear where a line
   implements a specific mandate (e.g. `// R1 geo-evidence…`, `// ADR-011 offline tolerance`).

When you add code: no header traceability block → PR review blocks. When an owner
requirement changes: update the doc first, then the tag, then the code.
