import { create } from 'zustand';
import { describePayment, describeSession, diffSession, entry } from './activity';
import { MAX_ACTIVITY, mergeLedgers } from './merge';
import {
  emptyLedger,
  loadLedger,
  loadSync,
  loadWhoAmI,
  saveLedger,
  saveSync,
  saveWhoAmI,
} from './storage';
import type {
  Activity,
  ActivityAction,
  Entry,
  ID,
  Ledger,
  Payment,
  Player,
  Session,
  Settings,
  SyncConfig,
} from './types';

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
  /** Which player this device belongs to; labels entries in the activity log. */
  whoAmI: ID;
  setWhoAmI: (playerId: ID) => void;
  actor: () => { id?: ID; name: string };
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

  savePayment: (payment: Payment) => void;
  deletePayment: (id: ID) => void;

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
 * Persist a change together with its log entry.
 *
 * Every mutation goes through here, so nothing can quietly change the numbers
 * without leaving a trace — which is the whole point of the log.
 */
function commitLogged(
  set: (partial: Partial<Store>) => void,
  ledger: Ledger,
  actor: { id?: ID; name: string },
  action: ActivityAction,
  summary: string,
  detail?: string,
) {
  const log: Activity[] = [...(ledger.activity ?? []), entry(actor, action, summary, detail)];
  // Oldest first in storage; trimmed from the front when it gets long.
  const activity = log.length > MAX_ACTIVITY ? log.slice(log.length - MAX_ACTIVITY) : log;
  commit(set, { ...ledger, activity });
}

export const useStore = create<Store>((set, get) => ({
  ledger: loadLedger(),
  whoAmI: loadWhoAmI(),
  sync: loadSync(),
  syncState: loadSync() ? 'idle' : 'off',
  syncMessage: '',
  lastSyncedAt: null,

  setWhoAmI(playerId) {
    saveWhoAmI(playerId);
    set({ whoAmI: playerId });
  },

  /** Who this device says it is. Unset devices log as "Someone". */
  actor() {
    const { ledger, whoAmI } = get();
    const me = ledger.players.find((p) => p.id === whoAmI && !p.deleted);
    return me ? { id: me.id, name: me.name } : { name: 'Someone' };
  },

  addPlayer(name) {
    const ledger = get().ledger;
    const used = new Set(ledger.players.filter((p) => !p.deleted).map((p) => p.color));
    const color = PALETTE.find((c) => !used.has(c)) ?? PALETTE[ledger.players.length % PALETTE.length];
    const player: Player = { id: newId(), name: name.trim(), color, updatedAt: Date.now() };
    commitLogged(
      set,
      { ...ledger, players: [...ledger.players, player] },
      get().actor(),
      'player.add',
      player.name,
    );
    return player;
  },

  renamePlayer(id, name) {
    const ledger = get().ledger;
    const before = ledger.players.find((p) => p.id === id);
    if (!before || before.name === name.trim()) return;
    commitLogged(
      set,
      {
        ...ledger,
        players: ledger.players.map((p) =>
          p.id === id ? { ...p, name: name.trim(), updatedAt: Date.now() } : p,
        ),
      },
      get().actor(),
      'player.rename',
      `${before.name} → ${name.trim()}`,
    );
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
    commitLogged(
      set,
      {
        ...ledger,
        players: ledger.players.map((p) =>
          p.id === id ? { ...p, deleted: true, updatedAt: Date.now() } : p,
        ),
      },
      get().actor(),
      'player.remove',
      ledger.players.find((p) => p.id === id)?.name ?? 'a player',
    );
  },

  saveSession(session) {
    const ledger = get().ledger;
    const next: Session = {
      ...session,
      // Blank rows are dropped here so the stats layer never sees them.
      entries: session.entries.filter((e: Entry) => e.buyIn !== 0 || e.cashOut !== 0),
      updatedAt: Date.now(),
    };
    const before = ledger.sessions.find((s) => s.id === next.id);
    const currency = ledger.settings.currency;
    commitLogged(
      set,
      {
        ...ledger,
        sessions: before
          ? ledger.sessions.map((s) => (s.id === next.id ? next : s))
          : [...ledger.sessions, next],
      },
      get().actor(),
      before ? 'session.update' : 'session.create',
      describeSession(next, currency),
      before ? diffSession(before, next, ledger.players, currency) : undefined,
    );
  },

  deleteSession(id) {
    const ledger = get().ledger;
    const gone = ledger.sessions.find((s) => s.id === id);
    commitLogged(
      set,
      {
        ...ledger,
        sessions: ledger.sessions.map((s) =>
          s.id === id ? { ...s, deleted: true, updatedAt: Date.now() } : s,
        ),
      },
      get().actor(),
      'session.delete',
      gone ? describeSession(gone, ledger.settings.currency) : 'a session',
      gone ? diffSession(gone, { ...gone, entries: [] }, ledger.players, ledger.settings.currency) : undefined,
    );
  },

  savePayment(payment) {
    const ledger = get().ledger;
    const next: Payment = {
      ...payment,
      // Direction is carried by from/to, so the amount is always positive.
      amount: Math.abs(payment.amount),
      updatedAt: Date.now(),
    };
    const payments = ledger.payments ?? [];
    const exists = payments.some((p) => p.id === next.id);
    commitLogged(
      set,
      {
        ...ledger,
        payments: exists ? payments.map((p) => (p.id === next.id ? next : p)) : [...payments, next],
      },
      get().actor(),
      'payment.create',
      describePayment(next, ledger.players, ledger.settings.currency),
      next.note,
    );
  },

  deletePayment(id) {
    const ledger = get().ledger;
    const gone = (ledger.payments ?? []).find((p) => p.id === id);
    commitLogged(
      set,
      {
        ...ledger,
        payments: (ledger.payments ?? []).map((p) =>
          p.id === id ? { ...p, deleted: true, updatedAt: Date.now() } : p,
        ),
      },
      get().actor(),
      'payment.delete',
      gone ? describePayment(gone, ledger.players, ledger.settings.currency) : 'a payment',
    );
  },

  updateSettings(patch) {
    const ledger = get().ledger;
    commit(set, {
      ...ledger,
      // Stamped so the next sync can tell this is newer than the server's copy.
      settings: { ...ledger.settings, ...patch, updatedAt: Date.now() },
    });
  },

  replaceLedger(ledger) {
    const previous = get().ledger;
    const erasing = ledger.players.length === 0 && ledger.sessions.length === 0;
    // The log survives the swap: a wipe is exactly the event worth keeping.
    commitLogged(
      set,
      { ...ledger, activity: previous.activity ?? [] },
      get().actor(),
      erasing ? 'ledger.erase' : 'ledger.import',
      erasing
        ? 'Wiped this device'
        : `${ledger.players.length} players, ${ledger.sessions.length} sessions`,
    );
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
