/**
 * Core domain model.
 *
 * All money is stored as INTEGER CENTS. Poker math involves a lot of
 * summing and differencing, and floats drift; cents never do.
 * Convert at the edges only (see lib/money.ts).
 */

export type ID = string;

export type GameType = 'nlh' | 'plo' | 'tournament' | 'mixed' | 'other';

export const GAME_LABELS: Record<GameType, string> = {
  nlh: "No-Limit Hold'em",
  plo: 'Pot-Limit Omaha',
  tournament: 'Tournament',
  mixed: 'Mixed Game',
  other: 'Other',
};

/** A person in your group. */
export interface Player {
  id: ID;
  name: string;
  /** Hex colour used for charts and avatars. */
  color: string;
  /** Soft-delete tombstone so deletions survive a sync merge. */
  deleted?: boolean;
  updatedAt: number;
}

/** One player's result in one session. */
export interface Entry {
  playerId: ID;
  /** Total put in across all buy-ins and re-buys, in cents. */
  buyIn: number;
  /** Total taken off the table at the end, in cents. */
  cashOut: number;
}

/** One night of poker. */
export interface Session {
  id: ID;
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  name?: string;
  location?: string;
  gameType: GameType;
  /** Free text, e.g. "1/2" or "$20 rebuy". */
  stakes?: string;
  /** Length of the session in minutes; powers the hourly-rate stat. */
  durationMins?: number;
  notes?: string;
  entries: Entry[];
  deleted?: boolean;
  updatedAt: number;
}

/** Money actually handed over, settling part or all of a debt. */
export interface Payment {
  id: ID;
  /** Who paid. */
  from: ID;
  /** Who was paid. */
  to: ID;
  /** Always positive, in cents. */
  amount: number;
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  note?: string;
  deleted?: boolean;
  updatedAt: number;
}

export type ActivityAction =
  | 'session.create'
  | 'session.update'
  | 'session.delete'
  | 'payment.create'
  | 'payment.delete'
  | 'player.add'
  | 'player.rename'
  | 'player.remove'
  | 'ledger.import'
  | 'ledger.erase';

/**
 * One entry in the group's paper trail.
 *
 * Append-only: entries are never edited, only pruned when very old. The actor
 * is whoever the device says it belongs to, so this is an honour-system record
 * — enough to answer "who changed my numbers?", not proof against someone
 * determined.
 */
export interface Activity {
  id: ID;
  /** Player this device is set to, if any. */
  actorId?: ID;
  /** Name captured when it happened, so a later rename doesn't rewrite history. */
  actorName: string;
  action: ActivityAction;
  /** One-line description of what was touched. */
  summary: string;
  /** Optional specifics — for an edit, which numbers moved. */
  detail?: string;
  /** When it happened. */
  at: number;
  updatedAt: number;
}

export interface Settings {
  /** ISO 4217 code, e.g. "AUD", "USD", "GBP". */
  currency: string;
  /**
   * The group's name — the one thing it's called.
   *
   * When sharing is on this is also what friends type to join, so it is fixed
   * for as long as the device is connected. There is deliberately no second,
   * separate name for the game itself.
   */
  groupName: string;
  /** Standard buy-in in cents. Pre-fills new sessions and drives the rebuy button. */
  defaultBuyIn: number;
  /** Free text shown on new sessions, e.g. "0.05/0.10". */
  defaultStakes: string;
  /**
   * When these settings were last changed.
   *
   * Settings move as one record, so a sync has to know which side is newer.
   * Without this the server's copy always won and a local change — switching
   * currency, say — was silently undone by the next sync.
   */
  updatedAt: number;
}

/** The entire app state, and the exact shape that gets synced. */
export interface Ledger {
  players: Player[];
  sessions: Session[];
  payments: Payment[];
  activity: Activity[];
  settings: Settings;
}

export interface SyncConfig {
  url: string;
  anonKey: string;
  /** Slug derived from the group name; the key the ledger is stored under. */
  ledgerId: string;
  /** The group password. */
  secret: string;
}

// ---------------------------------------------------------------------------
// Derived types
// ---------------------------------------------------------------------------

export interface PlayerStats {
  player: Player;
  /** cashOut - buyIn, summed. The headline number. */
  net: number;
  sessions: number;
  wins: number;
  losses: number;
  pushes: number;
  /** Total money staked; the denominator for ROI. */
  volume: number;
  /** net / volume, or null when they have never bought in. */
  roi: number | null;
  biggestWin: number;
  biggestLoss: number;
  avgPerSession: number;
  minutesPlayed: number;
  /** Cents per hour, or null when no session has a recorded duration. */
  hourly: number | null;
  /** Signed run length: +3 = three winning sessions in a row. */
  streak: number;
  /** Running net after each session, oldest first. */
  cumulative: { date: string; sessionId: ID; net: number; total: number }[];
}

/**
 * Where a player stands once payments are taken into account.
 * This is the number that actually matters when squaring up.
 */
export interface Balance {
  player: Player;
  /** Winnings and losses from sessions alone. */
  net: number;
  /** Total this player has handed over. */
  paid: number;
  /** Total this player has been given. */
  received: number;
  /** Positive: still owed this much. Negative: still owes it. */
  outstanding: number;
}

/** One leg of a settle-up plan: `from` pays `to`. */
export interface Transfer {
  from: ID;
  to: ID;
  amount: number;
}
