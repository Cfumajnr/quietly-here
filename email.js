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

/* Password reset email with a big button + fallback link. */
async function sendPasswordReset({ to, name, link }) {
  const safeName = escapeHtml(name || "there");
  const safeLink = escapeHtml(link);
  const subject = "Reset your Quietly Here password";
  const text =
`Hi ${name || "there"},

We received a request to reset the password for your Quietly Here account.

Set a new password here (the link expires in 1 hour):
${link}

If you didn't ask for this, you can safely ignore this email — your password won't change.

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
    <p style="font-size:15px;line-height:1.6">We received a request to reset your password. Tap the button below to choose a new one. This link expires in <b>1 hour</b>.</p>
    <p style="text-align:center;margin:26px 0">
      <a href="${safeLink}" style="background:#155E5A;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:10px;display:inline-block">Reset my password</a>
    </p>
    <p style="font-size:13px;color:#7C877F;line-height:1.6">If the button doesn't work, copy this link into your browser:<br>
      <a href="${safeLink}" style="color:#155E5A;word-break:break-all">${safeLink}</a></p>
    <p style="font-size:13px;color:#7C877F;line-height:1.6">If you didn't ask to reset your password, you can safely ignore this email — nothing will change.</p>
  </div>
</div>`;
  return sendMail({ to, subject, html, text });
}

/* A personal reply from the moderator to a member (used from the admin panel). */
async function sendAdminReply({ to, name, subject, message }) {
  const safeName = escapeHtml(name || "there");
  const finalSubject = subject && subject.trim() ? subject.trim() : "A message from Quietly Here";
  const paragraphs = String(message || "").split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const text =
`Hi ${name || "there"},

${message}

— The Quietly Here team
write@quiettruths.co.ke`;
  const htmlBody = paragraphs.map(p =>
    `<p style="font-size:15px;line-height:1.7;margin:0 0 14px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`
  ).join("");
  const html =
`<div style="font-family:Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:0 auto;color:#24312B">
  <div style="background:linear-gradient(140deg,#155E5A,#0E423F);border-radius:16px;padding:26px 24px;text-align:center;color:#F6F1E7">
    <div style="font-size:30px;line-height:1">&ldquo;</div>
    <h1 style="font-family:Georgia,serif;font-size:22px;margin:6px 0 2px">Quietly Here</h1>
    <div style="font-size:13px;opacity:.85">Read in silence. Speak without judgment.</div>
  </div>
  <div style="padding:24px 6px">
    <p style="font-size:15px;line-height:1.6">Hi ${safeName},</p>
    ${htmlBody}
    <p style="font-size:14px;color:#4C5A53;line-height:1.6;margin-top:20px">— The Quietly Here team<br>
      <a href="mailto:write@quiettruths.co.ke" style="color:#155E5A">write@quiettruths.co.ke</a></p>
  </div>
</div>`;
  return sendMail({ to, subject: finalSubject, html, text });
}

/* Double opt-in email for a new subscriber. */
async function sendSubscribeConfirm({ to, link }) {
  const safeLink = escapeHtml(link);
  const subject = "Confirm your Quietly Here updates";
  const text =
`Hello,

Thanks for subscribing to Quietly Here. Please confirm your email so we can send you new stories:
${link}

If you didn't request this, you can safely ignore this message.

— Quietly Here`;
  const html =
`<div style="font-family:Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:0 auto;color:#24312B">
  <div style="background:linear-gradient(140deg,#155E5A,#0E423F);border-radius:16px;padding:26px 24px;text-align:center;color:#F6F1E7">
    <div style="font-size:30px;line-height:1">&ldquo;</div>
    <h1 style="font-family:Georgia,serif;font-size:22px;margin:6px 0 2px">Quietly Here</h1>
    <div style="font-size:13px;opacity:.85">Read in silence. Speak without judgment.</div>
  </div>
  <div style="padding:24px 6px">
    <p style="font-size:15px;line-height:1.6">Thanks for subscribing! Confirm your email and we'll let you know whenever a new story is published.</p>
    <p style="text-align:center;margin:26px 0">
      <a href="${safeLink}" style="background:#155E5A;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:10px;display:inline-block">Confirm my subscription</a>
    </p>
    <p style="font-size:13px;color:#7C877F;line-height:1.6">If the button doesn't work, copy this link into your browser:<br>
      <a href="${safeLink}" style="color:#155E5A;word-break:break-all">${safeLink}</a></p>
    <p style="font-size:13px;color:#7C877F;line-height:1.6">If you didn't request this, you can safely ignore this email.</p>
  </div>
</div>`;
  return sendMail({ to, subject, html, text });
}

/* New-story announcement to a confirmed subscriber. */
async function sendNewStory({ to, title, excerpt, url, unsubUrl }) {
  const safeTitle = escapeHtml(title || "A new story");
  const safeUrl = escapeHtml(url);
  const safeExcerpt = escapeHtml(excerpt || "");
  const safeUnsub = escapeHtml(unsubUrl || "");
  const subject = "New on Quietly Here: " + (title || "a new story");
  const text =
`A new story is up on Quietly Here:

${title}

${excerpt || ""}

Read it here: ${url}

—
You're receiving this because you subscribed to Quietly Here.
Unsubscribe: ${unsubUrl}`;
  const html =
`<div style="font-family:Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:0 auto;color:#24312B">
  <div style="background:linear-gradient(140deg,#155E5A,#0E423F);border-radius:16px;padding:24px;text-align:center;color:#F6F1E7">
    <h1 style="font-family:Georgia,serif;font-size:20px;margin:0">Quietly Here</h1>
    <div style="font-size:12px;opacity:.85;margin-top:2px">A new story is up</div>
  </div>
  <div style="padding:24px 6px">
    <h2 style="font-family:Georgia,serif;font-size:21px;line-height:1.3;margin:0 0 10px">${safeTitle}</h2>
    ${safeExcerpt ? `<p style="font-size:15px;line-height:1.7;color:#4C5A53;margin:0 0 18px">${safeExcerpt}</p>` : ""}
    <p style="text-align:center;margin:22px 0">
      <a href="${safeUrl}" style="background:#155E5A;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 28px;border-radius:10px;display:inline-block">Read the story</a>
    </p>
    <p style="font-size:12px;color:#9AA49D;line-height:1.6;border-top:1px solid #E5DCC9;padding-top:14px;margin-top:22px">
      You're receiving this because you subscribed to Quietly Here.<br>
      <a href="${safeUnsub}" style="color:#9AA49D">Unsubscribe</a></p>
  </div>
</div>`;
  return sendMail({ to, subject, html, text });
}

module.exports = { sendMail, sendConfirmation, sendPasswordReset, sendAdminReply, sendSubscribeConfirm, sendNewStory };
