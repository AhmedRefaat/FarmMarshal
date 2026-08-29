# Static demo deployment (GitHub Pages)

**Read this before touching `webapp/client/src/demo/`, `vite.config.ts`, or
`.github/workflows/pages.yml`.**

This document exists so the offline-demo mechanism is not rediscovered from
scratch later. It answers three questions: why it exists, how it works, and
what it deliberately does *not* do.

---

## 1. Why

GitHub Pages is a **static file host**. It serves HTML, CSS, JS and images. It
cannot run a process, so neither backend in this repository can be deployed
there:

| Component | Runs on Pages? |
|---|---|
| `webapp/client` (Vite + React) | ✅ it is just static files after `vite build` |
| `webapp/server-node` (Fastify) | ❌ needs a Node process |
| `webapp/server-rust` (Axum) | ❌ needs a binary process |

A React app with no reachable API shows a login screen that never logs in. To
get a *shareable, zero-infrastructure* stakeholder demo, the client ships with
a recorded copy of the API baked into the bundle.

---

## 2. How — record and replay

The design is **record-and-replay**, not re-implementation.

```
server-node (real API, running locally)
        │
        │  scripts/record-demo-fixture.mjs
        │  logs in as each demo persona, walks every GET the UI makes
        ▼
src/demo/fixture.json          ~120 KB, committed to git
        │
        │  src/demo/demoApi.ts   replays it in the browser
        ▼
src/api.ts   `if (DEMO_MODE) return demoRequest(...)`
```

Why recording rather than hand-written mocks: the fixture is captured from the
real server, so response shapes, field names, ordering and **role-scoped 403s**
are correct by construction. When the server changes, you re-record instead of
hand-patching mocks that have silently drifted.

### The files

| File | Role |
|---|---|
| `webapp/client/scripts/record-demo-fixture.mjs` | Recorder. Run against a live Node server. |
| `webapp/client/src/demo/fixture.json` | The recording. Committed. |
| `webapp/client/src/demo/demoApi.ts` | In-browser replay + write handling. |
| `webapp/client/src/api.ts` | Single `if (DEMO_MODE)` branch at the top of `request()`. |
| `webapp/client/src/assets.ts` | `asset()` — base-path-aware URLs for `public/` files. |
| `.github/workflows/pages.yml` | Builds with the demo flags and deploys. |

### Writes

Reads are pure replay. Writes are handled in `demoApi.ts` against the
in-memory copy of the fixture, so the demo *feels* interactive: adding a
comment, transitioning a task (the `TRANSITIONS` table mirrors
`server-node/src/routes/tasks.ts`), creating a task, rating, logging a finance
entry, consultations and chat. Anything not on that list returns **501 — not
available in the offline demo**.

---

## 3. Deliberate limits — do NOT report these as bugs

1. **Nothing persists.** A page reload restores the pristine fixture.
2. **Derived aggregates are only partly recomputed.** The finance summary is
   recalculated after a write; other rollups (dashboard KPIs, expert stats)
   still show the recorded values.
3. **"Login" is theatre, not authentication.** `demoApi.ts` contains the demo
   credentials in plain text and issues a fake `demo:` token. This is safe
   only because there is no server and no real data behind it. **Never point
   demo mode at real user data.**

---

## 4. Refreshing the fixture

Required whenever the seed data or an API response shape changes.

```powershell
# 1. start the real API
cd webapp/server-node; npm run dev

# 2. in another shell, record
cd webapp/client; npm run record:demo

# 3. commit the result
git add src/demo/fixture.json
```

The recorder targets `http://localhost:3000` unless `RECORD_API_URL` is set.
It prints a per-persona response count; a sudden drop means the server was
returning errors.

---

## 5. Build flags

| Variable | Meaning |
|---|---|
| `VITE_DEMO_MODE=1` | Replay the fixture instead of calling the API. Off by default, so normal dev and normal deploys are unaffected. |
| `VITE_BASE=/RepoName/` | Sub-path the site is served from. Defaults to `/`. |

Local production-parity check:

```powershell
cd webapp/client
$env:VITE_DEMO_MODE='1'; $env:VITE_BASE='/FarmMarshal/'
npm run build
Copy-Item dist/index.html dist/404.html
npx vite preview --base /FarmMarshal/
# then clear them so the dev server is unaffected:
Remove-Item Env:VITE_DEMO_MODE, Env:VITE_BASE
```

---

## 6. Base-path traps

A project site is served from `https://<user>.github.io/<repo>/`, not from `/`.
Four things break under a sub-path, and all four are already handled — keep
them that way:

1. **Images in `public/`.** Vite does *not* rewrite absolute paths like
   `/images/x.jpg`. Always use `asset('images/x.jpg')` from `src/assets.ts`.
2. **CSS `url()`.** Stylesheets cannot read `import.meta.env.BASE_URL`. The
   login background is passed in as the `--login-photo` custom property from
   `main.tsx`.
3. **The router.** `<BrowserRouter basename={import.meta.env.BASE_URL}>` —
   without it every route 404s.
4. **Deep links.** Pages has no rewrite rule, so the workflow copies
   `index.html` to `404.html`. It is copied *after* the build, not kept in
   `public/`, so it always references the current hashed asset names.

---

## 7. Deploying

One-time: repository **Settings → Pages → Source = GitHub Actions**.

After that, pushes to `main` that touch `webapp/client/**` deploy
automatically; the workflow can also be triggered manually from the Actions
tab. The site lands at `https://<user>.github.io/<repo>/`.

`VITE_BASE` is derived from `github.event.repository.name`, so renaming the
repository does not break the build.

---

## 8. If you want a real backend instead

Pages cannot do it. The options are a container host (Fly.io, Render,
Railway) for `server-node` or `server-rust`, or serverless functions with a
managed Postgres — see `specs/POSTGRESQL_TARGET_ARCHITECTURE.md`. In that
case, drop `VITE_DEMO_MODE` and set `VITE_API_URL` to the deployed API.
