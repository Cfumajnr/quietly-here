# Deploying Quietly Here permanently (free, with persistent data)

The sandbox URL is temporary. To share a link on WhatsApp that stays up and keeps
everyone's submissions & comments, deploy to Render (free) + Turso (free cloud database).
Render's free tier has **no persistent disk**, so we store the data in Turso instead.

Total time: ~15 minutes, no cost.

---

## Step 1 — Create a free Turso database (persistent storage)

1. Go to **turso.tech** → sign up (free "Starter" plan — no card).
2. Create a database (any name, e.g. `quietly-here`). Pick a region near Kenya
   (e.g. Frankfurt / `eu`).
3. Get its connection details — the dashboard shows a **Database URL** like
   `libsql://quietly-here-yourname.turso.io`.
4. Create an **auth token** for it (dashboard → "Create Token", or the CLI
   `turso db tokens create quietly-here`). Copy both values.

You'll paste these into Render in Step 3 as `TURSO_URL` and `TURSO_AUTH_TOKEN`.
(No Turso vars = the app just uses a local file — that's how local dev works.)

---

## Step 2 — Deploy on Render

1. **render.com** → sign in with GitHub.
2. **New +** → **Blueprint** → pick your `quietly-here` repo.
   - Blueprint name: `quietly-here` · Blueprint Path: `render.yaml` · Branch: `main`
   - It reads `render.yaml` (free web service, no disk).
3. **Apply.**

## Step 3 — Set environment variables on Render

In the service → **Environment** → add:

| Key | Value |
|---|---|
| `ADMIN_USER` | your moderator username |
| `ADMIN_PASS` | a strong password |
| `TURSO_URL` | the `libsql://…` URL from Turso |
| `TURSO_AUTH_TOKEN` | the token from Turso |
| `CANONICAL_HOST` | `quietly-here.quiettruths.co.ke` (301-redirects the old onrender.com URL here) |
| `APP_URL` | `https://quietly-here.quiettruths.co.ke` (base for email links & sitemap) |
| `ADMIN_PATH` | *(optional)* a private path like `/mod-desk-7f3a` — moves the moderator panel off the guessable `/admin` URL |

Save → Render redeploys. You'll get a permanent URL like
**`https://quietly-here.onrender.com`**:

- Phone app: `https://quietly-here.onrender.com`
- Admin panel: `https://quietly-here.onrender.com/admin`

Data now lives in Turso, so it survives restarts, sleeps, and redeploys.

> **Free-tier note:** the Render free service sleeps after ~15 min idle and wakes on the
> next visit (first load can be slow). The data is safe in Turso regardless. To keep it
> warm for free, point a free uptime monitor (e.g. **UptimeRobot** or **cron-job.org**) at
> `https://<your-host>/healthz` every 5 minutes — the periodic ping stops the service from
> ever sleeping, so real visitors never hit a cold start. Upgrade to a paid Render plan for
> true always-on.

---

## Step 4 — Share it

Send the URL on WhatsApp. Friends can tap **"Add to Home Screen"** to get an app icon
(this is the PWA — behaves like a native app, no Play Store needed).

---

## Later: a real APK (installable Android file)

Once live at a permanent HTTPS URL, wrap it as a TWA:

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://quietly-here.onrender.com/manifest.webmanifest
bubblewrap build      # -> app-release-signed.apk  (send via WhatsApp)
```

Needs Android SDK/JDK (Bubblewrap can install them on first run). The APK points at your
hosted URL, so hosting (Steps 1–3) must exist first.

---

## Running locally (for development)

```bash
cd quietly-here-app
npm install
npm start          # uses a local file data/quietly.db — no Turso needed
# Phone app: http://localhost:3000   |   Admin: http://localhost:3000/admin
# Admin login: set ADMIN_USER / ADMIN_PASS env vars (if ADMIN_PASS is unset, a random one is printed to the server log on first run)
```
