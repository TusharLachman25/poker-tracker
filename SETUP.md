# Sharing the ledger with your friends

Out of the box the app keeps everything on your own phone. That's fine for one
person, but you want the group to see the same numbers — so this connects the
app to a free Supabase project that holds one shared ledger.

**You do this once. Your friends do nothing** — the project and group code get
baked into the build they install.

Budget about five minutes. The free tier is far more than a home game needs, and
there's no credit card.

---

## 1. Create the Supabase project

1. Go to <https://supabase.com> and sign up (GitHub login is quickest).
2. **New project**. Name it anything — "poker" is fine.
3. Pick a database password. You won't need it again; save it somewhere anyway.
4. Choose the region closest to you.
5. Wait a minute or two while it spins up.

## 2. Create the table

1. In the left sidebar open **SQL Editor**.
2. Click **New query**.
3. Open `supabase/schema.sql` from this project, copy the whole file, paste it in.
4. Click **Run**.

You should see "Success. No rows returned." That's correct — it created a table
and three functions, not data.

## 3. Copy your two values

1. Left sidebar → **Settings** (the gear) → **API**.
2. Copy the **Project URL** — looks like `https://abcdefgh.supabase.co`.
3. Copy the **anon public** key — a long string starting `eyJ…`.

> **Is the anon key safe to share?** Yes, with your friends. It's designed to
> ship inside client apps. The `ledgers` table has row-level security switched
> on with no policies, so the key alone can't read or write anything — every
> operation goes through a function that also demands your group code. Don't
> post it publicly, but sending it to your poker group is exactly its job.
>
> The **service_role** key is the dangerous one. Never put that in the app.

## 4. Bake them into the build

In the project folder:

```bash
cp .env.example .env
```

Put the Project URL and anon key into `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`. `.env` is gitignored, so it stays on your machine.

## 5. Create the group and record its code

```bash
npm run dev
```

Open the app, go to **Settings → Set up sharing**. The URL and key are already
filled in, so just tap **Create group**. You'll get a code like
`K7QMPX-R4T9WBNZ2H`. This uploads whatever you've already logged, so nothing is
lost.

Paste that code into `VITE_GROUP_CODE` in `.env`.

## 6. Ship it

```bash
npm run deploy        # publishes the web app
npm run android:apk   # rebuilds the Android app
```

Every install from here on joins the group on first launch. Your friends just
open the link (or the APK) and start logging sessions.

> If you'd rather the code weren't public — the site is open to anyone with the
> URL — leave `VITE_GROUP_CODE` empty. Friends then paste the code once on first
> open, and everything else still happens for them.

---

## How syncing behaves

- Syncs when the app opens, when it comes back to the foreground, a couple of
  seconds after any edit, and once a minute while you have it open.
- The sync button in the top bar shows the current state; tap it to force one.
- **Edits merge, they don't overwrite.** Every player and session carries a
  timestamp. Two people logging different sessions on different phones both keep
  their work — only edits to the *same* record conflict, and the newer one wins.
- Deletes are tombstoned, so deleting a session on one phone doesn't come back
  from another phone's older copy.
- Offline is fine. Changes queue locally and go up next time you have signal.

## Who can see your numbers

Anyone holding the group code can read and edit that group's ledger. That's the
intended design — it's your poker group, not a bank. Treat the code like a
WhatsApp invite link.

If a code gets out, make a new group: **Settings → Disconnect this device**, then
**Set up sharing → Start a group**, and send the new code round. The old row stays
in your Supabase project until you delete it from the Table Editor.

---

## If something goes wrong

**"invalid group code"** — the code, URL, or key doesn't match. Codes are six
characters, a dash, then ten. Check for a stray space when pasting.

**"that group code is already taken"** — you hit the (astronomically unlikely)
case of a duplicate. Tap **Create group** again for a fresh code.

**"Could not reach the group"** — usually no network. It can also mean the SQL
in step 2 didn't run; go back to the SQL Editor and check the `ledgers` table
exists under **Table Editor**.

**Nothing syncs and there's no error** — check Settings shows a group code. If it
offers "Set up sharing" instead, that device isn't connected.

**Numbers look wrong after joining** — a device joining a group merges its local
data in. If someone had test sessions on their phone, those are now in the group.
Delete them from the Sessions tab; the deletion syncs to everyone.

## Backing up

Cloud sync is convenience, not a backup — anyone in the group can delete things.
**Settings → Export backup** writes a JSON file with everything in it, and
**Restore from backup** reads it back. Worth doing occasionally if the stakes
are ever meaningful.
