/* ============================================================
   Quietly Here — Database layer (SQLite, file-based)
   The whole database lives in one file: data/quietly.db
   ============================================================ */
"use strict";
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Database = require("better-sqlite3");

// DATA_DIR can be pointed at a host's persistent disk via env (e.g. Render/Railway/Fly).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "quietly.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/* ---------- schema ---------- */
db.exec(`
CREATE TABLE IF NOT EXISTS stories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  topic        TEXT NOT NULL,
  lang         TEXT NOT NULL DEFAULT 'en',
  title        TEXT NOT NULL,
  title_alt    TEXT,
  pull         TEXT,
  excerpt      TEXT,
  body         TEXT NOT NULL,            -- paragraphs joined by \\n\\n
  author       TEXT NOT NULL,            -- pen name
  contact      TEXT,                     -- email / whatsapp (private, moderator only)
  tough        INTEGER NOT NULL DEFAULT 0,
  helpline     INTEGER NOT NULL DEFAULT 0,
  mins         INTEGER NOT NULL DEFAULT 3,
  reads        INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | published | rejected
  reject_note  TEXT,
  created_at   TEXT NOT NULL,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id   INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  text       TEXT NOT NULL,
  likes      INTEGER NOT NULL DEFAULT 0,
  loves      INTEGER NOT NULL DEFAULT 0,
  cares      INTEGER NOT NULL DEFAULT 0,
  hidden     INTEGER NOT NULL DEFAULT 0,
  device_id  TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  reason     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open',   -- open | resolved
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blocks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,   -- name | device
  value      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(kind, value)
);

CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  pass_hash     TEXT NOT NULL,
  pass_salt     TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  admin_id   INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
`);

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

/* ---------- seed: default admin + starter stories ---------- */
const now = () => new Date().toISOString();

function seed() {
  const adminCount = db.prepare("SELECT COUNT(*) n FROM admins").get().n;
  if (adminCount === 0) {
    const username = process.env.ADMIN_USER || "moderator";
    const password = process.env.ADMIN_PASS || "quietly2026";
    const { hash, salt } = hashPassword(password);
    db.prepare(
      "INSERT INTO admins (username, pass_hash, pass_salt, created_at) VALUES (?,?,?,?)"
    ).run(username, hash, salt, now());
    console.log(`[db] Seeded admin -> username: "${username}"  password: "${password}"`);
  }

  const storyCount = db.prepare("SELECT COUNT(*) n FROM stories").get().n;
  if (storyCount === 0) {
    const seedStories = require("./seed-data.js");
    const insStory = db.prepare(`
      INSERT INTO stories (topic,lang,title,title_alt,pull,excerpt,body,author,contact,tough,helpline,mins,reads,status,created_at,published_at)
      VALUES (@topic,@lang,@title,@title_alt,@pull,@excerpt,@body,@author,@contact,@tough,@helpline,@mins,@reads,'published',@created_at,@published_at)
    `);
    const insComment = db.prepare(`
      INSERT INTO comments (story_id,name,text,likes,loves,cares,created_at)
      VALUES (?,?,?,?,?,?,?)
    `);
    const tx = db.transaction((stories) => {
      for (const s of stories) {
        const info = insStory.run({
          topic: s.topic, lang: s.lang, title: s.title, title_alt: s.titleSw || null,
          pull: s.pull || null, excerpt: s.excerpt || null,
          body: s.body.join("\n\n"), author: s.author, contact: null,
          tough: s.tough ? 1 : 0, helpline: s.helpline ? 1 : 0,
          mins: s.mins || 3, reads: s.reads || 0,
          created_at: s.date + "T08:00:00.000Z", published_at: s.date + "T08:00:00.000Z"
        });
        const sid = info.lastInsertRowid;
        for (const c of (s.comments || [])) {
          insComment.run(sid, c.name, c.text, c.likes || 0, c.loves || 0, c.cares || 0, now());
        }
      }
    });
    tx(seedStories);
    console.log(`[db] Seeded ${seedStories.length} starter stories.`);
  }
}
seed();

module.exports = { db, hashPassword, verifyPassword, now };
