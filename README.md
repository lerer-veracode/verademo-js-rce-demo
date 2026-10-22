# VeraDemo JS — SQL Injection + js-yaml RCE demo

> ⚠️ **Intentionally vulnerable.** This app contains deliberate security flaws
> for demonstrating **Veracode Fix** (and SCA/SAST findings). Do **not** deploy
> it on an untrusted network, and never reuse this code in a real project.

A tiny Express app with two planted vulnerabilities:

| # | Vulnerability | Where | Veracode surface |
|---|---------------|-------|------------------|
| 1 | **SQL Injection** | `POST /login` — user input concatenated into the SQL string (`server.js`) | SAST |
| 2 | **Insecure deserialization → RCE** | `POST /config` — `yaml.load()` on an uploaded YAML file using `js-yaml@3.12.0` (full schema, supports `!!js/function`) | SAST + SCA (vulnerable `js-yaml`) |

It also ships an **insecure Dockerfile** that runs the container **as root** and
bakes "secret" env vars into the image, so the RCE can show privilege and
secret exposure.

---

## Run it (Docker)

Run the app in Docker so the RCE demo shows real privilege and secret exposure:
the container runs as **root** (`uid 0`), the exploit payloads use Linux commands
(`id`, `/etc/passwd`), and the "secret" env vars are baked into the image.

```bash
docker compose up --build
# visit http://localhost:3000
```

### Docker commands used in the demo

| Command | What it does |
|---------|--------------|
| `docker compose up --build` | Build the image (if needed) and start the app in the foreground. |
| `docker compose up --build -d` | Same, but run detached (in the background). |
| `docker compose build` | Rebuild the image from the current code **without** starting it. |
| `docker compose build --no-cache` | Rebuild from scratch, ignoring cached layers (reinstalls dependencies — use after a `package.json` change, e.g. restoring the vulnerable `js-yaml`). |
| `docker compose down` | Stop and remove the running container. |

Typical loop while demoing a code change:

```bash
# 1. stop the running app
docker compose down
# 2. rebuild the image from the latest code
docker compose build
# 3. start it again
docker compose up
```

Or do all three at once: `docker compose up --build`. The image copies the code
at **build time**, so every code change needs a rebuild (`--build`) before the
container reflects it — press `Ctrl+C` to stop a foreground run first.

Demo users (seeded in `db.js`): `admin` / `alice` / `bob`.

---

## Demo script

### Part 1 — SQL Injection
1. Go to `/login`.
2. Enter username `admin' --` and any password. The trailing `--` comments out
   the password check, logging you in as **admin** without credentials.
   - Query becomes:
     `SELECT ... WHERE username = 'admin' --' AND password = '...'`
3. Variant to dump any user: `' OR '1'='1`.

### Part 2 — js-yaml RCE
1. Log in (legitimately or via Part 1), go to `/config`.
2. Upload `payloads/safe-config.yaml` → parses normally, no hook.
3. Upload `payloads/exploit-env-dump.yaml` → the `!!js/function` `onLoad` hook
   runs and the page prints:
   - `process uid : 0  <-- RUNNING AS ROOT` (in the container)
   - the full `process.env`, including `APP_SECRET` / `DB_PASSWORD`.
4. Upload `payloads/exploit-command.yaml` → runs `id` and reads `/etc/passwd`
   to show arbitrary OS command execution.

### Part 3 — Fix with Veracode
1. **Scan the app** — run a scan with the Veracode extension in the IDE to
   surface the findings (the SQL injection, the insecure `js-yaml` usage, and
   the vulnerable `js-yaml@3.12.0` dependency).
2. **Apply a Veracode Fix** — open the SQL injection finding, review the
   suggested remediation, and apply the Veracode Fix to the `/login` query
   (turning the concatenated string into a parameterized statement).
3. **Rebuild and verify** — stop, rebuild, and start the app again in Docker,
   then confirm the issue is resolved:

   ```bash
   docker compose down
   docker compose build
   docker compose up
   ```

   Re-run the Part 1 injection (`admin' --`); it should no longer log you in,
   confirming the fix works end to end.

### Part 4 — Fix the vulnerable `js-yaml` dependency
1. **Upgrade the dependency** — in `package.json`, change `js-yaml` from
   `3.12.0` to `^4.1.0`. (A patch bump within 3.x is **not** enough — the unsafe
   `!!js/function` type exists throughout 3.x and was only removed in 4.0, where
   `load()` is safe by default.)

   ```json
   "js-yaml": "^4.1.0"
   ```

2. **Rebuild and deploy** — because `package.json` changed, rebuild the image
   from scratch so the new version is installed, then start it again:

   ```bash
   docker compose down
   docker compose build --no-cache
   docker compose up
   ```

3. **Verify** — re-upload `payloads/exploit-env-dump.yaml` (or any
   `exploit-*.yaml`). It should now be **rejected** with a parse error
   (`unknown tag !<tag:yaml.org,2002:js/function>`) and no hook runs, confirming
   the RCE is resolved. `payloads/safe-config.yaml` still parses normally.

   Optionally confirm the installed version directly:

   ```bash
   docker compose exec verademo node -e "console.log(require('js-yaml/package.json').version)"
   ```

---

## Files
```
server.js                      Express app (both vulnerabilities)
db.js                          SQLite schema + seed data
package.json / package-lock.json  Dependencies (SCA manifest; pins js-yaml@3.12.0)
Dockerfile / docker-compose.yml  Insecure container (runs as root)
.dockerignore                  Keeps host node_modules out of the Linux image
payloads/safe-config.yaml      Benign YAML
payloads/exploit-env-dump.yaml RCE: dump uid + env vars
payloads/exploit-command.yaml  RCE: run OS commands
payloads/exploit-version.yaml  RCE: report the js-yaml version in the container
```

## Re-securing checklist (post-demo reference)
- [ ] Parameterized SQL queries everywhere.
- [ ] `js-yaml` ≥ 4 with safe schema; never `load()` untrusted YAML with the full schema.
- [ ] Never invoke functions sourced from parsed data.
- [ ] Dockerfile: add a non-root `USER`, drop capabilities, keep secrets out of the image (use runtime secrets).
- [ ] Hash passwords; don't store plaintext.
