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

## Run it

### Locally
```bash
npm install
npm run init-db     # seeds demo.db (optional; server auto-seeds on first run)
npm start           # http://localhost:3000
```

### In Docker (recommended for the root / env-exposure part)
```bash
docker compose up --build
# visit http://localhost:3000
```

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
- **SQL Injection:** let Veracode Fix rewrite the `/login` query to a
  parameterized statement (`db.get('... WHERE username = ? AND password = ?', [username, password], ...)`).
- **js-yaml:** Veracode flags the insecure `yaml.load()` call and the vulnerable
  `js-yaml@3.12.0` dependency. The fix is to upgrade `js-yaml` (4.x) and use the
  safe default `load()` (or `JSON_SCHEMA`), which rejects `!!js/function`. After
  the fix, re-uploading `exploit-*.yaml` fails to parse / produces no hook.
- Call out the **container hardening** gaps (runs as root, secrets in image) as
  additional findings beyond what Fix rewrites.

---

## Files
```
server.js                      Express app (both vulnerabilities)
db.js                          SQLite schema + seed data
Dockerfile / docker-compose.yml  Insecure container (runs as root)
payloads/safe-config.yaml      Benign YAML
payloads/exploit-env-dump.yaml RCE: dump uid + env vars
payloads/exploit-command.yaml  RCE: run OS commands
```

## Re-securing checklist (post-demo reference)
- [ ] Parameterized SQL queries everywhere.
- [ ] `js-yaml` ≥ 4 with safe schema; never `load()` untrusted YAML with the full schema.
- [ ] Never invoke functions sourced from parsed data.
- [ ] Dockerfile: add a non-root `USER`, drop capabilities, keep secrets out of the image (use runtime secrets).
- [ ] Hash passwords; don't store plaintext.
