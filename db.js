// db.js - creates and seeds the demo SQLite database.
// Run with: npm run init-db
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'demo.db');

const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run('DROP TABLE IF EXISTS users');
  db.run(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user'
  )`);

  const stmt = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)');
  // Demo credentials (plaintext on purpose - this is a vulnerable demo app).
  stmt.run('admin', 'S3cr3tAdminPass!', 'admin');
  stmt.run('alice', 'password123', 'user');
  stmt.run('bob', 'hunter2', 'user');
  stmt.finalize();

  console.log('Seeded demo database at', DB_PATH);
  console.log('Users: admin / alice / bob');
});

db.close();

module.exports = { DB_PATH };
