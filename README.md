# Poker Tracker

Track who's up and who's down across your home game. One codebase ships as an
installable web app (what your iPhone friends use) and as a real Android APK.

Everything works offline and lives on the device. Turn on sharing and the whole
group reads and writes one ledger.

---

## What it does

**Standings** — everyone ranked by profit, with a cumulative-profit graph,
win/loss record, ROI, streaks, and filters for the last 30/90 days or this year.

**Sessions** — log a night: who played, what they bought in for, what they
cashed out. Every player starts at your standard buy-in and **+ buy-in** adds
another bullet in one tap, so a normal night only needs the cash-outs typed in.
The editor adds it up live and warns you when cash-outs don't match buy-ins,
which is almost always a typo rather than a miracle.

**Settle up** — turns everyone's balance into the shortest list of payments
("Sam pays Dev $370"), for one night or for all time.

**Players** — per-person page with their full history, best and worst nights,
hourly rate when you record how long you played.

**Your data** — JSON backup, CSV export for spreadsheets, and optional cloud
sync so the group shares one set of numbers.

Defaults are set for a **$10 buy-in at 0.05/0.10 blinds**. Change the standard
buy-in and the stakes label under **Settings → Your game**; amounts are kept to
the cent throughout, so small-stakes results stay exact.

---

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Unit tests for the money, stats and settle-up logic |
| `npm run smoke` | End-to-end test through the real UI (needs `npm run preview` running) |
| `npm run icons` | Regenerate every icon from `public/icons/icon.svg` |
| `npm run android:apk` | Build, sync, and produce a debug APK |
| `npm run android:open` | Open the project in Android Studio |

---

## Getting it onto phones

**Live at <https://tusharlachman25.github.io/poker-tracker/>**

### iPhone — install the web app

iOS doesn't allow sideloading, so iPhones get the app as an installable PWA.
It behaves like a normal app: own icon, no browser chrome, works offline.

1. Open the link above in **Safari** (this doesn't work from Chrome on iOS).
2. Share → **Add to Home Screen**.

### Android — install the APK

Download it from the [latest release](https://github.com/TusharLachman25/poker-tracker/releases/latest)
and open it. Android will ask you to allow installing from that source the
first time. Android users can equally install the web app from Chrome.

To rebuild the APK yourself:

```bash
npm run android:apk
# -> android/app/build/outputs/apk/debug/app-debug.apk
```

Requires a JDK (21 works) and the Android SDK. If Gradle can't find the SDK,
point it at yours in `android/local.properties`:

```properties
sdk.dir=C:/Users/you/AppData/Local/Android/Sdk
```

### Publishing an update

```bash
npm run deploy
```

Builds and force-pushes `dist/` to the `gh-pages` branch. Your local `.env` is
baked into that build but never committed.

Phones running the installed web app pick up the new version on next launch.
The Android app doesn't auto-update — rebuild the APK and re-send it, or point
people at the web app instead.

> Prefer deploying on every push instead? Grant the token the workflow scope
> with `gh auth refresh -h github.com -s workflow`, then add a GitHub Actions
> Pages workflow. The local script needs no extra permissions, which is why
> it's the default here.

#### A signed release build

Debug APKs are fine for passing round your group. For a Play Store upload you
need a signed release build — create a keystore once:

```bash
keytool -genkey -v -keystore poker-tracker.keystore   -alias poker -keyalg RSA -keysize 2048 -validity 10000
```

then follow the Capacitor signing guide:
<https://capacitorjs.com/docs/android/deploying-to-google-play>

---

## Sharing between friends

The Supabase project and group code are **baked into the build**, so your
friends install the app and are already on the group ledger — no settings, no
pasting codes.

Set it up once:

1. Create a free Supabase project and run `supabase/schema.sql` in its SQL
   editor — see **[SETUP.md](SETUP.md)**.
2. `cp .env.example .env` and fill in the project URL and anon key.
3. `npm run dev`, then **Settings → Set up sharing → Start a group**. Copy the
   group code it gives you into `VITE_GROUP_CODE` in `.env`.
4. `npm run deploy`, and rebuild the APK. Every install from then on joins that
   group automatically.

Leave `.env` empty and the app is simply a local-only tracker; the manual setup
screen appears instead.

Edits merge rather than overwrite, so two people can log different sessions on
different phones and nobody's work disappears. Sync runs when the app opens,
regains focus, and shortly after any change.

> **Worth knowing:** the site is public, and anything baked into the build ships
> to the browser — so anyone who finds the URL can read and edit the group's
> numbers. That's usually fine for a home game. If you'd rather not have that,
> leave `VITE_GROUP_CODE` out: friends then paste one short code the first time
> they open it, and everything else is still automatic.

---

## How it's built

- **React + TypeScript + Vite**, no UI framework — the styling is a small
  hand-written design system in `src/index.css`
- **Zustand** for state, persisted to `localStorage` on every change
- **Capacitor** wraps the same build as an Android app
- **vite-plugin-pwa** makes the web build installable and offline-capable
  (deliberately skipped in the native build, where it would only serve a stale
  UI after an app update)
- The profit chart is hand-drawn SVG — no charting library

### Layout

```
src/
  lib/
    types.ts      Domain model. All money is integer cents.
    money.ts      Parsing and formatting
    stats.ts      Leaderboard, per-player stats, date filtering
    settle.ts     Who-pays-whom
    merge.ts      Last-write-wins merge used by sync
    store.ts      Zustand store + persistence
    sync.ts       Supabase client (lazy-loaded)
    exchange.ts   JSON/CSV export and import
  components/     Shared UI, icons, the chart
  screens/        One file per screen
supabase/
  schema.sql      Run this in the Supabase SQL editor
scripts/
  generate-icons.mjs
  smoke-test.mjs
```

### A note on the money

Amounts are stored as **integer cents** everywhere and only converted for
display. Poker maths is a lot of adding and subtracting, and floating point
drifts — `0.1 + 0.2` famously isn't `0.3`. Integers don't. `npm test` locks this
down along with the settle-up algorithm.
