/* ============================================================
   Quietly Here — Database layer (libSQL / Turso-compatible)
   - Local dev:  uses a file (data/quietly.db) — no account needed.
   - Production: set TURSO_URL + TURSO_AUTH_TOKEN for a free, persistent
                 cloud database (works on Render's free tier — no disk needed).
   ============================================================ */
"use strict";
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { createClient } = require("@libsql/client");

/* ---------- pick the database target ---------- */
let client;
if (process.env.TURSO_URL) {
  client = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  console.log("[db] Using Turso cloud database.");
} else {
  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  client = createClient({ url: "file:" + path.join(DATA_DIR, "quietly.db") });
  console.log("[db] Using local SQLite file.");
}

/* ---------- tiny query helpers (async) ---------- */
const q = {
  async get(sql, args = []) { return (await client.execute({ sql, args })).rows[0] || null; },
  async all(sql, args = []) { return (await client.execute({ sql, args })).rows; },
  async run(sql, args = []) {
    const r = await client.execute({ sql, args });
    return { changes: Number(r.rowsAffected || 0), lastInsertRowid: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : null };
  }
};

/* ---------- password hashing (scrypt, no external deps) ---------- */
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}
function verifyPassword(password, salt, expected) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const now = () => new Date().toISOString();

/* ---------- migrations: add columns to tables that predate them ----------
   CREATE TABLE IF NOT EXISTS won't alter an existing table, so older
   databases (e.g. an earlier deploy) may be missing device_id / ip columns.
   ADD COLUMN is idempotent here because we check the existing columns first. */
async function migrate() {
  const cols = async (table) =>
    (await q.all(`PRAGMA table_info(${table})`)).map((r) => r.name);
  const ensure = async (table, col, type) => {
    const existing = await cols(table);
    if (!existing.includes(col)) {
      await client.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
      console.log(`[db] migrated: added ${table}.${col}`);
    }
  };
  await ensure("stories", "device_id", "TEXT");
  await ensure("stories", "ip", "TEXT");
  await ensure("comments", "device_id", "TEXT");
  await ensure("comments", "ip", "TEXT");
  await ensure("reports", "device_id", "TEXT");
  await ensure("reports", "ip", "TEXT");
  await ensure("stories", "user_id", "INTEGER");
  await ensure("reports", "user_id", "INTEGER");
  await ensure("comments", "user_id", "INTEGER");
  await ensure("users", "agreed_terms_at", "TEXT");
  await ensure("users", "reset_token", "TEXT");
  await ensure("users", "reset_sent_at", "TEXT");
}

/* ---------- schema ---------- */
const SCHEMA = [
`CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'en',
  title TEXT NOT NULL, title_alt TEXT, pull TEXT, excerpt TEXT, body TEXT NOT NULL,
  author TEXT NOT NULL, contact TEXT, tough INTEGER NOT NULL DEFAULT 0, helpline INTEGER NOT NULL DEFAULT 0,
  mins INTEGER NOT NULL DEFAULT 3, reads INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
  reject_note TEXT, created_at TEXT NOT NULL, published_at TEXT, device_id TEXT, ip TEXT )`,
`CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, story_id INTEGER NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0, loves INTEGER NOT NULL DEFAULT 0, cares INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0, device_id TEXT, ip TEXT, created_at TEXT NOT NULL )`,
`CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, comment_id INTEGER NOT NULL, reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', device_id TEXT, ip TEXT, created_at TEXT NOT NULL )`,
`CREATE TABLE IF NOT EXISTS reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, comment_id INTEGER NOT NULL, device_id TEXT NOT NULL,
  type TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(comment_id, device_id) )`,
`CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, value TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(kind, value) )`,
`CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL, created_at TEXT NOT NULL )`,
`CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, admin_id INTEGER NOT NULL, created_at TEXT NOT NULL )`,
`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  pass_hash TEXT NOT NULL, pass_salt TEXT NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 0, confirm_token TEXT, confirm_sent_at TEXT,
  created_at TEXT NOT NULL )`,
`CREATE TABLE IF NOT EXISTS user_sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TEXT NOT NULL )`,
`CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 0, confirm_token TEXT,
  unsub_token TEXT, source TEXT, created_at TEXT NOT NULL )`
];

/* ---------- seed + init ---------- */
async function init() {
  for (const stmt of SCHEMA) await client.execute(stmt);
  await migrate();

  const adminCount = Number((await q.get("SELECT COUNT(*) n FROM admins")).n);
  if (adminCount === 0) {
    const username = process.env.ADMIN_USER || "moderator";
    const password = process.env.ADMIN_PASS || "quietly2026";
    const { hash, salt } = hashPassword(password);
    await q.run("INSERT INTO admins (username,pass_hash,pass_salt,created_at) VALUES (?,?,?,?)", [username, hash, salt, now()]);
    console.log(`[db] Seeded admin -> username: "${username}"${process.env.ADMIN_PASS ? "" : `  password: "${password}"`}`);
  }

  const storyCount = Number((await q.get("SELECT COUNT(*) n FROM stories")).n);
  if (storyCount === 0) {
    const seedStories = require("./seed-data.js");
    for (const s of seedStories) {
      const info = await q.run(
        `INSERT INTO stories (topic,lang,title,title_alt,pull,excerpt,body,author,contact,tough,helpline,mins,reads,status,created_at,published_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'published', ?, ?)`,
        [s.topic, s.lang, s.title, s.titleSw || null, s.pull || null, s.excerpt || null,
         s.body.join("\n\n"), s.author, null, s.tough ? 1 : 0, s.helpline ? 1 : 0,
         s.mins || 3, s.reads || 0, s.date + "T08:00:00.000Z", s.date + "T08:00:00.000Z"]
      );
      for (const c of (s.comments || [])) {
        await q.run("INSERT INTO comments (story_id,name,text,likes,loves,cares,created_at) VALUES (?,?,?,?,?,?,?)",
          [info.lastInsertRowid, c.name, c.text, c.likes || 0, c.loves || 0, c.cares || 0, now()]);
      }
    }
    console.log(`[db] Seeded ${seedStories.length} starter stories.`);
  }
}

module.exports = { q, init, hashPassword, verifyPassword, now, client };
