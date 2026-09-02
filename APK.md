# Turning Quietly Here into an installable Android app (APK)

Your app is a full **PWA** (installable web app) with icons, a service worker, and a
manifest — and it's now live on your **custom domain**. Both build methods below wrap the
**live hosted app**, so we build against the custom domain (NOT the old `*.onrender.com`
host, which Google Safe Browsing false-flagged — that's exactly why we moved):

> **Build against:** `https://quietly-here.quiettruths.co.ke`

Verified ready (checked live): manifest 200, service worker 200, all icons 200 with
correct content-types, `standalone` display, theme/background colors set.

---

## Option 1 — PWABuilder (easiest, no tools, ~5 minutes) ✅ recommended

1. Go to **https://www.pwabuilder.com**
2. Paste your URL: **https://quietly-here.quiettruths.co.ke** → **Start**.
   - It scores your PWA (manifest, service worker, icons). Yours is set up to pass.
3. Click **Package For Stores** → **Android**.
4. Choose options:
   - **Package ID:** `ke.co.quiettruths.quietlyhere`
   - **App name:** `Quietly Here`
   - Leave "Signing key" on **"Create new"** the first time — **download and KEEP the
     generated `signing.keystore` + the passwords/alias shown.** You need the *same* key
     to ship updates later, especially on the Play Store. If you lose it you cannot update
     the app — only publish a brand-new one. Back it up somewhere safe (not just the phone).
5. **Download** the zip. Inside you get:
   - `app-release-signed.apk`  → send this on WhatsApp; friends sideload it.
   - `app-release-bundle.aab`  → upload this to Google Play when you're ready.
   - `assetlinks.json`         → used to remove the address bar (see next section).

---

## Removing the browser address bar (Digital Asset Links) — recommended

By default a wrapped PWA shows a thin Chrome address bar at the top. To get a true
full-screen native feel, you verify you own the domain by publishing the app's signing
fingerprint at `/.well-known/assetlinks.json`.

1. In the PWABuilder download (or the Play Console → Setup → App integrity) find your
   app's **SHA-256 signing-certificate fingerprint** (looks like
   `AB:CD:12:...:EF`). PWABuilder puts a ready-made `assetlinks.json` in the zip.
2. Save that file into this repo at **`public/.well-known/assetlinks.json`**. A template is
   already committed there — replace the placeholder fingerprint with your real one. It
   should look like:
   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "ke.co.quiettruths.quietlyhere",
       "sha256_cert_fingerprints": ["PUT_YOUR_SHA256_FINGERPRINT_HERE"]
     }
   }]
   ```
3. `git push` → Render redeploys → confirm it's live:
   `curl https://quietly-here.quiettruths.co.ke/.well-known/assetlinks.json`
4. Reinstall the APK. The address bar disappears.

The app works fine without this — it's purely cosmetic.

---

## Letting friends install the APK

Android blocks unknown APKs by default. Tell testers: open the file → if prompted,
allow **"Install unknown apps"** for their browser/WhatsApp → Install. (Normal for any app
not from the Play Store.)

---

## Option 2 — Bubblewrap on your own computer (full control)

Needs Node + a JDK; Bubblewrap installs the Android SDK for you on first run.

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://quietly-here.quiettruths.co.ke/manifest.webmanifest
# accept prompts (uses the values in twa-manifest.json below as a guide)
bubblewrap build
# -> produces app-release-signed.apk
```

A ready-made **`twa-manifest.json`** is in this repo as a reference for the answers
(package id `ke.co.quiettruths.quietlyhere`, colors, icon URL, custom-domain host).

---

## Which should you pick?

- Just want an APK to WhatsApp to testers → **Option 1 (PWABuilder).**
- Comfortable with command-line / want to script builds → **Option 2 (Bubblewrap).**

Either way, app updates are automatic: you `git push`, Render redeploys, and the installed
app loads the new version (it just points at your URL). You only rebuild the APK if you
change the icon, name, or package id.

---

## Note on the Play Store (later)

Publishing to Google Play needs a **one-time $25** developer account. Until then, the
sideloaded APK and the PWA "Add to Home Screen" both work with no fees. The `.aab` from
Option 1 is exactly what Play wants when you decide to go there.
