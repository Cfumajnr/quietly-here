/* ============================================================
   Quietly Here — API + static server
   ============================================================ */
"use strict";
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const { q, init, verifyPassword, hashPassword, now } = require("./db.js");
const rl = require("./ratelimit.js");
const { sendConfirmation, sendPasswordReset, sendAdminReply } = require("./email.js");

const APP_URL = process.env.APP_URL || ""; // e.g. https://quietly-here.onrender.com (for confirm links)
const baseUrl = (req) => APP_URL || ((req.headers["x-forwarded-proto"] || "https") + "://" + req.headers.host);

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1); // Render sits behind a proxy; needed for real client IPs

/* Canonical domain redirect: send visitors on the old onrender.com host (or any
   other host) to the real custom domain. Configured via CANONICAL_HOST so it's
   inert locally. 301 keeps SEO/bookmarks pointing at the right place. */
const CANONICAL_HOST = process.env.CANONICAL_HOST || ""; // e.g. quietly-here.quiettruths.co.ke
app.use((req, res, next) => {
  if (CANONICAL_HOST && req.headers.host && req.headers.host !== CANONICAL_HOST) {
    return res.redirect(301, "https://" + CANONICAL_HOST + req.originalUrl);
  }
  next();
});

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
const wordCount = (s) => (String(s || "").trim().match(/\S+/g) || []).length;
// keep these in sync with LIMITS in public/app.js
const LIMITS = { comment: { min: 2, max: 300 }, story: { min: 50, max: 2000 } };

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

app.post("/api/stories", requireUser, wrap(async (req, res) => {
  const b = req.body || {};
  const topic = TOPICS.includes(b.topic) ? b.topic : "life";
  const lang = b.lang === "sw" ? "sw" : "en";
  const title = clean(b.title, 160);
  const body = clean(b.body, 20000);
  const author = clean(b.pen || b.author, 60);
  const contact = clean(b.contact, 160);
  const excerpt = clean(b.excerpt, 200) || body.slice(0, 140);
  if (!title || !body || !author) return badRequest(res, "Title, story and pen name are required.");
  const bwc = wordCount(body);
  if (bwc < LIMITS.story.min) return badRequest(res, `A story needs at least ${LIMITS.story.min} words.`);
  if (bwc > LIMITS.story.max) return badRequest(res, `Stories are limited to ${LIMITS.story.max} words.`);

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
    `INSERT INTO stories (topic,lang,title,pull,excerpt,body,author,contact,mins,status,created_at,device_id,ip,user_id)
     VALUES (?,?,?,?,?,?,?,?,?, 'pending', ?,?,?,?)`,
    [topic, lang, title, excerpt, excerpt, body, author, contact || req.user.email, mins, now(), devId(req) || null, ip, req.user.id]
  );
  res.json({ ok: true, id: info.lastInsertRowid, status: "pending" });
}));

app.post("/api/stories/:id/comments", wrap(async (req, res) => {
  const story = await q.get("SELECT id FROM stories WHERE id=? AND status='published'", [req.params.id]);
  if (!story) return res.status(404).json({ error: "Not found" });
  const name = clean(req.body && req.body.name, 40) || "Guest";
  const text = clean(req.body && req.body.text, 2400);
  const deviceId = clean(req.body && req.body.deviceId, 80);
  if (!text) return badRequest(res, "Comment cannot be empty.");
  const twc = wordCount(text);
  if (twc < LIMITS.comment.min) return badRequest(res, `Please write at least ${LIMITS.comment.min} words.`);
  if (twc > LIMITS.comment.max) return badRequest(res, `Comments are limited to ${LIMITS.comment.max} words.`);
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

  const commenter = await currentUser(req); // null for guests
  const info = await q.run("INSERT INTO comments (story_id,name,text,device_id,ip,created_at,user_id) VALUES (?,?,?,?,?,?,?)",
    [story.id, name, text, deviceId || null, ip, now(), commenter ? commenter.id : null]);
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

app.post("/api/comments/:id/report", requireUser, wrap(async (req, res) => {
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

  await q.run("INSERT INTO reports (comment_id,reason,status,device_id,ip,created_at,user_id) VALUES (?,?, 'open', ?,?,?,?)",
    [c.id, reason, device || null, ip, now(), req.user.id]);
  res.json({ ok: true });
}));

/* ============================================================
   USER ACCOUNTS
   ============================================================ */
function newToken() { return crypto.randomBytes(24).toString("hex"); }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* Load the signed-in user (or null) from the qh_user cookie. */
async function currentUser(req) {
  const token = req.cookies && req.cookies.qh_user;
  if (!token) return null;
  const sess = await q.get("SELECT * FROM user_sessions WHERE token=?", [token]);
  if (!sess) return null;
  const u = await q.get("SELECT id,email,name,confirmed FROM users WHERE id=?", [sess.user_id]);
  return u || null;
}
function userToClient(u) { return u ? { id: Number(u.id), email: u.email, name: u.name, confirmed: !!u.confirmed } : null; }

/* Middleware: require a signed-in AND confirmed account.
   Declared as a hoisted function so routes registered earlier in the file
   (e.g. POST /api/stories) can reference it at load time. */
function requireUser(req, res, next) {
  return wrap(async (rq, rs, nx) => {
    const u = await currentUser(rq);
    if (!u) return rs.status(401).json({ error: "Please sign in to continue.", needAuth: true });
    if (!u.confirmed) return rs.status(403).json({ error: "Please confirm your email first. Check your inbox for the link.", needConfirm: true });
    rq.user = u;
    nx();
  })(req, res, next);
}

app.post("/api/auth/signup", wrap(async (req, res) => {
  const ip = clientIp(req);
  if (rl.isLocked("signup:" + ip, 8, 60 * 60e3)) return tooMany(res, 3600, "Too many sign-up attempts. Please try again later.");
  const email = clean(req.body && req.body.email, 160).toLowerCase();
  const name = clean(req.body && req.body.name, 60);
  const password = String((req.body && req.body.password) || "");
  if (!EMAIL_RE.test(email)) return badRequest(res, "Please enter a valid email address.");
  if (!name) return badRequest(res, "Please enter a display name.");
  if (password.length < 6) return badRequest(res, "Password must be at least 6 characters.");
  rl.recordFail("signup:" + ip, 8, 60 * 60e3);

  const existing = await q.get("SELECT id,confirmed FROM users WHERE email=?", [email]);
  if (existing) {
    // don't reveal whether an account exists — behave the same either way
    return res.json({ ok: true, pending: true, message: "If that email is new, we've sent a confirmation link. Please check your inbox." });
  }
  if (!(req.body && req.body.agreedTerms)) return badRequest(res, "Please agree to the Terms & Privacy to create an account.");
  const { hash, salt } = hashPassword(password);
  const token = newToken();
  await q.run(
    "INSERT INTO users (email,name,pass_hash,pass_salt,confirmed,confirm_token,confirm_sent_at,created_at,agreed_terms_at) VALUES (?,?,?,?,0,?,?,?,?)",
    [email, name, hash, salt, token, now(), now(), now()]
  );
  const link = baseUrl(req) + "/api/auth/confirm?token=" + token;
  await sendConfirmation({ to: email, name, link });
  res.json({ ok: true, pending: true, message: "Almost there! Check your inbox for a confirmation link." });
}));

app.get("/api/auth/confirm", wrap(async (req, res) => {
  const token = String(req.query.token || "");
  const page = (title, msg, ok) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title}</title><body style="font-family:Segoe UI,Roboto,Arial,sans-serif;background:#F6F1E7;color:#24312B;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px">
    <div style="max-width:400px;text-align:center;background:#FFFDF8;border:1px solid #E5DCC9;border-radius:18px;padding:34px 26px;box-shadow:0 10px 30px rgba(30,40,33,.08)">
    <div style="font-size:40px">${ok ? "✅" : "⚠️"}</div><h1 style="font-family:Georgia,serif;font-size:22px;margin:10px 0">${title}</h1>
    <p style="color:#4C5A53;line-height:1.6;font-size:15px">${msg}</p>
    <a href="/" style="display:inline-block;margin-top:16px;background:#155E5A;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:10px">Open Quietly Here</a></div></body>`;
  if (!token) return res.status(400).send(page("Invalid link", "This confirmation link is missing its code.", false));
  const u = await q.get("SELECT id,confirmed FROM users WHERE confirm_token=?", [token]);
  if (!u) return res.status(400).send(page("Link expired", "This link is invalid or has already been used. Try signing in — if it doesn't work, sign up again.", false));
  if (!u.confirmed) await q.run("UPDATE users SET confirmed=1, confirm_token=NULL WHERE id=?", [u.id]);
  // sign them in immediately
  const stoken = newToken();
  await q.run("INSERT INTO user_sessions (token,user_id,created_at) VALUES (?,?,?)", [stoken, u.id, now()]);
  res.cookie("qh_user", stoken, { httpOnly: true, sameSite: "lax", maxAge: 60 * 24 * 3600 * 1000 });
  res.send(page("Email confirmed!", "Your account is ready. Welcome to Quietly Here — you're now signed in.", true));
}));

app.post("/api/auth/resend", wrap(async (req, res) => {
  const email = clean(req.body && req.body.email, 160).toLowerCase();
  const u = await q.get("SELECT * FROM users WHERE email=?", [email]);
  if (u && !u.confirmed) {
    const cd = rl.cooldown("resend:" + email, 60e3);
    if (!cd.ok) return tooMany(res, cd.retryAfter, "Please wait a minute before requesting another email.");
    let token = u.confirm_token;
    if (!token) { token = newToken(); await q.run("UPDATE users SET confirm_token=? WHERE id=?", [token, u.id]); }
    await q.run("UPDATE users SET confirm_sent_at=? WHERE id=?", [now(), u.id]);
    await sendConfirmation({ to: email, name: u.name, link: baseUrl(req) + "/api/auth/confirm?token=" + token });
  }
  res.json({ ok: true, message: "If that account needs confirming, we've sent a fresh link." });
}));

/* ---- Forgot password: request a reset link ---- */
app.post("/api/auth/forgot", wrap(async (req, res) => {
  const ip = clientIp(req);
  if (rl.isLocked("forgot:" + ip, 8, 60 * 60e3)) return tooMany(res, 3600, "Too many reset requests. Please try again later.");
  rl.recordFail("forgot:" + ip, 8, 60 * 60e3);
  const email = clean(req.body && req.body.email, 160).toLowerCase();
  // Always respond the same way so we never reveal whether an account exists.
  const generic = { ok: true, message: "If that email has an account, we've sent a reset link. Please check your inbox." };
  if (!EMAIL_RE.test(email)) return res.json(generic);
  const u = await q.get("SELECT * FROM users WHERE email=?", [email]);
  if (u) {
    const cd = rl.cooldown("forgot:" + email, 60e3);
    if (cd.ok) {
      const token = newToken();
      await q.run("UPDATE users SET reset_token=?, reset_sent_at=? WHERE id=?", [token, now(), u.id]);
      const link = baseUrl(req) + "/reset?token=" + token;
      await sendPasswordReset({ to: email, name: u.name, link });
    }
  }
  res.json(generic);
}));

/* ---- Reset page: GET renders a small form that posts the new password ---- */
app.get("/reset", wrap(async (req, res) => {
  const token = String(req.query.token || "");
  const shell = (inner) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Reset password · Quietly Here</title><body style="font-family:Segoe UI,Roboto,Arial,sans-serif;background:#F6F1E7;color:#24312B;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px">
    <div style="max-width:400px;width:100%;background:#FFFDF8;border:1px solid #E5DCC9;border-radius:18px;padding:30px 26px;box-shadow:0 10px 30px rgba(30,40,33,.08)">${inner}</div></body>`;
  const valid = token && await q.get("SELECT id, reset_sent_at FROM users WHERE reset_token=?", [token]);
  const fresh = valid && valid.reset_sent_at && (Date.now() - new Date(valid.reset_sent_at).getTime() < 3600e3);
  if (!fresh) {
    return res.status(400).send(shell(`<div style="text-align:center"><div style="font-size:40px">⚠️</div>
      <h1 style="font-family:Georgia,serif;font-size:22px;margin:10px 0">Link expired</h1>
      <p style="color:#4C5A53;line-height:1.6;font-size:15px">This reset link is invalid or has expired. Please request a new one from the app.</p>
      <a href="/" style="display:inline-block;margin-top:16px;background:#155E5A;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:10px">Open Quietly Here</a></div>`));
  }
  res.send(shell(`
    <div style="text-align:center;margin-bottom:14px"><div style="font-size:30px">🔑</div>
      <h1 style="font-family:Georgia,serif;font-size:22px;margin:8px 0 2px">Choose a new password</h1>
      <p style="color:#7C877F;font-size:13px;margin:0">At least 6 characters.</p></div>
    <form id="f" onsubmit="return false" style="display:flex;flex-direction:column;gap:12px">
      <input id="p1" type="password" placeholder="New password" autocomplete="new-password" style="padding:13px;border:1.5px solid #E5DCC9;border-radius:10px;font-size:15px">
      <input id="p2" type="password" placeholder="Confirm new password" autocomplete="new-password" style="padding:13px;border:1.5px solid #E5DCC9;border-radius:10px;font-size:15px">
      <div id="msg" style="font-size:13px;color:#c0392b;min-height:16px"></div>
      <button id="go" style="background:#155E5A;color:#fff;border:none;font-weight:700;font-size:15px;padding:13px;border-radius:10px;cursor:pointer">Set new password</button>
    </form>
    <script>
      var t=${JSON.stringify(token)};
      document.getElementById("go").onclick=async function(){
        var p1=document.getElementById("p1").value, p2=document.getElementById("p2").value, m=document.getElementById("msg");
        m.style.color="#c0392b";
        if(p1.length<6){m.textContent="Password must be at least 6 characters.";return;}
        if(p1!==p2){m.textContent="Passwords don't match.";return;}
        m.textContent="";
        try{
          var r=await fetch("/api/auth/reset",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:t,password:p1})});
          var j=await r.json();
          if(!r.ok){m.textContent=j.error||"Something went wrong.";return;}
          document.getElementById("f").innerHTML='<div style="text-align:center"><div style="font-size:40px">✅</div><h1 style="font-family:Georgia,serif;font-size:20px;margin:10px 0">Password updated</h1><p style="color:#4C5A53;line-height:1.6;font-size:15px">You can now sign in with your new password.</p><a href="/" style="display:inline-block;margin-top:8px;background:#155E5A;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:10px">Open Quietly Here</a></div>';
        }catch(e){m.textContent="Network error. Please try again.";}
      };
    </script>`));
}));

/* ---- Reset: consume the token and set the new password ---- */
app.post("/api/auth/reset", wrap(async (req, res) => {
  const token = String((req.body && req.body.token) || "");
  const password = String((req.body && req.body.password) || "");
  if (password.length < 6) return badRequest(res, "Password must be at least 6 characters.");
  const u = token && await q.get("SELECT id, reset_sent_at FROM users WHERE reset_token=?", [token]);
  const fresh = u && u.reset_sent_at && (Date.now() - new Date(u.reset_sent_at).getTime() < 3600e3);
  if (!fresh) return badRequest(res, "This reset link is invalid or has expired. Please request a new one.");
  const { hash, salt } = hashPassword(password);
  // set new password, clear the reset token, confirm the account (they proved email ownership),
  // and log out all existing sessions for safety
  await q.run("UPDATE users SET pass_hash=?, pass_salt=?, reset_token=NULL, reset_sent_at=NULL, confirmed=1 WHERE id=?", [hash, salt, u.id]);
  await q.run("DELETE FROM user_sessions WHERE user_id=?", [u.id]);
  res.json({ ok: true });
}));

app.post("/api/auth/login", wrap(async (req, res) => {
  const ip = clientIp(req);
  if (rl.isLocked("ulogin:" + ip, 10, 15 * 60e3)) return tooMany(res, 900, "Too many failed sign-in attempts. Please wait 15 minutes.");
  const email = clean(req.body && req.body.email, 160).toLowerCase();
  const password = String((req.body && req.body.password) || "");
  const u = await q.get("SELECT * FROM users WHERE email=?", [email]);
  if (!u || !verifyPassword(password, u.pass_salt, u.pass_hash)) {
    rl.recordFail("ulogin:" + ip, 10, 15 * 60e3);
    return res.status(401).json({ error: "Wrong email or password." });
  }
  rl.clearFails("ulogin:" + ip);
  if (!u.confirmed) return res.status(403).json({ error: "Please confirm your email first — check your inbox.", needConfirm: true, email });
  const token = newToken();
  await q.run("INSERT INTO user_sessions (token,user_id,created_at) VALUES (?,?,?)", [token, u.id, now()]);
  res.cookie("qh_user", token, { httpOnly: true, sameSite: "lax", maxAge: 60 * 24 * 3600 * 1000 });
  res.json({ ok: true, user: userToClient(u) });
}));

app.post("/api/auth/logout", wrap(async (req, res) => {
  const token = req.cookies && req.cookies.qh_user;
  if (token) await q.run("DELETE FROM user_sessions WHERE token=?", [token]);
  res.clearCookie("qh_user");
  res.json({ ok: true });
}));

app.get("/api/auth/me", wrap(async (req, res) => {
  res.json({ user: userToClient(await currentUser(req)) });
}));

/* ============================================================
   ADMIN AUTH
   ============================================================ */
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
    users: await one("SELECT COUNT(*) n FROM users WHERE confirmed=1"),
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

app.get("/api/admin/users", requireAdmin, wrap(async (req, res) => {
  const rows = await q.all(
    `SELECT u.id, u.name, u.email, u.confirmed, u.created_at,
            (SELECT COUNT(*) FROM stories s WHERE s.user_id = u.id) AS stories,
            (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id) AS comments
     FROM users u ORDER BY u.created_at DESC`);
  res.json(rows.map(r => ({
    id: Number(r.id), name: r.name, email: r.email, confirmed: !!r.confirmed,
    created_at: r.created_at, stories: Number(r.stories || 0), comments: Number(r.comments || 0)
  })));
}));

/* Admin sends a personal reply to a member via Resend (no need to open Resend). */
app.post("/api/admin/users/:id/email", requireAdmin, wrap(async (req, res) => {
  const u = await q.get("SELECT id,email,name FROM users WHERE id=?", [req.params.id]);
  if (!u) return res.status(404).json({ error: "Member not found." });
  const subject = clean(req.body && req.body.subject, 160);
  const message = clean(req.body && req.body.message, 5000);
  if (!message) return badRequest(res, "Please write a message.");
  const r = await sendAdminReply({ to: u.email, name: u.name, subject, message });
  if (!r.ok) return res.status(502).json({ error: "Couldn't send the email: " + (r.error || "unknown error") });
  res.json({ ok: true, dev: !!r.dev });
}));

/* Admin composes and publishes a story directly (goes live immediately). */
app.post("/api/admin/stories", requireAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const topic = TOPICS.includes(b.topic) ? b.topic : "life";
  const lang = b.lang === "sw" ? "sw" : "en";
  const title = clean(b.title, 160);
  const body = clean(b.body, 20000);
  const author = clean(b.author || b.pen, 60);
  const pull = clean(b.pull, 200);
  const excerpt = clean(b.excerpt, 200) || body.slice(0, 140);
  if (!title || !body || !author) return badRequest(res, "Title, story and author are required.");
  const mins = Math.max(1, Math.round(body.split(/\s+/).length / 200));
  const info = await q.run(
    `INSERT INTO stories (topic,lang,title,pull,excerpt,body,author,tough,helpline,mins,status,created_at,published_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'published', ?, ?)`,
    [topic, lang, title, pull || excerpt, excerpt, body, author, b.tough ? 1 : 0, b.helpline ? 1 : 0, mins, now(), now()]
  );
  res.json({ ok: true, id: info.lastInsertRowid, status: "published" });
}));

app.get("/api/admin/reports", requireAdmin, wrap(async (req, res) => {
  const rows = await q.all(`
    SELECT r.id report_id, r.reason, r.status, r.created_at,
           c.id comment_id, c.name, c.text, c.hidden, c.device_id,
           cu.email comment_account_email, cu.name comment_account_name,
           ru.email reporter_email, ru.name reporter_name,
           s.id story_id, s.title story_title
    FROM reports r JOIN comments c ON c.id = r.comment_id JOIN stories s ON s.id = c.story_id
    LEFT JOIN users cu ON cu.id = c.user_id
    LEFT JOIN users ru ON ru.id = r.user_id
    WHERE r.status='open' ORDER BY r.created_at DESC`);
  res.json(rows);
}));

app.get("/api/admin/comments", requireAdmin, wrap(async (req, res) => {
  const sid = req.query.story_id;
  const sql = `SELECT c.*, u.email AS account_email, u.name AS account_name, u.confirmed AS account_confirmed
               FROM comments c LEFT JOIN users u ON u.id = c.user_id`;
  const rows = sid
    ? await q.all(sql + " WHERE c.story_id=? ORDER BY c.created_at DESC", [sid])
    : await q.all(sql + " ORDER BY c.created_at DESC LIMIT 200");
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
