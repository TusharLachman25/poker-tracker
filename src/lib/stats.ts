import type { Entry, ID, Ledger, Player, PlayerStats, Session } from './types';

/** An entry only counts once real money has moved. Keeps blank rows out of the stats. */
export function isLive(e: Entry): boolean {
  return e.buyIn !== 0 || e.cashOut !== 0;
}

export function entryNet(e: Entry): number {
  return e.cashOut - e.buyIn;
}

export function activeSessions(ledger: Ledger): Session[] {
  return ledger.sessions.filter((s) => !s.deleted);
}

export function activePlayers(ledger: Ledger): Player[] {
  return ledger.players.filter((p) => !p.deleted);
}

/** Oldest first. Ties on date fall back to creation order via updatedAt. */
export function sortedSessions(sessions: Session[]): Session[] {
  return [...sessions].sort(
    (a, b) => a.date.localeCompare(b.date) || a.updatedAt - b.updatedAt,
  );
}

export function sessionEntry(session: Session, playerId: ID): Entry | undefined {
  return session.entries.find((e) => e.playerId === playerId && isLive(e));
}

export function sessionNet(session: Session, playerId: ID): number {
  const e = sessionEntry(session, playerId);
  return e ? entryNet(e) : 0;
}

export interface SessionTotals {
  buyIn: number;
  cashOut: number;
  /** cashOut - buyIn. Should be 0: chips can't be created at the table. */
  discrepancy: number;
  players: number;
  balanced: boolean;
}

export function sessionTotals(session: Session): SessionTotals {
  const live = session.entries.filter(isLive);
  const buyIn = live.reduce((sum, e) => sum + e.buyIn, 0);
  const cashOut = live.reduce((sum, e) => sum + e.cashOut, 0);
  return {
    buyIn,
    cashOut,
    discrepancy: cashOut - buyIn,
    players: live.length,
    balanced: cashOut === buyIn,
  };
}

/**
 * Full stat line for every player, sorted by net descending
 * (the leaderboard order: biggest winner first, biggest loser last).
 */
export function computeStats(ledger: Ledger): PlayerStats[] {
  const sessions = sortedSessions(activeSessions(ledger));
  const stats = new Map<ID, PlayerStats>();

  for (const player of activePlayers(ledger)) {
    stats.set(player.id, {
      player,
      net: 0,
      sessions: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      volume: 0,
      roi: null,
      biggestWin: 0,
      biggestLoss: 0,
      avgPerSession: 0,
      minutesPlayed: 0,
      hourly: null,
      streak: 0,
      cumulative: [],
    });
  }

  for (const session of sessions) {
    for (const entry of session.entries) {
      if (!isLive(entry)) continue;
      const s = stats.get(entry.playerId);
      if (!s) continue; // entry for a deleted player

      const net = entryNet(entry);
      s.net += net;
      s.sessions += 1;
      s.volume += entry.buyIn;
      s.minutesPlayed += session.durationMins ?? 0;

      if (net > 0) s.wins += 1;
      else if (net < 0) s.losses += 1;
      else s.pushes += 1;

      if (net > s.biggestWin) s.biggestWin = net;
      if (net < s.biggestLoss) s.biggestLoss = net;

      s.cumulative.push({
        date: session.date,
        sessionId: session.id,
        net,
        total: s.net,
      });
    }
  }

  for (const s of stats.values()) {
    s.avgPerSession = s.sessions > 0 ? Math.round(s.net / s.sessions) : 0;
    s.roi = s.volume > 0 ? s.net / s.volume : null;
    s.hourly = s.minutesPlayed > 0 ? Math.round(s.net / (s.minutesPlayed / 60)) : null;
    s.streak = currentStreak(s.cumulative.map((c) => c.net));
  }

  return [...stats.values()].sort(
    (a, b) => b.net - a.net || b.sessions - a.sessions || a.player.name.localeCompare(b.player.name),
  );
}

/** Signed length of the current run of wins (+) or losses (-). A break-even session resets it. */
function currentStreak(nets: number[]): number {
  let streak = 0;
  for (let i = nets.length - 1; i >= 0; i--) {
    const net = nets[i];
    if (net === 0) break;
    const sign = net > 0 ? 1 : -1;
    if (streak === 0) streak = sign;
    else if (Math.sign(streak) === sign) streak += sign;
    else break;
  }
  return streak;
}

export interface GroupSummary {
  totalSessions: number;
  totalVolume: number;
  minutesPlayed: number;
  biggestWin: { amount: number; player?: Player; session?: Session } | null;
  biggestLoss: { amount: number; player?: Player; session?: Session } | null;
  unbalanced: Session[];
  lastPlayed: string | null;
}

export function groupSummary(ledger: Ledger): GroupSummary {
  const sessions = sortedSessions(activeSessions(ledger));
  const byId = new Map(ledger.players.map((p) => [p.id, p]));

  let totalVolume = 0;
  let minutesPlayed = 0;
  let biggestWin: GroupSummary['biggestWin'] = null;
  let biggestLoss: GroupSummary['biggestLoss'] = null;
  const unbalanced: Session[] = [];

  for (const session of sessions) {
    const totals = sessionTotals(session);
    totalVolume += totals.buyIn;
    minutesPlayed += session.durationMins ?? 0;
    if (!totals.balanced && totals.players > 0) unbalanced.push(session);

    for (const entry of session.entries) {
      if (!isLive(entry)) continue;
      const net = entryNet(entry);
      if (!biggestWin || net > biggestWin.amount) {
        biggestWin = { amount: net, player: byId.get(entry.playerId), session };
      }
      if (!biggestLoss || net < biggestLoss.amount) {
        biggestLoss = { amount: net, player: byId.get(entry.playerId), session };
      }
    }
  }

  return {
    totalSessions: sessions.length,
    totalVolume,
    minutesPlayed,
    biggestWin: biggestWin && biggestWin.amount > 0 ? biggestWin : null,
    biggestLoss: biggestLoss && biggestLoss.amount < 0 ? biggestLoss : null,
    unbalanced,
    lastPlayed: sessions.length ? sessions[sessions.length - 1].date : null,
  };
}

// ---------------------------------------------------------------------------
// Date range filtering
// ---------------------------------------------------------------------------

export type RangeKey = 'all' | 'month' | 'quarter' | 'year';

export const RANGE_LABELS: Record<RangeKey, string> = {
  all: 'All time',
  month: '30 days',
  quarter: '90 days',
  year: 'This year',
};

function rangeStart(key: RangeKey): string | null {
  const now = new Date();
  if (key === 'all') return null;
  if (key === 'year') return `${now.getFullYear()}-01-01`;
  const days = key === 'month' ? 30 : 90;
  const start = new Date(now.getTime() - days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
}

/** Narrow a ledger to one time window. Players are kept so the roster stays stable. */
export function filterByRange(ledger: Ledger, key: RangeKey): Ledger {
  const start = rangeStart(key);
  if (!start) return ledger;
  return { ...ledger, sessions: ledger.sessions.filter((s) => s.date >= start) };
}
