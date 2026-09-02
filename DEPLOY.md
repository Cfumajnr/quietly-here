# Deploying Quietly Here permanently (for WhatsApp testing)

The sandbox URL is **temporary** — it dies when the session ends. To share a link with
friends that stays up 24/7 and keeps its data, deploy it once. This takes ~10 minutes and
is free. You already have GitHub, so here's that path.

---

## Step 1 — Push the code to GitHub

From this project folder (`quietly-here-app/`):

```bash
git init
git add .
git commit -m "Quietly Here — full app"
git branch -M main
git remote add origin https://github.com/<your-username>/quietly-here.git
git push -u origin main
```

> `.gitignore` already excludes `node_modules/` and `data/` (your database), so no secrets
> or user data get committed.

---

## Step 2 — Deploy on Render (free, keeps the database)

1. Go to **render.com** → sign in with GitHub.
2. **New +** → **Blueprint** → pick your `quietly-here` repo.
   Render reads `render.yaml` and sets up the web service **and** a 1 GB persistent disk
   (so the SQLite database survives restarts) automatically.
3. When prompted, set the two secret env vars:
   - `ADMIN_USER` → your moderator username
   - `ADMIN_PASS` → a strong password
4. Click **Apply**. First build takes a few minutes.
5. You get a permanent URL like **`https://quietly-here.onrender.com`**.

- Phone app: `https://quietly-here.onrender.com`
- Admin panel: `https://quietly-here.onrender.com/admin`

> Not using the blueprint? Create a **Web Service** manually instead: Build `npm install`,
> Start `npm start`, add a **Disk** mounted at `/var/data`, and set env var
> `DATA_DIR=/var/data` plus `ADMIN_USER` / `ADMIN_PASS`.

**Free-tier note:** Render's free web service sleeps after ~15 min idle and wakes on the
next visit (first hit takes ~30s). Fine for testing. Upgrade later to keep it always-on.

---

## Step 3 — Share it

Send the URL on WhatsApp. Tell friends they can tap **"Add to Home Screen"** (in the
browser menu) to get an app icon — it then behaves like a native app (this is the PWA).

---

## Later: a real APK (installable Android file for WhatsApp)

Once hosted at a permanent HTTPS URL, the web app can be wrapped as a **TWA** (Trusted Web
Activity) — a thin Android shell that produces an `.apk`/`.aab` you can send directly.

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://quietly-here.onrender.com/manifest.webmanifest
bubblewrap build      # produces app-release-signed.apk
```

Building the APK needs the Android SDK/JDK installed on your machine (Bubblewrap can
install them for you on first run). The APK just points at your hosted URL, so the hosting
in Steps 1–2 must exist first.

---

## Other hosts (equivalent)

- **Railway.app** — Deploy from GitHub; add a Volume mounted at `/var/data`, set the same env vars.
- **Fly.io** — `fly launch`; add a volume at `/var/data`, set env vars with `fly secrets set`.
