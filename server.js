/* ============================================================
   Quietly Here — API + static server
   ============================================================ */
"use strict";
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const { db, verifyPassword, now } = require("./db.js");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

/* ---------- small helpers ---------- */
const clean = (s, max = 5000) => String(s == null ? "" : s).trim().slice(0, max);
const TOPICS = ["life", "people", "moments", "hope"];
const badRequest = (res, msg) => res.status(400).json({ error: msg || "Bad request" });

function storyToClient(row, { includePrivate = false } = {}) {
  const out = {
    id: row.id, topic: row.topic, lang: row.lang,
    title: row.title, titleSw: row.title_alt || row.title,
    pull: row.pull || "", excerpt: row.excerpt || "",
    body: (row.body || "").split("\n\n").filter(Boolean),
    author: row.author, tough: !!row.tough, helpline: !!row.helpline,
    mins: row.mins, reads: row.reads, status: row.status,
    date: (row.published_at || row.created_at || "").slice(0, 10),
    created_at: row.created_at
  };
  if (includePrivate) { out.contact = row.contact || ""; out.reject_note = row.reject_note || ""; }
  return out;
}

/* ============================================================
   PUBLIC API  (phone app — readers & writers)
   ============================================================ */

// list published stories (optional ?topic= & ?lang= & ?q= & ?sort=)
app.get("/api/stories", (req, res) => {
  const { topic, lang, q, sort } = req.query;
  let sql = "SELECT * FROM stories WHERE status='published'";
  const args = [];
  if (topic && TOPICS.includes(topic)) { sql += " AND topic=?"; args.push(topic); }
  if (lang === "en" || lang === "sw") { sql += " AND lang=?"; args.push(lang); }
  if (q) {
    sql += " AND (title LIKE ? OR title_alt LIKE ? OR excerpt LIKE ? OR body LIKE ? OR author LIKE ?)";
    const like = "%" + String(q).slice(0, 80) + "%";
    args.push(like, like, like, like, like);
  }
  if (sort === "read") sql += " ORDER BY reads DESC";
  else sql += " ORDER BY COALESCE(published_at, created_at) DESC";
  const rows = db.prepare(sql).all(...args);
  res.json(rows.map((r) => storyToClient(r)));
});

// single published story + its visible comments (also bumps read count)
app.get("/api/stories/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM stories WHERE id=? AND status='published'").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  db.prepare("UPDATE stories SET reads = reads + 1 WHERE id=?").run(row.id);
  row.reads += 1;
  const comments = db.prepare(
    "SELECT id,name,text,likes,loves,cares,created_at FROM comments WHERE story_id=? AND hidden=0 ORDER BY created_at ASC"
  ).all(row.id);
  res.json({ story: storyToClient(row), comments });
});

// submit a new story (goes to moderation queue)
app.post("/api/stories", (req, res) => {
  const b = req.body || {};
  const topic = TOPICS.includes(b.topic) ? b.topic : "life";
  const lang = b.lang === "sw" ? "sw" : "en";
  const title = clean(b.title, 160);
  const body = clean(b.body, 20000);
  const author = clean(b.pen || b.author, 60);
  const contact = clean(b.contact, 160);
  const excerpt = clean(b.excerpt, 200) || body.slice(0, 140);
  if (!title || !body || !author) return badRequest(res, "Title, story and pen name are required.");
  const mins = Math.max(1, Math.round(body.split(/\s+/).length / 200));
  const info = db.prepare(`
    INSERT INTO stories (topic,lang,title,pull,excerpt,body,author,contact,mins,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?, 'pending', ?)
  `).run(topic, lang, title, excerpt, excerpt, body, author, contact, mins, now());
  res.json({ ok: true, id: info.lastInsertRowid, status: "pending" });
});

// post a comment (blocked names/devices are silently rejected)
app.post("/api/stories/:id/comments", (req, res) => {
  const story = db.prepare("SELECT id FROM stories WHERE id=? AND status='published'").get(req.params.id);
  if (!story) return res.status(404).json({ error: "Not found" });
  const name = clean(req.body && req.body.name, 40) || "Guest";
  const text = clean(req.body && req.body.text, 1000);
  const deviceId = clean(req.body && req.body.deviceId, 80);
  if (!text) return badRequest(res, "Comment cannot be empty.");
  const blockedName = db.prepare("SELECT 1 FROM blocks WHERE kind='name' AND value=?").get(name.toLowerCase());
  const blockedDev = deviceId && db.prepare("SELECT 1 FROM blocks WHERE kind='device' AND value=?").get(deviceId);
  if (blockedName || blockedDev) return res.status(403).json({ error: "This account is blocked." });
  const info = db.prepare(
    "INSERT INTO comments (story_id,name,text,device_id,created_at) VALUES (?,?,?,?,?)"
  ).run(story.id, name, text, deviceId || null, now());
  const c = db.prepare("SELECT id,name,text,likes,loves,cares,created_at FROM comments WHERE id=?").get(info.lastInsertRowid);
  res.json({ ok: true, comment: c });
});

// react to a comment: type in {like,love,care}, dir in {up,down}
app.post("/api/comments/:id/react", (req, res) => {
  const type = ({ like: "likes", love: "loves", care: "cares" })[req.body && req.body.type];
  if (!type) return badRequest(res, "Bad reaction type.");
  const dir = (req.body && req.body.dir) === "down" ? -1 : 1;
  const c = db.prepare("SELECT * FROM comments WHERE id=? AND hidden=0").get(req.params.id);
  if (!c) return res.status(404).json({ error: "Not found" });
  const next = Math.max(0, c[type] + dir);
  db.prepare(`UPDATE comments SET ${type}=? WHERE id=?`).run(next, c.id);
  res.json({ ok: true, likes: type === "likes" ? next : c.likes, loves: type === "loves" ? next : c.loves, cares: type === "cares" ? next : c.cares });
});

// report a comment
app.post("/api/comments/:id/report", (req, res) => {
  const c = db.prepare("SELECT id FROM comments WHERE id=?").get(req.params.id);
  if (!c) return res.status(404).json({ error: "Not found" });
  const reason = clean(req.body && req.body.reason, 40) || "Other";
  db.prepare("INSERT INTO reports (comment_id,reason,status,created_at) VALUES (?,?, 'open', ?)").run(c.id, reason, now());
  res.json({ ok: true });
});

/* ============================================================
   ADMIN AUTH
   ============================================================ */
function newToken() { return crypto.randomBytes(24).toString("hex"); }
function requireAdmin(req, res, next) {
  const token = req.cookies && req.cookies.qh_admin;
  if (!token) return res.status(401).json({ error: "Not signed in" });
  const sess = db.prepare("SELECT * FROM sessions WHERE token=?").get(token);
  if (!sess) return res.status(401).json({ error: "Session expired" });
  req.adminId = sess.admin_id;
  next();
}

app.post("/api/admin/login", (req, res) => {
  const username = clean(req.body && req.body.username, 40);
  const password = String((req.body && req.body.password) || "");
  const admin = db.prepare("SELECT * FROM admins WHERE username=?").get(username);
  if (!admin || !verifyPassword(password, admin.pass_salt, admin.pass_hash)) {
    return res.status(401).json({ error: "Wrong username or password." });
  }
  const token = newToken();
  db.prepare("INSERT INTO sessions (token,admin_id,created_at) VALUES (?,?,?)").run(token, admin.id, now());
  res.cookie("qh_admin", token, { httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 3600 * 1000 });
  res.json({ ok: true, username: admin.username });
});

app.post("/api/admin/logout", (req, res) => {
  const token = req.cookies && req.cookies.qh_admin;
  if (token) db.prepare("DELETE FROM sessions WHERE token=?").run(token);
  res.clearCookie("qh_admin");
  res.json({ ok: true });
});

app.get("/api/admin/me", requireAdmin, (req, res) => {
  const a = db.prepare("SELECT username FROM admins WHERE id=?").get(req.adminId);
  res.json({ username: a ? a.username : null });
});

/* ============================================================
   ADMIN API  (moderation — PC panel)
   ============================================================ */

// dashboard stats
app.get("/api/admin/stats", requireAdmin, (req, res) => {
  const one = (sql) => db.prepare(sql).get().n;
  res.json({
    pending: one("SELECT COUNT(*) n FROM stories WHERE status='pending'"),
    published: one("SELECT COUNT(*) n FROM stories WHERE status='published'"),
    rejected: one("SELECT COUNT(*) n FROM stories WHERE status='rejected'"),
    openReports: one("SELECT COUNT(*) n FROM reports WHERE status='open'"),
    comments: one("SELECT COUNT(*) n FROM comments WHERE hidden=0"),
    blocks: one("SELECT COUNT(*) n FROM blocks"),
    totalReads: one("SELECT COALESCE(SUM(reads),0) n FROM stories WHERE status='published'")
  });
});

// list stories by status (?status=pending|published|rejected|all)
app.get("/api/admin/stories", requireAdmin, (req, res) => {
  const st = req.query.status;
  let rows;
  if (["pending", "published", "rejected"].includes(st))
    rows = db.prepare("SELECT * FROM stories WHERE status=? ORDER BY created_at DESC").all(st);
  else rows = db.prepare("SELECT * FROM stories ORDER BY created_at DESC").all();
  res.json(rows.map((r) => storyToClient(r, { includePrivate: true })));
});

// approve (optionally set tough / helpline / topic edits)
app.post("/api/admin/stories/:id/approve", requireAdmin, (req, res) => {
  const b = req.body || {};
  const tough = b.tough ? 1 : 0;
  const helpline = b.helpline ? 1 : 0;
  const info = db.prepare(
    "UPDATE stories SET status='published', tough=?, helpline=?, published_at=?, reject_note=NULL WHERE id=?"
  ).run(tough, helpline, now(), req.params.id);
  res.json({ ok: info.changes > 0 });
});

// reject with an optional note
app.post("/api/admin/stories/:id/reject", requireAdmin, (req, res) => {
  const note = clean(req.body && req.body.note, 500);
  const info = db.prepare("UPDATE stories SET status='rejected', reject_note=? WHERE id=?").run(note, req.params.id);
  res.json({ ok: info.changes > 0 });
});

// toggle tough label on an already-published story
app.post("/api/admin/stories/:id/tough", requireAdmin, (req, res) => {
  const tough = req.body && req.body.tough ? 1 : 0;
  const info = db.prepare("UPDATE stories SET tough=? WHERE id=?").run(tough, req.params.id);
  res.json({ ok: info.changes > 0, tough: !!tough });
});

// delete a story entirely
app.delete("/api/admin/stories/:id", requireAdmin, (req, res) => {
  const info = db.prepare("DELETE FROM stories WHERE id=?").run(req.params.id);
  res.json({ ok: info.changes > 0 });
});

// reports queue (open reports joined with their comment + story)
app.get("/api/admin/reports", requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT r.id report_id, r.reason, r.status, r.created_at,
           c.id comment_id, c.name, c.text, c.hidden, c.device_id,
           s.id story_id, s.title story_title
    FROM reports r
    JOIN comments c ON c.id = r.comment_id
    JOIN stories  s ON s.id = c.story_id
    WHERE r.status='open'
    ORDER BY r.created_at DESC
  `).all();
  res.json(rows);
});

// all comments (for a story) — moderation
app.get("/api/admin/comments", requireAdmin, (req, res) => {
  const sid = req.query.story_id;
  const rows = sid
    ? db.prepare("SELECT * FROM comments WHERE story_id=? ORDER BY created_at DESC").all(sid)
    : db.prepare("SELECT * FROM comments ORDER BY created_at DESC LIMIT 200").all();
  res.json(rows);
});

// hide / unhide a comment
app.post("/api/admin/comments/:id/hide", requireAdmin, (req, res) => {
  const hide = req.body && req.body.hidden ? 1 : 0;
  db.prepare("UPDATE comments SET hidden=? WHERE id=?").run(hide, req.params.id);
  res.json({ ok: true, hidden: !!hide });
});

// delete a comment
app.delete("/api/admin/comments/:id", requireAdmin, (req, res) => {
  const info = db.prepare("DELETE FROM comments WHERE id=?").run(req.params.id);
  res.json({ ok: info.changes > 0 });
});

// resolve a report
app.post("/api/admin/reports/:id/resolve", requireAdmin, (req, res) => {
  db.prepare("UPDATE reports SET status='resolved' WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// block a commenter by name and/or device
app.post("/api/admin/block", requireAdmin, (req, res) => {
  const b = req.body || {};
  const ins = db.prepare("INSERT OR IGNORE INTO blocks (kind,value,created_at) VALUES (?,?,?)");
  if (b.name) ins.run("name", clean(b.name, 40).toLowerCase(), now());
  if (b.device) ins.run("device", clean(b.device, 80), now());
  res.json({ ok: true });
});

app.get("/api/admin/blocks", requireAdmin, (req, res) => {
  res.json(db.prepare("SELECT * FROM blocks ORDER BY created_at DESC").all());
});

app.delete("/api/admin/blocks/:id", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM blocks WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

/* ============================================================
   STATIC FILES + ROUTES
   ============================================================ */
app.use(express.static(path.join(__dirname, "public")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] Quietly Here running on http://0.0.0.0:${PORT}`);
  console.log(`[server] Phone app: /   |   Admin panel: /admin`);
});
