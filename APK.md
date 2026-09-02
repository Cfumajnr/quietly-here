# Turning Quietly Here into an installable Android app (APK)

Your app is a full **PWA** (installable web app) with icons, a service worker, and a
manifest. There are two ways to get an actual `.apk` file you can send on WhatsApp.
Both wrap the **live hosted app** — so your Render URL must be up first (it is:
https://quietly-here.onrender.com).

---

## Option 1 — PWABuilder (easiest, no tools, ~5 minutes) ✅ recommended

1. Go to **https://www.pwabuilder.com**
2. Paste your URL: **https://quietly-here.onrender.com** → **Start**.
   - It scores your PWA (manifest, service worker, icons). Yours is set up to pass.
3. Click **Package For Stores** → **Android**.
4. Choose options:
   - **Package ID:** `app.quietlyhere.twa` (or your own reverse-domain id)
   - Leave "Signing key" on **"Create new"** the first time — **download and KEEP the
     generated `signing.keystore` + the password shown.** You'll need the *same* key to
     ship updates later, especially for the Play Store.
5. **Download** the zip. Inside you get:
   - `app-release-signed.apk`  → send this on WhatsApp; friends sideload it.
   - `app-release-bundle.aab`  → upload this to Google Play when you're ready.
6. (Optional, removes the little browser address bar for a native feel) PWABuilder shows
   an **`assetlinks.json`** and a Digital Asset Links step. To enable it, save that file to
   `public/.well-known/assetlinks.json` in this repo and redeploy. The app works without
   it too.

### Letting friends install the APK
Android blocks unknown APKs by default. Tell testers: open the file → if prompted,
allow **"Install unknown apps"** for their browser/WhatsApp → Install. (This is normal for
any app not from the Play Store.)

---

## Option 2 — Bubblewrap on your own computer (full control)

Needs Node + a JDK; Bubblewrap installs the Android SDK for you on first run.

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://quietly-here.onrender.com/manifest.webmanifest
# accept prompts (uses the values in twa-manifest.json below as a guide)
bubblewrap build
# -> produces app-release-signed.apk
```

A ready-made **`twa-manifest.json`** is included in this repo as a reference for the
answers (package id, colors, icon URL).

---

## Which should you pick?

- Just want an APK to WhatsApp to testers → **Option 1 (PWABuilder).**
- Comfortable with command-line / want to script builds → **Option 2 (Bubblewrap).**

Either way, updates to the app itself are automatic: you `git push`, Render redeploys, and
the installed app loads the new version (it just points at your URL). You only rebuild the
APK if you change the icon, name, or package id.

---

## Note on the Play Store (later)

Publishing to Google Play needs a **one-time $25** developer account. Until then, the APK
(sideloaded) and the PWA "Add to Home Screen" both work with no fees. The `.aab` from
Option 1 is exactly what Play wants when you decide to go there.
