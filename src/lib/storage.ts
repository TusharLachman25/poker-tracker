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
  return { ...ledger, settings: { ...defaultSettings(), ...ledger.settings } };
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
    settings: { ...defaultSettings(), ...(v.settings ?? {}) },
  };
}
