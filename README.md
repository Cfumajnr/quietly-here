# Quietly Here — Full App

A bilingual (English / Kiswahili) Kenyan storytelling app with a real backend, its own
database, and a moderator admin panel. Reading is free and anonymous; writers submit
stories that a moderator approves before they go public.

## What's inside

```
quietly-here-app/
├── server.js          # Express API + serves the app and admin panel
├── db.js              # DB layer (local file for dev; Turso cloud for hosting), seed data, password hashing
├── seed-data.js       # the 6 starter stories (migrated from the prototype)
├── data/quietly.db    # the database (created automatically on first run)
└── public/
    ├── index.html     # phone app shell
    ├── app.js         # phone app (reader / writer)  — talks to the API
    ├── app.css        # your original design
    ├── app-shell.css  # mobile full-screen overrides
    ├── admin.html     # moderator dashboard (desktop)
    ├── manifest.webmanifest + icon.svg   # installable on a phone home screen (PWA)
```

Everything shared (stories, comments, reactions, reports, blocks) lives in the server
database, so it's the same for everyone. Only personal preferences (dark mode, language,
saved list, reading progress, your nickname) stay on each device.

## Run it locally

```bash
cd quietly-here-app
npm install
npm start
# Phone app:   http://localhost:3000
# Admin panel: http://localhost:3000/admin
```

## Default moderator login

```
username: moderator
password: quietly2026
```

Change these before going live by setting environment variables **before the first run**
(they seed the first admin account):

```bash
ADMIN_USER=yourname ADMIN_PASS=a-strong-password npm start
```

(To change them after the DB already exists, delete `data/quietly.db*` to re-seed, or
add an admin directly in SQLite.)

## What the moderator can do (/admin)

- **Queue** — review pending submissions, read the full text, see the writer's private
  contact, then **Approve** (optionally marking *tough content* + showing helplines) or **Reject** with a note.
- **Published** — toggle the tough-content label, view/moderate comments, or delete a story.
- **Reports** — see reported comments, hide/delete them, block the author, or resolve the report.
- **Blocked** — block/unblock commenters by nickname or device id.
- **Dashboard** — pending, published, open reports, comments, blocks, total reads.

## Phone app features

Home feed + featured, 4 topics, bilingual EN/SW toggle, search (both languages),
reader with reactions & reporting on comments, guest commenting with a nickname,
story submission, dark mode, saved stories, reading progress, crisis helplines,
"Add to Home Screen" (PWA) so it feels like a native app.

## Hosting it permanently (no Google Play needed)

This is a normal Node web app; any of these host it for free/cheap and give you an HTTPS URL:

- **Render.com** — New → Web Service → connect repo → Build `npm install`, Start `npm start`.
  Add a **persistent disk** mounted at `/opt/render/project/src/data` so the database survives restarts.
- **Railway.app** — New Project → Deploy from repo. Add a volume for the `data/` folder.
- **Fly.io** — `fly launch`, add a volume mounted at `/app/data`.

Set `ADMIN_USER` / `ADMIN_PASS` as environment variables on the host. Share the resulting
URL — people open it in a phone browser and tap "Add to Home Screen".

When you're ready for the Play Store later, this same app can be wrapped with **Bubblewrap /
TWA** (a thin native shell around the web app) with almost no code changes.

## Notes / next steps for production

- Add HTTPS (the hosts above give it automatically).
- Consider rate-limiting the public POST endpoints (submissions/comments) to deter spam.
- In production the data lives in Turso (cloud); locally it's `data/quietly.db` (a single file — easy to copy for backups).
- Optional: email notifications to the moderator when a new story is submitted.
