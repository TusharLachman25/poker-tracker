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

export interface Settings {
  /** ISO 4217 code, e.g. "USD", "INR", "GBP". */
  currency: string;
  groupName: string;
  /** Standard buy-in in cents. Pre-fills new sessions and drives the rebuy button. */
  defaultBuyIn: number;
  /** Free text shown on new sessions, e.g. "0.05/0.10". */
  defaultStakes: string;
}

/** The entire app state, and the exact shape that gets synced. */
export interface Ledger {
  players: Player[];
  sessions: Session[];
  settings: Settings;
}

export interface SyncConfig {
  url: string;
  anonKey: string;
  /** Slug derived from the group name; the key the ledger is stored under. */
  ledgerId: string;
  /** The group password. */
  secret: string;
  /** The name as typed, kept for display since the id is a slug. */
  groupName: string;
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

/** One leg of a settle-up plan: `from` pays `to`. */
export interface Transfer {
  from: ID;
  to: ID;
  amount: number;
}
