import type { Ledger, SyncConfig } from './types';

const LEDGER_KEY = 'poker-tracker/ledger/v1';
const SYNC_KEY = 'poker-tracker/sync/v1';

export const defaultSettings = (): Ledger['settings'] => ({
  currency: 'USD',
  groupName: 'Home Game',
  defaultBuyIn: 1000, // $10.00
  defaultStakes: '0.05/0.10',
});

export const emptyLedger = (): Ledger => ({
  players: [],
  sessions: [],
  payments: [],
  activity: [],
  settings: defaultSettings(),
});

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {
    // Corrupt or unavailable storage shouldn't take the whole app down.
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode / quota exceeded — the in-memory state still works.
  }
}

export const loadLedger = (): Ledger => {
  const ledger = read(LEDGER_KEY, emptyLedger());
  // `read` replaces top-level keys wholesale, so a ledger saved before a
  // setting existed would come back missing it. Fill any gaps here.
  return {
    ...ledger,
    // Ledgers saved before these existed have no such arrays.
    payments: ledger.payments ?? [],
    activity: ledger.activity ?? [],
    settings: { ...defaultSettings(), ...ledger.settings },
  };
};
export const saveLedger = (ledger: Ledger): void => write(LEDGER_KEY, ledger);

export const loadSync = (): SyncConfig | null => {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    return raw ? (JSON.parse(raw) as SyncConfig) : null;
  } catch {
    return null;
  }
};

export const saveSync = (config: SyncConfig | null): void => {
  try {
    if (config) localStorage.setItem(SYNC_KEY, JSON.stringify(config));
    else localStorage.removeItem(SYNC_KEY);
  } catch {
    /* ignore */
  }
};

/** Shape-check an imported file before letting it replace real data. */
export function validateLedger(value: unknown): Ledger | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<Ledger>;
  if (!Array.isArray(v.players) || !Array.isArray(v.sessions)) return null;

  const players = v.players.filter(
    (p) => p && typeof p.id === 'string' && typeof p.name === 'string',
  );
  const sessions = v.sessions.filter(
    (s) => s && typeof s.id === 'string' && typeof s.date === 'string' && Array.isArray(s.entries),
  );
  const activity = (v.activity ?? []).filter(
    (a) => a && typeof a.id === 'string' && typeof a.summary === 'string',
  );
  const payments = (v.payments ?? []).filter(
    (p) =>
      p &&
      typeof p.id === 'string' &&
      typeof p.from === 'string' &&
      typeof p.to === 'string' &&
      Number.isFinite(Number(p.amount)),
  );

  return {
    players: players.map((p) => ({ ...p, updatedAt: p.updatedAt ?? Date.now() })),
    sessions: sessions.map((s) => ({
      ...s,
      gameType: s.gameType ?? 'nlh',
      updatedAt: s.updatedAt ?? Date.now(),
      entries: s.entries.filter((e) => e && typeof e.playerId === 'string').map((e) => ({
        playerId: e.playerId,
        buyIn: Number(e.buyIn) || 0,
        cashOut: Number(e.cashOut) || 0,
      })),
    })),
    payments: payments.map((p) => ({
      ...p,
      amount: Math.abs(Math.round(Number(p.amount))) || 0,
      date: typeof p.date === 'string' ? p.date : '',
      updatedAt: p.updatedAt ?? Date.now(),
    })),
    activity: activity.map((a) => ({
      ...a,
      actorName: a.actorName ?? 'Someone',
      at: a.at ?? Date.now(),
      updatedAt: a.updatedAt ?? a.at ?? Date.now(),
    })),
    settings: { ...defaultSettings(), ...(v.settings ?? {}) },
  };
}

// ---------------------------------------------------------------------------
// Device identity
// ---------------------------------------------------------------------------

const WHOAMI_KEY = 'poker-tracker/whoami/v1';

/**
 * Which player is using this device. Stored locally and never synced — it
 * describes the phone, not the group, and every phone answers differently.
 */
export const loadWhoAmI = (): string => {
  try {
    return localStorage.getItem(WHOAMI_KEY) ?? '';
  } catch {
    return '';
  }
};

export const saveWhoAmI = (playerId: string): void => {
  try {
    if (playerId) localStorage.setItem(WHOAMI_KEY, playerId);
    else localStorage.removeItem(WHOAMI_KEY);
  } catch {
    /* ignore */
  }
};
