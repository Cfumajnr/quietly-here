/* ============================================================
   Quietly Here — transactional email (Resend)
   - Production: set RESEND_API_KEY (+ optional EMAIL_FROM, APP_URL).
   - No key set: emails are logged to the console instead of sent,
     so local dev and first deploys still work end-to-end.
   ============================================================ */
"use strict";

const FROM = process.env.EMAIL_FROM || "Quietly Here <noreply@quiettruths.co.ke>";
const KEY = process.env.RESEND_API_KEY || "";

/* Send an email. Returns { ok, id? , error? }.
   Never throws — callers can proceed even if mail is down. */
async function sendMail({ to, subject, html, text }) {
  if (!KEY) {
    console.log("\n[email:DEV] (no RESEND_API_KEY — not actually sent)");
    console.log("  to:", to);
    console.log("  subject:", subject);
    if (text) console.log("  text:", text.replace(/\n/g, "\n        "));
    console.log("");
    return { ok: true, dev: true };
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, html, text })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { console.error("[email] Resend error:", r.status, j); return { ok: false, error: j.message || ("HTTP " + r.status) }; }
    return { ok: true, id: j.id };
  } catch (e) {
    console.error("[email] send failed:", e);
    return { ok: false, error: String(e.message || e) };
  }
}

const escapeHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

/* Confirmation email with a big button + fallback link. */
async function sendConfirmation({ to, name, link }) {
  const safeName = escapeHtml(name || "there");
  const safeLink = escapeHtml(link);
  const subject = "Confirm your Quietly Here account";
  const text =
`Hi ${name || "there"},

Welcome to Quietly Here — a place to read in silence and speak without judgment.

Please confirm your email to finish setting up your account:
${link}

If you didn't create this account, you can safely ignore this message.

— Quietly Here`;
  const html =
`<div style="font-family:Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:0 auto;color:#24312B">
  <div style="background:linear-gradient(140deg,#155E5A,#0E423F);border-radius:16px;padding:26px 24px;text-align:center;color:#F6F1E7">
    <div style="font-size:30px;line-height:1">&ldquo;</div>
    <h1 style="font-family:Georgia,serif;font-size:22px;margin:6px 0 2px">Quietly Here</h1>
    <div style="font-size:13px;opacity:.85">Read in silence. Speak without judgment.</div>
  </div>
  <div style="padding:24px 6px">
    <p style="font-size:15px;line-height:1.6">Hi ${safeName},</p>
    <p style="font-size:15px;line-height:1.6">Welcome! Please confirm your email to finish setting up your account and start saving stories.</p>
    <p style="text-align:center;margin:26px 0">
      <a href="${safeLink}" style="background:#155E5A;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:10px;display:inline-block">Confirm my email</a>
    </p>
    <p style="font-size:13px;color:#7C877F;line-height:1.6">If the button doesn't work, copy this link into your browser:<br>
      <a href="${safeLink}" style="color:#155E5A;word-break:break-all">${safeLink}</a></p>
    <p style="font-size:13px;color:#7C877F;line-height:1.6">If you didn't create this account, you can safely ignore this email.</p>
  </div>
</div>`;
  return sendMail({ to, subject, html, text });
}

module.exports = { sendMail, sendConfirmation };
