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
function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · VeraDemo JS</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; color: #1a1a1a; }
    h1 { color: #003f5c; }
    .card { border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin: 16px 0; }
    label { display: block; margin: 8px 0 4px; font-weight: 600; }
    input, button { padding: 8px; font-size: 14px; }
    input[type=text], input[type=password] { width: 100%; box-sizing: border-box; }
    button { background: #003f5c; color: #fff; border: 0; border-radius: 6px; cursor: pointer; }
    .banner { background: #fff3cd; border: 1px solid #ffeeba; padding: 10px; border-radius: 6px; font-size: 13px; }
    pre { background: #f6f8fa; padding: 12px; border-radius: 6px; overflow-x: auto; }
    .err { color: #b00020; }
    a { color: #003f5c; }
  </style>
</head>
<body>
  <div class="banner">⚠️ Intentionally vulnerable demo app — for Veracode Fix demonstrations only.</div>
  ${body}
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
    ${
      user
        ? `<p>Logged in as <strong>${user.username}</strong> (${user.role}).</p>
           <p><a href="/config">Upload a YAML config</a> · <a href="/logout">Log out</a></p>`
        : `<p>Please <a href="/login">log in</a> to continue.</p>`
    }
  `
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
  `
    )
  );
});

app.post('/config', requireAuth, upload.single('config'), (req, res) => {
  if (!req.file) {
    return res.send(page('Upload Config', `<p class="err">No file uploaded.</p>`));
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
    return res.send(
      page('Upload Config', `<h1>Config</h1><p class="err">Parse error: ${e.message}</p>`)
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
    <p>Parsed keys: <code>${config && typeof config === 'object' ? Object.keys(config).join(', ') : typeof config}</code></p>
    <h3>onLoad hook output</h3>
    <pre>${escapeHtml(hookOutput)}</pre>
    <p><a href="/config">Upload another</a></p>
  `
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
