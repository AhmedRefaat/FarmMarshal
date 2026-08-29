# Secret Rotation Runbook — `AUTH_SECRET`

**Audience:** operators running FarmMarshal (Node trail and/or Rust trail)
**Applies to:** every environment (development, test, staging, production)
**Status:** first secure runbook for this repository — created during Wave 0

---

## 1. Why this exists

Until the Wave 0 change, both backends fell back to a token-signing secret that
was **committed to this repository in plaintext**:

- `webapp/server-node/src/security/config.ts` — `INSECURE_LEGACY_SECRET`
- `webapp/server-rust/src/auth.rs` — inline literal in `secret()`

Anyone who could read the source could mint a valid token for any user id and
any role — including `admin` — against any instance where `AUTH_SECRET` was not
set. Tokens are stateless HMAC-SHA256 blobs with a 7-day TTL and **no server
side revocation list**, so the only way to invalidate outstanding tokens is to
change the signing key.

The code fix removes the fallback. **The code fix alone does not undo prior
exposure.** Rotation is a manual operational action and is described below.

> The literal itself is retained in source **only as a deny-list entry** so the
> servers refuse to start if anyone re-supplies it. It is burned permanently.

---

## 2. Threat assumption

Treat **every token issued before rotation completes as forged**, regardless of
which user it claims to represent. Do not attempt to distinguish "legitimate"
from "forged" pre-rotation tokens — the signature proves nothing while the key
is public.

---

## 3. Generate a new secret

Generate it **outside the repository**, on an operator workstation or in your
secret manager. Never write it into a file that git tracks, a Dockerfile, a
`docker-compose.yml`, a CI config, a ticket, or a chat message.

```bash
# Linux / macOS
openssl rand -hex 32
```

```powershell
# Windows PowerShell
[Convert]::ToHexString((New-Object byte[] 32 | ForEach-Object { $_ }) ) # see note
# Preferred:
python -c "import secrets; print(secrets.token_hex(32))"
```

Requirements enforced by both backends at startup:

| Rule | Value |
|---|---|
| Minimum length | 32 characters |
| Placeholder deny-list | `agritasks-dev-secret`, `changeme`, `change-me`, `secret`, `password`, `todo`, `placeholder`, `your-secret-here`, `xxxxxxxx` (case- and whitespace-insensitive) |
| Minimum distinct characters | 8 |

A 64-character hex string from either command above satisfies all three.

---

## 4. Distribute

`AUTH_SECRET` is read by **both** trails:

| Component | Variable | Read at |
|---|---|---|
| `webapp/server-node` | `AUTH_SECRET` | `src/security/config.ts` → `resolveAuthSecret()` |
| `webapp/server-rust` | `AUTH_SECRET` | `src/auth.rs` → `init()` → `security::resolve_auth_secret()` |

**Both trails must receive the identical value** if they serve the same clients,
because a token issued by one is verified by the other. If you intend to run
them as separate token realms, that is a deliberate decision and must be
recorded in your deployment documentation — it is not the default.

Set the variable through your platform's secret mechanism:

- Kubernetes → `Secret` + `envFrom` / `valueFrom.secretKeyRef`
- systemd → `EnvironmentFile=` on a `0600` file outside the repo
- Docker → `--env-file` on a file outside the build context, or a swarm secret
- CI/CD → the platform's encrypted variable store, marked masked/protected

Do **not** use `docker run -e AUTH_SECRET=...` on a shared host: the value is
visible in `ps` and in the container inspect output.

---

## 5. Rotate

1. Generate the new value (§3) and store it in the secret manager.
2. Update the secret for **every** environment and **every** component that
   verifies tokens (Node and Rust).
3. Restart all backend processes. There is no hot-reload path; the key is
   resolved once per process via `OnceLock` (Rust) / module init (Node).
4. Confirm each process logged a valid configuration line (§6).
5. Notify users that they must sign in again. All existing sessions are dead by
   design — that is the point of the rotation.

**Expected user impact:** every active session is invalidated. Schedule
accordingly, but do not delay rotation for convenience while the old key is
known to be public.

---

## 6. Verify

On boot each backend emits one line describing the signing configuration. It
contains **provenance and length only — never the value**.

Node (`src/index.ts` CLI entry):

```
auth signing configuration { source: 'environment', env: 'production', length: 64 }
```

Rust (`src/main.rs`):

```
auth signing configuration source=environment env=production length=64
```

Checks:

- `source` must be `environment`. If it says `ephemeral-development`, the
  variable was not delivered to the process and it is running on a throwaway
  per-process key.
- `length` must match the length of the value you generated.
- A misconfigured process **must not be running at all**: outside
  `development`/`test`, a missing, blank, placeholder, short or low-entropy
  value causes startup to fail (Node throws `SecurityConfigError`; Rust panics
  in `auth::init()`).

Negative check — confirm an old token is dead:

```bash
curl -i -H "Authorization: Bearer <a token captured before rotation>" \
     https://<host>/finances
# expect: HTTP/1.1 401
```

---

## 7. Development and test environments

`development` and `test` do **not** require `AUTH_SECRET`. When it is absent
they mint a **random per-process key**:

- Node — `randomBytes(32).toString('hex')`, memoised per process
- Rust — two concatenated UUIDv4 values from the OS RNG

Consequences, both intentional:

- No usable secret exists anywhere in the source tree.
- Restarting a dev server invalidates its own tokens, so developers exercise the
  re-authentication path routinely.
- Node and Rust dev instances started independently will **not** accept each
  other's tokens. Set the same `AUTH_SECRET` in both shells when you need
  cross-trail parity locally.

Supplying a value in development is still validated: placeholders, short values
and low-entropy values are rejected in every environment.

---

## 8. If a secret is exposed again

1. Rotate immediately (§3–§6). Do not wait for a maintenance window.
2. Purge the value from wherever it leaked (log aggregator, CI output, chat).
   If it reached git history, rotating is mandatory — history rewriting alone is
   not sufficient.
3. Review authentication and authorization logs for the exposure window. Every
   backend denial is logged with a correlation id (`X-Correlation-Id` response
   header) and no secret material.
4. Record the incident, the exposure window and the rotation timestamp.

---

## 9. Roadmap notes (not Wave 0 work)

The following materially reduce rotation pain and are tracked outside this
runbook:

- **Key ids / dual-key verification** — accept the previous key for a short
  overlap so rotation does not force an immediate mass re-login.
- **Server-side revocation** — a token id (`jti`) plus a deny-list would allow
  revoking individual sessions without a global rotation.
- **Scheduled rotation** — routine rotation (for example quarterly) so the
  procedure is exercised before it is needed in an incident.
