import type { Ledger, Player, Session } from './types';

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
    // Settings are a single small record; prefer whichever side named the group.
    settings: theirs.settings?.groupName ? { ...mine.settings, ...theirs.settings } : mine.settings,
  };
}

/** Drop tombstones that are old enough that every device has surely seen them. */
export function pruneTombstones(ledger: Ledger, olderThanMs = 1000 * 60 * 60 * 24 * 60): Ledger {
  const cutoff = Date.now() - olderThanMs;
  return {
    ...ledger,
    players: ledger.players.filter((p) => !p.deleted || p.updatedAt > cutoff),
    sessions: ledger.sessions.filter((s) => !s.deleted || s.updatedAt > cutoff),
  };
}
