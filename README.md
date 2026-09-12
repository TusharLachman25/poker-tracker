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

**Payments** — who owes who, as the fewest payments that clear everyone.
Balances are netted first, so nobody pays and gets paid on the same night: if
Kabir owes Tushar $10 and Sid $10, and Sid owes Tushar $3, it settles as Kabir
paying Tushar $13 and Sid $7. Record one (in full or in part) and it comes straight off the
outstanding totals, with a history of everything already settled. A session
can also be settled on its own, straight from the session editor.

**Players** — per-person page with their full history, best and worst nights,
hourly rate when you record how long you played.

**Group activity** — every session, payment and player change, with who made
it. An edit records the numbers on both sides of it ("Sam: -$10 → -$2.50"), so
a quietly rewritten result is visible rather than silent. Set who's using each
phone under **Settings → Who's using this phone**; it's an honour-system record
for a friendly group, not proof against someone determined.

**Your data** — JSON backup, CSV export for spreadsheets (sessions, standings,
payments and outstanding balances), and optional cloud sync so the group shares
one set of numbers.

Defaults are set for a **$10 AUD buy-in at 0.05/0.10 blinds**. Change the
currency, standard buy-in and stakes label under **Settings → Your group**;
amounts are kept to the cent throughout, so small-stakes results stay exact.

The group has exactly one name. When sharing is on it's also what friends type
to join, so it's fixed for as long as the device is connected.

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

Builds and force-pushes `dist/` to the `gh-pages` branch.

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

Each phone keeps its own copy until you connect it to a group. One person
creates a free Supabase project and a group; everyone else joins with a code.
See **[SETUP.md](SETUP.md)** for the click-by-click version. Roughly:

1. One person creates a Supabase project and runs `supabase/schema.sql`.
2. In the app: **Settings → Set up sharing**, paste the project URL and anon
   key, pick a **group name and password**, tap **Create group**.
3. **Settings → Copy invite for a friend** gives you one message with
   everything the others need. They tap **Join a group** instead.

Nothing is baked into the build. The site is public, so anything shipped in the
bundle would be readable by anyone who found the URL — keeping the credentials
out means only people you've invited can see your numbers. Group names are
guessable, so the password is what actually protects the group; pick a real one.

Edits merge rather than overwrite, so two people can log different sessions on
different phones and nobody's work disappears. Sync runs when the app opens,
regains focus, and shortly after any change.

Free-tier Supabase is far more than a home game will ever need.

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
    stats.ts      Leaderboard, per-player stats, outstanding balances
    settle.ts     Who-pays-whom
    activity.ts   Audit-log entries and session diffing
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
