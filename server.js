// server.js
// ---------------------------------------------------------------------------
// VeraDemo JS - Intentionally Vulnerable Demo Application
// ---------------------------------------------------------------------------
// WARNING: This application contains DELIBERATE security vulnerabilities for
// training and tool-demonstration purposes (Veracode Fix). Do NOT deploy it
// anywhere reachable from an untrusted network, and never use this code as a
// starting point for a real application.
//
// Two planted issues:
//   1. SQL Injection in the login route (string-concatenated query).
//   2. Insecure deserialization / RCE via js-yaml's full-schema load on a
//      user-uploaded YAML file.
// ---------------------------------------------------------------------------

const express = require('express');
const session = require('express-session');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const yaml = require('js-yaml');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'demo.db');

// Create the DB on first run if it does not exist yet.
if (!fs.existsSync(DB_PATH)) {
  console.log('No demo.db found - seeding database...');
  require('./db');
}

const db = new sqlite3.Database(DB_PATH);
const upload = multer({ dest: path.join(__dirname, 'uploads') });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: 'verademo-insecure-session-secret',
    resave: false,
    saveUninitialized: true,
  })
);

// --- tiny HTML helpers (keeps the demo single-file, no view engine needed) ---
function page(title, body, opts) {
  const user = opts && opts.user;
  const navlinks = user
    ? `<a href="/config">Config</a><a href="/logout">Log out</a>`
    : `<a href="/login">Log in</a>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · VeraDemo JS</title>
  <style>
    /* Palette borrowed from veracode.com: navy "clarinet" + "blue atoll" cyan accent. */
    :root { --brand: #002856; --brand-dark: #001a3a; --accent: #00b3e6; --bg: #f4f6f8; }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; margin: 0; color: #1a1a1a; background: var(--bg); display: flex; flex-direction: column; min-height: 100vh; }
    .topbar { display: flex; align-items: center; gap: 14px; background: var(--brand); color: #fff; padding: 0 20px; height: 56px; border-bottom: 3px solid var(--accent); box-shadow: 0 1px 4px rgba(0,0,0,.2); }
    .topbar a.home { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: 8px; color: #fff; text-decoration: none; transition: background .15s; }
    .topbar a.home:hover { background: var(--brand-dark); }
    .topbar a.home svg { width: 22px; height: 22px; }
    .topbar .brand { font-weight: 700; font-size: 17px; letter-spacing: .2px; }
    .topbar .spacer { flex: 1; }
    .topbar .navlinks a { color: #bcd9e8; text-decoration: none; margin-left: 18px; font-size: 14px; }
    .topbar .navlinks a:hover { color: var(--accent); }
    .wrap { flex: 1 0 auto; width: 100%; max-width: 720px; margin: 0 auto; padding: 24px 16px 48px; }
    h1 { color: var(--brand); margin-top: 8px; }
    .card { background: #fff; border: 1px solid #e3e7eb; border-radius: 10px; padding: 22px; margin: 16px 0; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
    label { display: block; margin: 8px 0 4px; font-weight: 600; }
    input, button { padding: 9px 10px; font-size: 14px; border-radius: 6px; }
    input[type=text], input[type=password] { width: 100%; border: 1px solid #ccd3da; }
    button { background: var(--brand); color: #fff; border: 0; cursor: pointer; font-weight: 600; }
    button:hover { background: var(--brand-dark); }
    .btn { display: inline-block; background: var(--brand); color: #fff; padding: 9px 16px; border-radius: 6px; text-decoration: none; font-weight: 600; }
    .btn:hover { background: var(--brand-dark); }
    .btn.secondary { background: #fff; color: var(--brand); border: 1px solid #ccd3da; }
    .btn.secondary:hover { background: #eef2f5; }
    .banner { background: #fff3cd; border-bottom: 1px solid #ffeeba; padding: 8px 20px; font-size: 13px; text-align: center; }
    pre { background: #f6f8fa; padding: 12px; border-radius: 6px; overflow-x: auto; }
    .err { color: #b00020; }
    a { color: var(--brand); }
    .empty { text-align: center; padding: 32px 20px; }
    .empty .icon { font-size: 44px; line-height: 1; }
    .empty h2 { margin: 12px 0 6px; color: var(--brand); }
    .empty p { color: #5a6673; margin: 0 0 20px; }
    .actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
    .err-detail { background: #fff5f5; border: 1px solid #ffd0d0; color: #8a1f1f; padding: 12px 14px; border-radius: 6px; white-space: pre-wrap; word-break: break-word; text-align: left; font-size: 13px; line-height: 1.45; margin: 4px 0 20px; }
    footer { flex-shrink: 0; background: var(--brand); border-top: 3px solid var(--accent); color: #bcd9e8; font-size: 12px; text-align: center; padding: 16px; }
  </style>
</head>
<body>
  <nav class="topbar">
    <a class="home" href="/" title="Home" aria-label="Home">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>
      </svg>
    </a>
    <span class="brand">VeraDemo JS</span>
    <span class="spacer"></span>
    <span class="navlinks">${navlinks}</span>
  </nav>
  <div class="banner">⚠️ Intentionally vulnerable demo app.</div>
  <div class="wrap">
    ${body}
  </div>
  <footer>⚠️ Intentionally vulnerable demo app. Do not deploy.</footer>
</body>
</html>`;
}

// --------------------------------------------------------------------------
// Home
// --------------------------------------------------------------------------
app.get('/', (req, res) => {
  const user = req.session.user;
  res.send(
    page(
      'Home',
      `
    <h1>VeraDemo JS</h1>
    <div class="card">
    ${
      user
        ? `<p>Logged in as <strong>${user.username}</strong> (${user.role}).</p>
           <p><a class="btn" href="/config">Upload a YAML config</a></p>`
        : `<p>A small internal tool for managing application configuration.</p>
           <p><a class="btn" href="/login">Log in to continue</a></p>`
    }
    </div>
  `,
      { user }
    )
  );
});

// --------------------------------------------------------------------------
// Login  --  VULNERABILITY #1: SQL Injection
// --------------------------------------------------------------------------
app.get('/login', (req, res) => {
  res.send(
    page(
      'Login',
      `
    <h1>Login</h1>
    <div class="card">
      <form method="POST" action="/login">
        <label for="username">Username</label>
        <input type="text" id="username" name="username" autofocus>
        <label for="password">Password</label>
        <input type="password" id="password" name="password">
        <p><button type="submit">Log in</button></p>
      </form>
    </div>
    <p style="font-size:13px;color:#666">Demo users: <code>admin</code>, <code>alice</code>, <code>bob</code>.</p>
  `
    )
  );
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;

  // !!! VULNERABLE: user input concatenated directly into the SQL string.
  // A value like  admin' --  bypasses the password check entirely.
  const query =
    "SELECT id, username, role FROM users " +
    "WHERE username = '" + username + "' AND password = '" + password + "'";

  db.get(query, (err, row) => {
    if (err) {
      return res.send(
        page(
          'Login',
          `<h1>Login</h1><p class="err">SQL error: ${err.message}</p><pre>${query}</pre><p><a href="/login">Try again</a></p>`
        )
      );
    }
    if (!row) {
      return res.send(
        page(
          'Login',
          `<h1>Login</h1><p class="err">Invalid credentials.</p><p><a href="/login">Try again</a></p>`
        )
      );
    }
    req.session.user = { id: row.id, username: row.username, role: row.role };
    res.redirect('/');
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// --------------------------------------------------------------------------
// YAML config upload  --  VULNERABILITY #2: Insecure js-yaml load -> RCE
// --------------------------------------------------------------------------
app.get('/config', requireAuth, (req, res) => {
  res.send(
    page(
      'Upload Config',
      `
    <h1>Upload application config</h1>
    <div class="card">
      <p>Upload a YAML file describing your settings. The server will parse it
         and run any registered <code>onLoad</code> hook.</p>
      <form method="POST" action="/config" enctype="multipart/form-data">
        <input type="file" name="config" accept=".yaml,.yml">
        <p><button type="submit">Upload &amp; apply</button></p>
      </form>
    </div>
  `,
      { user: req.session.user }
    )
  );
});

app.post('/config', requireAuth, upload.single('config'), (req, res) => {
  if (!req.file) {
    return res.status(400).send(
      page(
        'No file selected',
        `
    <div class="card empty">
      <div class="icon">📄</div>
      <h2>No config file selected</h2>
      <p>Choose a <code>.yaml</code> or <code>.yml</code> file before uploading, then try again.</p>
      <div class="actions">
        <a class="btn" href="/config">← Back to upload</a>
        <a class="btn secondary" href="/">Go home</a>
      </div>
    </div>
  `,
        { user: req.session.user }
      )
    );
  }

  const raw = fs.readFileSync(req.file.path, 'utf8');
  fs.unlink(req.file.path, () => {});

  let config;
  try {
    // !!! VULNERABLE: yaml.load() in js-yaml 3.x uses the FULL schema, which
    // supports the !!js/function type. Parsing attacker-controlled YAML can
    // therefore construct arbitrary functions. The app then invokes the
    // config's onLoad hook, yielding remote code execution.
    config = yaml.load(raw);
  } catch (e) {
    return res.status(400).send(
      page(
        'Config rejected',
        `
    <h1>Config rejected</h1>
    <div class="card">
      <div class="empty" style="padding-bottom:8px">
        <div class="icon">🚫</div>
        <h2>Could not parse the YAML file</h2>
        <p>The file was rejected and no configuration was applied.</p>
      </div>
      <div class="err-detail">${escapeHtml(e.message)}</div>
      <div class="actions">
        <a class="btn" href="/config">← Back to upload</a>
        <a class="btn secondary" href="/">Go home</a>
      </div>
    </div>
  `,
        { user: req.session.user }
      )
    );
  }

  // "Apply" the config: run its lifecycle hook if present.
  let hookOutput = '(no onLoad hook)';
  if (config && typeof config.onLoad === 'function') {
    try {
      const result = config.onLoad();
      hookOutput = result === undefined ? '(hook ran, no return value)' : String(result);
    } catch (e) {
      hookOutput = 'hook error: ' + e.message;
    }
  }

  res.send(
    page(
      'Config applied',
      `
    <h1>Config applied</h1>
    <div class="card">
      <p>Parsed keys: <code>${config && typeof config === 'object' ? Object.keys(config).join(', ') : typeof config}</code></p>
      <h3>onLoad hook output</h3>
      <pre>${escapeHtml(hookOutput)}</pre>
      <p><a class="btn" href="/config">Upload another</a></p>
    </div>
  `,
      { user: req.session.user }
    )
  );
});

// --------------------------------------------------------------------------
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

app.listen(PORT, () => {
  console.log(`VeraDemo JS listening on http://localhost:${PORT}`);
  console.log('Running as UID:', typeof process.getuid === 'function' ? process.getuid() : 'n/a (non-POSIX)');
});
