/* ============================================================
   Quietly Here — lightweight rate limiting (no external deps)
   In-memory sliding-window + cooldown helpers. Suitable for a
   single-instance free-tier deploy; DB-backed quotas (per hour/day)
   live in server.js for accuracy across restarts.
   ============================================================ */
"use strict";

const hits = new Map();      // key -> [timestamps]
const cooldowns = new Map(); // key -> lastTimestamp

/* Sliding-window limiter. Returns {ok, retryAfter(sec)}. */
function windowLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    const retryAfter = Math.ceil((windowMs - (now - arr[0])) / 1000);
    hits.set(key, arr);
    return { ok: false, retryAfter };
  }
  arr.push(now);
  hits.set(key, arr);
  return { ok: true };
}

/* Minimum spacing between two actions of the same kind. */
function cooldown(key, minMs) {
  const now = Date.now();
  const last = cooldowns.get(key) || 0;
  if (now - last < minMs) return { ok: false, retryAfter: Math.ceil((minMs - (now - last)) / 1000) };
  cooldowns.set(key, now);
  return { ok: true };
}

/* Failed-attempt tracker (for admin login brute-force). */
const fails = new Map(); // key -> {count, first}
function recordFail(key, max, windowMs) {
  const now = Date.now();
  let e = fails.get(key);
  if (!e || now - e.first > windowMs) e = { count: 0, first: now };
  e.count += 1;
  fails.set(key, e);
  return e.count;
}
function isLocked(key, max, windowMs) {
  const e = fails.get(key);
  if (!e) return false;
  if (Date.now() - e.first > windowMs) { fails.delete(key); return false; }
  return e.count >= max;
}
function clearFails(key) { fails.delete(key); }

/* periodic cleanup so the maps don't grow forever */
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of hits) { const a = arr.filter((t) => now - t < 3600e3); if (a.length) hits.set(k, a); else hits.delete(k); }
  for (const [k, t] of cooldowns) if (now - t > 3600e3) cooldowns.delete(k);
  for (const [k, e] of fails) if (now - e.first > 3600e3) fails.delete(k);
}, 10 * 60e3).unref();

module.exports = { windowLimit, cooldown, recordFail, isLocked, clearFails };
