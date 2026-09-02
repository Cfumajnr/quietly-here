/* ============================================================
   Quietly Here — API + static server
   ============================================================ */
"use strict";
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const { q, init, verifyPassword, now } = require("./db.js");
const rl = require("./ratelimit.js");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1); // Render sits behind a proxy; needed for real client IPs
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

/* ---------- rate-limit helpers ---------- */
const clientIp = (req) => (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "unknown";
const devId = (req) => String((req.body && req.body.deviceId) || req.headers["x-device-id"] || "").slice(0, 80);
// identity used for quotas: prefer device id, always also gate by IP
const who = (req) => devId(req) || clientIp(req);
const tooMany = (res, retryAfter, msg) => {
  if (retryAfter) res.set("Retry-After", String(retryAfter));
  return res.status(429).json({ error: msg || "Too many requests. Please slow down.", retryAfter });
};

/* Global API burst limiter: 120 requests / minute / IP (skips static + reads are cheap). */
app.use("/api", (req, res, next) => {
  const r = rl.windowLimit("burst:" + clientIp(req), 120, 60e3);
  if (!r.ok) return tooMany(res, r.retryAfter);
  next();
});

/* wrap async route handlers/middleware so errors return JSON instead of crashing */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => {
  console.error(e);
  if (!res.headersSent) res.status(500).json({ error: "Server error" });
});

/* ---------- helpers ---------- */
const clean = (s, max = 5000) => String(s == null ? "" : s).trim().slice(0, max);
const TOPICS = ["life", "people", "moments", "hope"];
const badRequest = (res, msg) => res.status(400).json({ error: msg || "Bad request" });

function storyToClient(row, { includePrivate = false } = {}) {
  const out = {
    id: Number(row.id), topic: row.topic, lang: row.lang,
    title: row.title, titleSw: row.title_alt || row.title,
    pull: row.pull || "", excerpt: row.excerpt || "",
    body: (row.body || "").split("\n\n").filter(Boolean),
    author: row.author, tough: !!row.tough, helpline: !!row.helpline,
    mins: Number(row.mins), reads: Number(row.reads), status: row.status,
    date: (row.published_at || row.created_at || "").slice(0, 10),
    created_at: row.created_at
  };
  if (includePrivate) { out.contact = row.contact || ""; out.reject_note = row.reject_note || ""; }
  return out;
}

/* ============================================================
   PUBLIC API
   ============================================================ */
app.get("/api/stories", wrap(async (req, res) => {
  const { topic, lang, q: query, sort } = req.query;
  let sql = "SELECT * FROM stories WHERE status='published'";
  const args = [];
  if (topic && TOPICS.includes(topic)) { sql += " AND topic=?"; args.push(topic); }
  if (lang === "en" || lang === "sw") { sql += " AND lang=?"; args.push(lang); }
  if (query) {
    sql += " AND (title LIKE ? OR title_alt LIKE ? OR excerpt LIKE ? OR body LIKE ? OR author LIKE ?)";
    const like = "%" + String(query).slice(0, 80) + "%";
    args.push(like, like, like, like, like);
  }
  sql += sort === "read" ? " ORDER BY reads DESC" : " ORDER BY COALESCE(published_at, created_at) DESC";
  const rows = await q.all(sql, args);
  res.json(rows.map((r) => storyToClient(r)));
}));

app.get("/api/stories/:id", wrap(async (req, res) => {
  const row = await q.get("SELECT * FROM stories WHERE id=? AND status='published'", [req.params.id]);
  if (!row) return res.status(404).json({ error: "Not found" });
  await q.run("UPDATE stories SET reads = reads + 1 WHERE id=?", [row.id]);
  row.reads = Number(row.reads) + 1;
  const comments = await q.all(
    "SELECT id,name,text,likes,loves,cares,created_at FROM comments WHERE story_id=? AND hidden=0 ORDER BY created_at ASC", [row.id]
  );
  // include this device's own reaction per comment, so the UI can highlight it
  const device = devId(req);
  let mineByComment = {};
  if (device && comments.length) {
    const ids = comments.map(c => Number(c.id));
    const placeholders = ids.map(() => "?").join(",");
    const mine = await q.all(
      `SELECT comment_id, type FROM reactions WHERE device_id=? AND comment_id IN (${placeholders})`,
      [device, ...ids]
    );
    for (const m of mine) mineByComment[Number(m.comment_id)] = m.type;
  }
  res.json({ story: storyToClient(row), comments: comments.map(c => ({
    ...c, id: Number(c.id), likes: Number(c.likes), loves: Number(c.loves), cares: Number(c.cares),
    mine: mineByComment[Number(c.id)] || null
  })) });
}));

app.post("/api/stories", wrap(async (req, res) => {
  const b = req.body || {};
  const topic = TOPICS.includes(b.topic) ? b.topic : "life";
  const lang = b.lang === "sw" ? "sw" : "en";
  const title = clean(b.title, 160);
  const body = clean(b.body, 20000);
  const author = clean(b.pen || b.author, 60);
  const contact = clean(b.contact, 160);
  const excerpt = clean(b.excerpt, 200) || body.slice(0, 140);
  if (!title || !body || !author) return badRequest(res, "Title, story and pen name are required.");

  const id = who(req), ip = clientIp(req);
  // min 60s between submissions
  const cd = rl.cooldown("sub:cd:" + id, 60e3);
  if (!cd.ok) return tooMany(res, cd.retryAfter, "Please wait a moment before submitting another story.");
  // max 5 submissions per rolling 24h — checked against the database (survives restarts)
  const dayAgo = new Date(Date.now() - 24 * 3600e3).toISOString();
  const cnt = Number((await q.get(
    "SELECT COUNT(*) n FROM stories WHERE created_at > ? AND (device_id = ? OR ip = ?)",
    [dayAgo, devId(req) || "\u0000", ip]
  )).n);
  if (cnt >= 5) return tooMany(res, 3600, "Daily submission limit reached (5 per day). Please try again tomorrow.");

  const mins = Math.max(1, Math.round(body.split(/\s+/).length / 200));
  const info = await q.run(
    `INSERT INTO stories (topic,lang,title,pull,excerpt,body,author,contact,mins,status,created_at,device_id,ip)
     VALUES (?,?,?,?,?,?,?,?,?, 'pending', ?,?,?)`,
    [topic, lang, title, excerpt, excerpt, body, author, contact, mins, now(), devId(req) || null, ip]
  );
  res.json({ ok: true, id: info.lastInsertRowid, status: "pending" });
}));

app.post("/api/stories/:id/comments", wrap(async (req, res) => {
  const story = await q.get("SELECT id FROM stories WHERE id=? AND status='published'", [req.params.id]);
  if (!story) return res.status(404).json({ error: "Not found" });
  const name = clean(req.body && req.body.name, 40) || "Guest";
  const text = clean(req.body && req.body.text, 1000);
  const deviceId = clean(req.body && req.body.deviceId, 80);
  if (!text) return badRequest(res, "Comment cannot be empty.");
  const blockedName = await q.get("SELECT 1 FROM blocks WHERE kind='name' AND value=?", [name.toLowerCase()]);
  const blockedDev = deviceId ? await q.get("SELECT 1 FROM blocks WHERE kind='device' AND value=?", [deviceId]) : null;
  if (blockedName || blockedDev) return res.status(403).json({ error: "This account is blocked." });

  const id = who(req), ip = clientIp(req);
  // min 10s between comments
  const cd = rl.cooldown("com:cd:" + id, 10e3);
  if (!cd.ok) return tooMany(res, cd.retryAfter, "You're commenting too fast. Please wait a few seconds.");
  // max 20 comments per rolling hour (DB-backed)
  const hourAgo = new Date(Date.now() - 3600e3).toISOString();
  const cnt = Number((await q.get(
    "SELECT COUNT(*) n FROM comments WHERE created_at > ? AND (device_id = ? OR ip = ?)",
    [hourAgo, deviceId || "\u0000", ip]
  )).n);
  if (cnt >= 20) return tooMany(res, 1800, "Hourly comment limit reached (20 per hour). Please try again later.");

  const info = await q.run("INSERT INTO comments (story_id,name,text,device_id,ip,created_at) VALUES (?,?,?,?,?,?)",
    [story.id, name, text, deviceId || null, ip, now()]);
  const c = await q.get("SELECT id,name,text,likes,loves,cares,created_at FROM comments WHERE id=?", [info.lastInsertRowid]);
  res.json({ ok: true, comment: { ...c, id: Number(c.id), likes: Number(c.likes), loves: Number(c.loves), cares: Number(c.cares) } });
}));

/* One reaction per device per comment, enforced server-side via the reactions table.
   Body: { type:'like'|'love'|'care', deviceId }. Re-sending the same type removes it
   (toggle off); sending a different type switches it. Counts are derived, not trusted. */
const REACT_COL = { like: "likes", love: "loves", care: "cares" };
app.post("/api/comments/:id/react", wrap(async (req, res) => {
  const type = req.body && req.body.type;
  if (!REACT_COL[type]) return badRequest(res, "Bad reaction type.");
  const device = devId(req);
  if (!device) return badRequest(res, "Missing device id.");

  const c = await q.get("SELECT id FROM comments WHERE id=? AND hidden=0", [req.params.id]);
  if (!c) return res.status(404).json({ error: "Not found" });

  // light burst guard on reactions (per device+comment): blocks machine-gun clicks
  // but comfortably allows a human toggling/switching their choice
  const cd = rl.cooldown("react:cd:" + device + ":" + req.params.id, 300);
  if (!cd.ok) return tooMany(res, cd.retryAfter);

  const existing = await q.get("SELECT type FROM reactions WHERE comment_id=? AND device_id=?", [c.id, device]);
  let mine = null;
  if (!existing) {
    await q.run("INSERT INTO reactions (comment_id,device_id,type,created_at) VALUES (?,?,?,?)", [c.id, device, type, now()]);
    mine = type;
  } else if (existing.type === type) {
    await q.run("DELETE FROM reactions WHERE comment_id=? AND device_id=?", [c.id, device]); // toggle off
    mine = null;
  } else {
    await q.run("UPDATE reactions SET type=?, created_at=? WHERE comment_id=? AND device_id=?", [type, now(), c.id, device]); // switch
    mine = type;
  }

  // recompute authoritative counts from the reactions table, and cache onto the comment row
  const counts = { likes: 0, loves: 0, cares: 0 };
  for (const r of await q.all("SELECT type, COUNT(*) n FROM reactions WHERE comment_id=? GROUP BY type", [c.id])) {
    if (REACT_COL[r.type]) counts[REACT_COL[r.type]] = Number(r.n);
  }
  await q.run("UPDATE comments SET likes=?, loves=?, cares=? WHERE id=?", [counts.likes, counts.loves, counts.cares, c.id]);
  res.json({ ok: true, ...counts, mine });
}));

app.post("/api/comments/:id/report", wrap(async (req, res) => {
  const c = await q.get("SELECT id FROM comments WHERE id=?", [req.params.id]);
  if (!c) return res.status(404).json({ error: "Not found" });
  const reason = clean(req.body && req.body.reason, 40) || "Other";
  const device = devId(req), ip = clientIp(req);

  // one report per comment per device (prevents report-spam / brigading)
  if (device) {
    const dup = await q.get("SELECT 1 FROM reports WHERE comment_id=? AND device_id=?", [c.id, device]);
    if (dup) return res.status(409).json({ error: "You've already reported this comment. The moderator will review it." });
  }
  // max 20 reports per rolling 24h per device/ip
  const dayAgo = new Date(Date.now() - 24 * 3600e3).toISOString();
  const cnt = Number((await q.get(
    "SELECT COUNT(*) n FROM reports WHERE created_at > ? AND (device_id = ? OR ip = ?)",
    [dayAgo, device || "\u0000", ip]
  )).n);
  if (cnt >= 20) return tooMany(res, 3600, "Daily report limit reached. Please try again later.");

  await q.run("INSERT INTO reports (comment_id,reason,status,device_id,ip,created_at) VALUES (?,?, 'open', ?,?,?)",
    [c.id, reason, device || null, ip, now()]);
  res.json({ ok: true });
}));

/* ============================================================
   ADMIN AUTH
   ============================================================ */
function newToken() { return crypto.randomBytes(24).toString("hex"); }
const requireAdmin = wrap(async (req, res, next) => {
  const token = req.cookies && req.cookies.qh_admin;
  if (!token) return res.status(401).json({ error: "Not signed in" });
  const sess = await q.get("SELECT * FROM sessions WHERE token=?", [token]);
  if (!sess) return res.status(401).json({ error: "Session expired" });
  req.adminId = Number(sess.admin_id);
  next();
});

app.post("/api/admin/login", wrap(async (req, res) => {
  const ip = clientIp(req);
  // lock after 10 failed attempts within 15 minutes
  if (rl.isLocked("login:" + ip, 10, 15 * 60e3)) {
    return tooMany(res, 900, "Too many failed sign-in attempts. Please wait 15 minutes.");
  }
  const username = clean(req.body && req.body.username, 40);
  const password = String((req.body && req.body.password) || "");
  const admin = await q.get("SELECT * FROM admins WHERE username=?", [username]);
  if (!admin || !verifyPassword(password, admin.pass_salt, admin.pass_hash)) {
    rl.recordFail("login:" + ip, 10, 15 * 60e3);
    return res.status(401).json({ error: "Wrong username or password." });
  }
  rl.clearFails("login:" + ip);
  const token = newToken();
  await q.run("INSERT INTO sessions (token,admin_id,created_at) VALUES (?,?,?)", [token, admin.id, now()]);
  res.cookie("qh_admin", token, { httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 3600 * 1000 });
  res.json({ ok: true, username: admin.username });
}));

app.post("/api/admin/logout", wrap(async (req, res) => {
  const token = req.cookies && req.cookies.qh_admin;
  if (token) await q.run("DELETE FROM sessions WHERE token=?", [token]);
  res.clearCookie("qh_admin");
  res.json({ ok: true });
}));

app.get("/api/admin/me", requireAdmin, wrap(async (req, res) => {
  const a = await q.get("SELECT username FROM admins WHERE id=?", [req.adminId]);
  res.json({ username: a ? a.username : null });
}));

/* ============================================================
   ADMIN API
   ============================================================ */
app.get("/api/admin/stats", requireAdmin, wrap(async (req, res) => {
  const one = async (sql) => Number((await q.get(sql)).n);
  res.json({
    pending: await one("SELECT COUNT(*) n FROM stories WHERE status='pending'"),
    published: await one("SELECT COUNT(*) n FROM stories WHERE status='published'"),
    rejected: await one("SELECT COUNT(*) n FROM stories WHERE status='rejected'"),
    openReports: await one("SELECT COUNT(*) n FROM reports WHERE status='open'"),
    comments: await one("SELECT COUNT(*) n FROM comments WHERE hidden=0"),
    blocks: await one("SELECT COUNT(*) n FROM blocks"),
    totalReads: await one("SELECT COALESCE(SUM(reads),0) n FROM stories WHERE status='published'")
  });
}));

app.get("/api/admin/stories", requireAdmin, wrap(async (req, res) => {
  const st = req.query.status;
  const rows = ["pending", "published", "rejected"].includes(st)
    ? await q.all("SELECT * FROM stories WHERE status=? ORDER BY created_at DESC", [st])
    : await q.all("SELECT * FROM stories ORDER BY created_at DESC");
  res.json(rows.map((r) => storyToClient(r, { includePrivate: true })));
}));

app.post("/api/admin/stories/:id/approve", requireAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const info = await q.run(
    "UPDATE stories SET status='published', tough=?, helpline=?, published_at=?, reject_note=NULL WHERE id=?",
    [b.tough ? 1 : 0, b.helpline ? 1 : 0, now(), req.params.id]
  );
  res.json({ ok: info.changes > 0 });
}));

app.post("/api/admin/stories/:id/reject", requireAdmin, wrap(async (req, res) => {
  const note = clean(req.body && req.body.note, 500);
  const info = await q.run("UPDATE stories SET status='rejected', reject_note=? WHERE id=?", [note, req.params.id]);
  res.json({ ok: info.changes > 0 });
}));

app.post("/api/admin/stories/:id/tough", requireAdmin, wrap(async (req, res) => {
  const tough = req.body && req.body.tough ? 1 : 0;
  const info = await q.run("UPDATE stories SET tough=? WHERE id=?", [tough, req.params.id]);
  res.json({ ok: info.changes > 0, tough: !!tough });
}));

app.delete("/api/admin/stories/:id", requireAdmin, wrap(async (req, res) => {
  const cids = (await q.all("SELECT id FROM comments WHERE story_id=?", [req.params.id])).map(r => Number(r.id));
  for (const cid of cids) {
    await q.run("DELETE FROM reactions WHERE comment_id=?", [cid]);
    await q.run("DELETE FROM reports WHERE comment_id=?", [cid]);
  }
  await q.run("DELETE FROM comments WHERE story_id=?", [req.params.id]);
  const info = await q.run("DELETE FROM stories WHERE id=?", [req.params.id]);
  res.json({ ok: info.changes > 0 });
}));

app.get("/api/admin/reports", requireAdmin, wrap(async (req, res) => {
  const rows = await q.all(`
    SELECT r.id report_id, r.reason, r.status, r.created_at,
           c.id comment_id, c.name, c.text, c.hidden, c.device_id,
           s.id story_id, s.title story_title
    FROM reports r JOIN comments c ON c.id = r.comment_id JOIN stories s ON s.id = c.story_id
    WHERE r.status='open' ORDER BY r.created_at DESC`);
  res.json(rows);
}));

app.get("/api/admin/comments", requireAdmin, wrap(async (req, res) => {
  const sid = req.query.story_id;
  const rows = sid
    ? await q.all("SELECT * FROM comments WHERE story_id=? ORDER BY created_at DESC", [sid])
    : await q.all("SELECT * FROM comments ORDER BY created_at DESC LIMIT 200");
  res.json(rows);
}));

app.post("/api/admin/comments/:id/hide", requireAdmin, wrap(async (req, res) => {
  const hide = req.body && req.body.hidden ? 1 : 0;
  await q.run("UPDATE comments SET hidden=? WHERE id=?", [hide, req.params.id]);
  res.json({ ok: true, hidden: !!hide });
}));

app.delete("/api/admin/comments/:id", requireAdmin, wrap(async (req, res) => {
  await q.run("DELETE FROM reactions WHERE comment_id=?", [req.params.id]);
  await q.run("DELETE FROM reports WHERE comment_id=?", [req.params.id]);
  const info = await q.run("DELETE FROM comments WHERE id=?", [req.params.id]);
  res.json({ ok: info.changes > 0 });
}));

app.post("/api/admin/reports/:id/resolve", requireAdmin, wrap(async (req, res) => {
  await q.run("UPDATE reports SET status='resolved' WHERE id=?", [req.params.id]);
  res.json({ ok: true });
}));

app.post("/api/admin/block", requireAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  if (b.name) await q.run("INSERT OR IGNORE INTO blocks (kind,value,created_at) VALUES (?,?,?)", ["name", clean(b.name, 40).toLowerCase(), now()]);
  if (b.device) await q.run("INSERT OR IGNORE INTO blocks (kind,value,created_at) VALUES (?,?,?)", ["device", clean(b.device, 80), now()]);
  res.json({ ok: true });
}));

app.get("/api/admin/blocks", requireAdmin, wrap(async (req, res) => {
  res.json(await q.all("SELECT * FROM blocks ORDER BY created_at DESC"));
}));

app.delete("/api/admin/blocks/:id", requireAdmin, wrap(async (req, res) => {
  await q.run("DELETE FROM blocks WHERE id=?", [req.params.id]);
  res.json({ ok: true });
}));

/* ============================================================
   STATIC + ROUTES
   ============================================================ */
app.use(express.static(path.join(__dirname, "public")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

init().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[server] Quietly Here running on http://0.0.0.0:${PORT}`);
    console.log(`[server] Phone app: /   |   Admin panel: /admin`);
  });
}).catch((e) => { console.error("[server] Failed to init database:", e); process.exit(1); });
