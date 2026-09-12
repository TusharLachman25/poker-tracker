import type { Activity, Ledger, Payment, Player, Session } from './types';

interface Versioned {
  id: string;
  updatedAt: number;
  deleted?: boolean;
}

/**
 * Last-write-wins merge over a list of versioned records.
 * Deletions are tombstones carrying their own timestamp, so a delete on one
 * phone isn't resurrected by an older copy of the record on another.
 */
function mergeList<T extends Versioned>(mine: T[], theirs: T[]): T[] {
  const out = new Map<string, T>();
  for (const item of mine) out.set(item.id, item);
  for (const item of theirs) {
    const existing = out.get(item.id);
    if (!existing || item.updatedAt > existing.updatedAt) out.set(item.id, item);
  }
  return [...out.values()];
}

/**
 * Combine a local ledger with one pulled from the server.
 *
 * Every record carries `updatedAt`, so two people editing different sessions
 * on different phones both keep their work. Only edits to the *same* record
 * conflict, and there the newer timestamp wins.
 */
export function mergeLedgers(mine: Ledger, theirs: Ledger): Ledger {
  return {
    players: mergeList<Player>(mine.players, theirs.players),
    sessions: mergeList<Session>(mine.sessions, theirs.sessions),
    payments: mergeList<Payment>(mine.payments ?? [], theirs.payments ?? []),
    // Append-only, so this is a union rather than a contest; trimmed to keep
    // the synced document small.
    activity: trimActivity(mergeList<Activity>(mine.activity ?? [], theirs.activity ?? [])),
    // Settings move as one record, so the newer side wins outright. Merging
    // them field by field would let a stale server copy undo a local change.
    settings:
      (theirs.settings?.updatedAt ?? 0) > (mine.settings?.updatedAt ?? 0)
        ? theirs.settings
        : mine.settings,
  };
}

/** The log is a convenience, not an archive — keep it bounded. */
export const MAX_ACTIVITY = 300;

function trimActivity(entries: Activity[]): Activity[] {
  if (entries.length <= MAX_ACTIVITY) return entries;
  return [...entries].sort((a, b) => b.at - a.at).slice(0, MAX_ACTIVITY);
}

/** Drop tombstones that are old enough that every device has surely seen them. */
export function pruneTombstones(ledger: Ledger, olderThanMs = 1000 * 60 * 60 * 24 * 60): Ledger {
  const cutoff = Date.now() - olderThanMs;
  return {
    ...ledger,
    players: ledger.players.filter((p) => !p.deleted || p.updatedAt > cutoff),
    sessions: ledger.sessions.filter((s) => !s.deleted || s.updatedAt > cutoff),
    payments: ledger.payments.filter((p) => !p.deleted || p.updatedAt > cutoff),
  };
}
