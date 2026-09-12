import { create } from 'zustand';
import { mergeLedgers } from './merge';
import { bakedSyncConfig } from './env';
import { emptyLedger, hasOptedOut, loadLedger, loadSync, saveLedger, saveSync } from './storage';
import type { Entry, ID, Ledger, Player, Session, Settings, SyncConfig } from './types';

/** Chart-friendly palette: distinct hues, all legible on the dark felt background. */
export const PALETTE = [
  '#4ade80', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa',
  '#22d3ee', '#fb923c', '#f87171', '#34d399', '#c084fc',
];

export const newId = (): string =>
  // crypto.randomUUID needs a secure context; the fallback keeps file:// and
  // older Android WebViews working.
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export type SyncState = 'idle' | 'syncing' | 'ok' | 'error' | 'off';

interface Store {
  ledger: Ledger;
  sync: SyncConfig | null;
  syncState: SyncState;
  syncMessage: string;
  lastSyncedAt: number | null;

  addPlayer: (name: string) => Player;
  renamePlayer: (id: ID, name: string) => void;
  recolorPlayer: (id: ID, color: string) => void;
  deletePlayer: (id: ID) => void;

  saveSession: (session: Session) => void;
  deleteSession: (id: ID) => void;

  updateSettings: (patch: Partial<Settings>) => void;

  replaceLedger: (ledger: Ledger) => void;
  mergeIn: (incoming: Ledger) => void;
  setSync: (config: SyncConfig | null) => void;
  setSyncState: (state: SyncState, message?: string) => void;
  markSynced: () => void;
}

/** Single place where state is persisted, so no mutation can forget to save. */
function commit(set: (partial: Partial<Store>) => void, ledger: Ledger) {
  saveLedger(ledger);
  set({ ledger });
}

/**
 * What this device syncs with: whatever it saved last, otherwise the group
 * baked into the build — so a friend's first launch is already connected.
 * An explicit disconnect is respected and wins over the baked-in group.
 */
function initialSync() {
  return loadSync() ?? (hasOptedOut() ? null : bakedSyncConfig());
}

const startingSync = initialSync();

export const useStore = create<Store>((set, get) => ({
  ledger: loadLedger(),
  sync: startingSync,
  syncState: startingSync ? 'idle' : 'off',
  syncMessage: '',
  lastSyncedAt: null,

  addPlayer(name) {
    const ledger = get().ledger;
    const used = new Set(ledger.players.filter((p) => !p.deleted).map((p) => p.color));
    const color = PALETTE.find((c) => !used.has(c)) ?? PALETTE[ledger.players.length % PALETTE.length];
    const player: Player = { id: newId(), name: name.trim(), color, updatedAt: Date.now() };
    commit(set, { ...ledger, players: [...ledger.players, player] });
    return player;
  },

  renamePlayer(id, name) {
    const ledger = get().ledger;
    commit(set, {
      ...ledger,
      players: ledger.players.map((p) =>
        p.id === id ? { ...p, name: name.trim(), updatedAt: Date.now() } : p,
      ),
    });
  },

  recolorPlayer(id, color) {
    const ledger = get().ledger;
    commit(set, {
      ...ledger,
      players: ledger.players.map((p) =>
        p.id === id ? { ...p, color, updatedAt: Date.now() } : p,
      ),
    });
  },

  deletePlayer(id) {
    const ledger = get().ledger;
    // Tombstone rather than splice: a hard delete would come back on next sync,
    // and past sessions keep their history either way.
    commit(set, {
      ...ledger,
      players: ledger.players.map((p) =>
        p.id === id ? { ...p, deleted: true, updatedAt: Date.now() } : p,
      ),
    });
  },

  saveSession(session) {
    const ledger = get().ledger;
    const next: Session = {
      ...session,
      // Blank rows are dropped here so the stats layer never sees them.
      entries: session.entries.filter((e: Entry) => e.buyIn !== 0 || e.cashOut !== 0),
      updatedAt: Date.now(),
    };
    const exists = ledger.sessions.some((s) => s.id === next.id);
    commit(set, {
      ...ledger,
      sessions: exists
        ? ledger.sessions.map((s) => (s.id === next.id ? next : s))
        : [...ledger.sessions, next],
    });
  },

  deleteSession(id) {
    const ledger = get().ledger;
    commit(set, {
      ...ledger,
      sessions: ledger.sessions.map((s) =>
        s.id === id ? { ...s, deleted: true, updatedAt: Date.now() } : s,
      ),
    });
  },

  updateSettings(patch) {
    const ledger = get().ledger;
    commit(set, { ...ledger, settings: { ...ledger.settings, ...patch } });
  },

  replaceLedger(ledger) {
    commit(set, ledger);
  },

  mergeIn(incoming) {
    commit(set, mergeLedgers(get().ledger, incoming));
  },

  setSync(config) {
    saveSync(config);
    set({ sync: config, syncState: config ? 'idle' : 'off', syncMessage: '' });
  },

  setSyncState(state, message = '') {
    set({ syncState: state, syncMessage: message });
  },

  markSynced() {
    set({ syncState: 'ok', syncMessage: '', lastSyncedAt: Date.now() });
  },
}));

export { emptyLedger };
