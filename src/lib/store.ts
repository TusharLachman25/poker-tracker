import { create } from 'zustand';
import {
  describeGhosting,
  describePayment,
  describeSession,
  describeUnghost,
  diffSession,
  entry,
} from './activity';
import { isoDate } from './dates';
import { planGhosting } from './ghost';
import { MAX_ACTIVITY, mergeLedgers } from './merge';
import { money } from './money';
import {
  addDays,
  earliestStart,
  seasonLedger,
  seasonOfPayment,
  seasonsOf,
  type SeasonView,
} from './seasons';
import { activePayments, computeBalances } from './stats';
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
  Season,
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
  /**
   * Changes made on this device, counted. The sync engine pushes shortly after
   * one of these — not after every change to the ledger, because a merge from
   * the group changes it too, and counting that as an edit scheduled the next
   * sync from inside the last one: a full pull and push every few seconds for
   * as long as the app was open.
   */
  edits: number;
  /**
   * Which season the screens are showing. Per phone and never saved, so the
   * app always opens on the season in play.
   */
  viewing: SeasonView;
  setViewing: (view: SeasonView) => void;

  addPlayer: (name: string) => Player;
  renamePlayer: (id: ID, name: string) => void;
  recolorPlayer: (id: ID, color: string) => void;
  deletePlayer: (id: ID) => void;
  /** They've stopped turning up: write off their balance and leave them out of new sessions. */
  ghostPlayer: (id: ID) => void;
  /** They're back: put the write-off back exactly as it was. */
  unghostPlayer: (id: ID) => void;

  saveSession: (session: Session) => void;
  deleteSession: (id: ID) => void;

  savePayment: (payment: Payment) => void;
  deletePayment: (id: ID) => void;

  updateSettings: (patch: Partial<Settings>) => void;

  /**
   * End the season in play and start a fresh one: a new leaderboard and new
   * debts from `start` on. The first time, everything so far becomes a season
   * called `endingName`.
   */
  startSeason: (next: { endingName: string; name: string; start: string }) => void;
  renameSeason: (id: ID, name: string) => void;
  /** Take back the season in play, as though it had never been started. */
  undoSeason: (id: ID) => void;

  replaceLedger: (ledger: Ledger) => void;
  mergeIn: (incoming: Ledger) => void;
  setSync: (config: SyncConfig | null) => void;
  setSyncState: (state: SyncState, message?: string) => void;
  markSynced: () => void;
}

type SetState = (partial: Partial<Store> | ((state: Store) => Partial<Store>)) => void;

/**
 * Single place where state is persisted, so no mutation can forget to save.
 * Everything that comes through here is an edit made on this device, except a
 * merge from the group, which passes `local: false`.
 */
function commit(set: SetState, ledger: Ledger, local = true) {
  saveLedger(ledger);
  set(local ? (state) => ({ ledger, edits: state.edits + 1 }) : { ledger });
}

/**
 * Persist a change together with its log entry.
 *
 * Every mutation goes through here, so nothing can quietly change the numbers
 * without leaving a trace — which is the whole point of the log.
 */
function commitLogged(
  set: SetState,
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
  edits: 0,
  viewing: 'current',

  setViewing(view) {
    set({ viewing: view });
  },

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

  ghostPlayer(id) {
    const ledger = get().ledger;
    const player = ledger.players.find((p) => p.id === id);
    if (!player || player.ghostedAt) return;
    // Each season's balance is written off within that season.
    const parts = planGhosting(ledger, id);

    const at = Date.now();
    // Each share goes the way a real payment settling it would have: the
    // ghost "pays" the people taking on their debt, or the people keeping
    // money they owed the ghost "pay" it. That is what makes the balances
    // come out right everywhere, even on a phone running an older version.
    const writeOffs: Payment[] = parts.flatMap(({ season, plan }) => {
      const owes = plan.target.outstanding < 0;
      return plan.shares.map((share) => ({
        id: newId(),
        from: owes ? id : share.balance.player.id,
        to: owes ? share.balance.player.id : id,
        amount: share.amount,
        date: isoDate(at),
        writeOff: { player: id, at },
        ...(season ? { season: season.id } : {}),
        updatedAt: at,
      }));
    });

    commitLogged(
      set,
      {
        ...ledger,
        players: ledger.players.map((p) =>
          p.id === id ? { ...p, ghostedAt: at, updatedAt: at } : p,
        ),
        payments: [
          // A write-off from an earlier ghosting that didn't stick — say two
          // phones ghosted them before syncing — is retired here, so no
          // version of the app goes on counting it.
          ...(ledger.payments ?? []).map((p) =>
            p.writeOff?.player === id && !p.deleted ? { ...p, deleted: true, updatedAt: at } : p,
          ),
          ...writeOffs,
        ],
      },
      get().actor(),
      'player.ghost',
      player.name,
      describeGhosting(parts, ledger.settings.currency),
    );
  },

  unghostPlayer(id) {
    const ledger = get().ledger;
    const player = ledger.players.find((p) => p.id === id);
    if (!player?.ghostedAt) return;

    const now = Date.now();
    const restored = activePayments(ledger).filter((p) => p.writeOff?.player === id);

    commitLogged(
      set,
      {
        ...ledger,
        players: ledger.players.map((p) =>
          p.id === id ? { ...p, ghostedAt: undefined, updatedAt: now } : p,
        ),
        // Tombstoned rather than dropped, so the undo reaches every phone —
        // including ones that count write-offs as ordinary payments.
        payments: (ledger.payments ?? []).map((p) =>
          p.writeOff?.player === id && !p.deleted ? { ...p, deleted: true, updatedAt: now } : p,
        ),
      },
      get().actor(),
      'player.unghost',
      player.name,
      describeUnghost(restored, ledger.players, ledger.settings.currency),
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

  startSeason({ endingName, name, start }) {
    const ledger = get().ledger;
    const seasons = seasonsOf(ledger);
    const now = Date.now();
    const earliest = earliestStart(ledger);
    // Tomorrow at the latest: starting then keeps a game played tonight in
    // the season that's ending.
    const latest = addDays(isoDate(now), 1);
    if (!name.trim() || !start || start > latest || (earliest && start < earliest)) return;

    const current = seasons[seasons.length - 1];
    // The first time, everything so far becomes a season of its own.
    const ending: Season = current
      ? { ...current, name: endingName.trim() || current.name }
      : { id: newId(), name: endingName.trim() || 'Season 1', start: '' };
    const before = current ? seasons.map((s) => (s.id === ending.id ? ending : s)) : [ending];
    const next: Season = { id: newId(), name: name.trim(), start };
    const known = new Set(before.map((s) => s.id));

    // What the ending season is left with, for the log.
    const ended = seasonLedger({ ...ledger, settings: { ...ledger.settings, seasons: before } }, ending);
    const stillOwed = computeBalances(ended).reduce((sum, b) => sum + Math.max(0, b.outstanding), 0);

    commitLogged(
      set,
      {
        ...ledger,
        // Every payment so far settles debts from before this season — even
        // one handed over today, the usual end-of-semester squaring up. Pin
        // each to the season it belongs to now, so the new season's start
        // date can't pull it across.
        payments: (ledger.payments ?? []).map((p) =>
          p.deleted || (p.season && known.has(p.season))
            ? p
            : { ...p, season: seasonOfPayment(before, p)?.id, updatedAt: now },
        ),
        settings: { ...ledger.settings, seasons: [...before, next], updatedAt: now },
      },
      get().actor(),
      'season.start',
      next.name,
      stillOwed > 0
        ? `${ending.name} ended with ${money(stillOwed, ledger.settings.currency)} still owed`
        : `${ending.name} ended all square`,
    );
    // Anyone looking at an older season lands on the new one.
    set({ viewing: 'current' });
  },

  renameSeason(id, name) {
    const ledger = get().ledger;
    const seasons = seasonsOf(ledger);
    const before = seasons.find((s) => s.id === id);
    const trimmed = name.trim();
    if (!before || !trimmed || before.name === trimmed) return;
    commitLogged(
      set,
      {
        ...ledger,
        settings: {
          ...ledger.settings,
          seasons: seasons.map((s) => (s.id === id ? { ...s, name: trimmed } : s)),
          updatedAt: Date.now(),
        },
      },
      get().actor(),
      'season.rename',
      `${before.name} → ${trimmed}`,
    );
  },

  undoSeason(id) {
    const ledger = get().ledger;
    const seasons = seasonsOf(ledger);
    const latest = seasons[seasons.length - 1];
    // Only the season in play can be taken back. The first one holds
    // everything from before seasons, so it isn't a season to take back.
    if (!latest || latest.id !== id || seasons.length < 2) return;
    const rest = seasons.slice(0, -1);
    commitLogged(
      set,
      {
        ...ledger,
        settings: {
          ...ledger.settings,
          // Down to one season is back to no seasons at all. Payments pinned
          // to the season taken back fall back to their dates, which now land
          // them in the one before.
          seasons: rest.length > 1 ? rest : undefined,
          updatedAt: Date.now(),
        },
      },
      get().actor(),
      'season.undo',
      latest.name,
      rest.length > 1
        ? `Its nights and payments are back in ${rest[rest.length - 1].name}`
        : 'Its nights and payments are back with everything before it',
    );
    set({ viewing: 'current' });
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
    // Not an edit: the sync that brought this in has already pushed it back.
    commit(set, mergeLedgers(get().ledger, incoming), false);
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
