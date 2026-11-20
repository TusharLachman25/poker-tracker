import type { Balance, Entry, ID, Ledger, Payment, Player, PlayerStats, Session } from './types';

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

/**
 * Every payment that counts towards balances, write-offs included.
 *
 * A write-off only counts while the ghosting it belongs to stands. One left
 * behind — by an unghost, or by two phones ghosting the same player before
 * syncing — is ignored rather than counted twice.
 */
export function activePayments(ledger: Ledger): Payment[] {
  const ghostedAt = new Map(ledger.players.map((p) => [p.id, p.ghostedAt]));
  return (ledger.payments ?? []).filter((p) => {
    if (p.deleted || !(p.amount > 0)) return false;
    if (!p.writeOff) return true;
    const at = ghostedAt.get(p.writeOff.player);
    return at !== undefined && at === p.writeOff.at;
  });
}

/** Money that actually changed hands, as opposed to a share of a write-off. */
export function realPayments(ledger: Ledger): Payment[] {
  return activePayments(ledger).filter((p) => !p.writeOff);
}

/** Newest first — the order a payment history wants to be read in. */
export function sortedPayments(payments: Payment[]): Payment[] {
  return [...payments].sort(
    (a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt,
  );
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
// Outstanding balances
// ---------------------------------------------------------------------------

/**
 * What everyone still owes once payments are accounted for.
 *
 * A player's session net is where they *should* end up. Handing money over
 * moves both people closer to zero: the payer's debt shrinks, and the
 * receiver has less still coming to them. So
 *
 *     outstanding = net + paid - received
 *
 * A player who lost $50 and has paid $20 sits at -$30: still $30 short.
 * The winner they paid drops from +$50 to +$30 for the same reason.
 *
 * Outstanding amounts sum to zero exactly when the sessions do, because every
 * payment adds to one player and subtracts the same from another.
 *
 * A write-off moves balances the way a payment would, but no money changed
 * hands, so it is kept out of `paid` and `received`:
 *
 *     outstanding = net + paid - received + writtenOff
 *
 * Removed players are left out unless `includeRemoved` is set, which is how
 * the Payments page finds someone removed while still owing money.
 *
 * Sorted with the biggest creditor first, matching the leaderboard.
 */
export function computeBalances(
  ledger: Ledger,
  { includeRemoved = false }: { includeRemoved?: boolean } = {},
): Balance[] {
  const totals = new Map<ID, Balance>();

  for (const player of includeRemoved ? ledger.players : activePlayers(ledger)) {
    totals.set(player.id, { player, net: 0, paid: 0, received: 0, writtenOff: 0, outstanding: 0 });
  }

  for (const session of activeSessions(ledger)) {
    for (const entry of session.entries) {
      if (!isLive(entry)) continue;
      const row = totals.get(entry.playerId);
      if (row) row.net += entryNet(entry);
    }
  }

  for (const payment of activePayments(ledger)) {
    // A payment involving a removed player still moved real money, but there
    // is no row to attribute it to, so it is skipped on that side only.
    const from = totals.get(payment.from);
    const to = totals.get(payment.to);
    if (payment.writeOff) {
      if (from) from.writtenOff += payment.amount;
      if (to) to.writtenOff -= payment.amount;
    } else {
      if (from) from.paid += payment.amount;
      if (to) to.received += payment.amount;
    }
  }

  for (const row of totals.values()) {
    row.outstanding = row.net + row.paid - row.received + row.writtenOff;
  }

  return [...totals.values()].sort(
    (a, b) => b.outstanding - a.outstanding || a.player.name.localeCompare(b.player.name),
  );
}

/**
 * Players removed while they still owed or were owed money.
 *
 * Their balance drops out of everyone's totals with them, so the books stop
 * adding up. Listing them separately is what lets the Payments page say so,
 * instead of blaming a session that balances perfectly well.
 */
export function removedBalances(ledger: Ledger): Balance[] {
  return computeBalances(ledger, { includeRemoved: true }).filter(
    (b) => b.player.deleted && b.outstanding !== 0,
  );
}

/** Total handed over across the group, for the summary line. Write-offs aren't money. */
export function totalPaid(ledger: Ledger): number {
  return realPayments(ledger).reduce((sum, p) => sum + p.amount, 0);
}
