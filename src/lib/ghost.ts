import { seasonScopes } from './seasons';
import { activePayments, computeBalances } from './stats';
import type { Balance, ID, Ledger, Payment, Season } from './types';

/**
 * Ghosting: someone stops turning up without settling, so their balance is
 * written off and the rest of the group can square up without them.
 *
 * Nothing is deleted. The write-off is a set of payments marked as such (see
 * `Payment.writeOff`), so unghosting is just retiring them again.
 */

/** One person's part in a write-off. */
export interface WriteOffShare {
  /** Their balance before the write-off. */
  balance: Balance;
  /** How much of it they take on, in cents. Always positive. */
  amount: number;
}

export interface WriteOffPlan {
  /** The ghosted player's balance before: negative if they owe, positive if they're owed. */
  target: Balance;
  /** Who takes it on, biggest share first. */
  shares: WriteOffShare[];
  /** What couldn't be placed because the books don't balance. It stays on their balance. */
  unplaced: number;
}

/**
 * Work out who absorbs a ghosted player's balance.
 *
 * A debt is split between the people who are owed money, in proportion to how
 * much each is owed — they're the ones who were never going to be paid it. A
 * ghost who was owed money is the mirror image: the people who owe money keep
 * that much of it, in proportion to what each owes.
 *
 * This goes by what everyone is owed overall rather than by who was at the
 * table the nights the ghost played: the same pooling the settle-up plan uses,
 * where nobody's debt is to anyone in particular. Players who are ghosted or
 * removed themselves take no share.
 *
 * Works for a removed player too, which is how a balance left behind by a
 * removal gets written off.
 */
export function planWriteOff(ledger: Ledger, playerId: ID): WriteOffPlan | null {
  const balances = computeBalances(ledger, { includeRemoved: true });
  const target = balances.find((b) => b.player.id === playerId);
  if (!target) return null;

  const owed = target.outstanding;
  const takers =
    owed === 0
      ? []
      : balances.filter(
          (b) =>
            b.player.id !== playerId &&
            !b.player.deleted &&
            !b.player.ghostedAt &&
            Math.sign(b.outstanding) === -Math.sign(owed),
        );

  const weights = takers.map((b) => Math.abs(b.outstanding));
  const room = weights.reduce((sum, w) => sum + w, 0);
  // Only short of the full amount when the books are already out.
  const placed = Math.min(Math.abs(owed), room);
  const amounts = apportion(placed, weights);

  const shares = takers
    .map((balance, i) => ({ balance, amount: amounts[i] }))
    .filter((s) => s.amount > 0)
    .sort(
      (a, b) => b.amount - a.amount || a.balance.player.name.localeCompare(b.balance.player.name),
    );

  return { target, shares, unplaced: Math.abs(owed) - placed };
}

/** One season's part of a ghosting. */
export interface SeasonWriteOff {
  /** Null before the group has seasons. */
  season: Season | null;
  plan: WriteOffPlan;
}

/**
 * Everything a ghosting writes off, season by season.
 *
 * Debts never carry from one season into the next, so each season's balance
 * is written off within that season, split between the people involved in it.
 * Seasons where they're square are left out: empty means nothing to write off.
 */
export function planGhosting(ledger: Ledger, playerId: ID): SeasonWriteOff[] {
  return seasonScopes(ledger)
    .map(({ season, ledger: scoped }) => ({ season, plan: planWriteOff(scoped, playerId) }))
    .filter((s): s is SeasonWriteOff => s.plan !== null && s.plan.target.outstanding !== 0);
}

/**
 * Split `total` cents in proportion to `weights`, to the cent.
 *
 * The parts always add back up to exactly `total`: each gets its share rounded
 * down, and the cents left over go to the largest remainders (ties to the
 * bigger weight, then list order, so the same input always splits the same
 * way). While `total` is no more than the weights' sum, no part ever exceeds
 * its own weight — nobody is handed more of a debt than they were owed.
 */
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (!(total > 0) || !(sum > 0)) return weights.map(() => 0);

  // Integer maths throughout: total * w stays far inside exact range for cents.
  const parts = weights.map((w, i) => ({
    i,
    w,
    amount: Math.floor((total * w) / sum),
    rem: (total * w) % sum,
  }));

  let left = total - parts.reduce((s, p) => s + p.amount, 0);
  const order = [...parts].sort((a, b) => b.rem - a.rem || b.w - a.w || a.i - b.i);
  for (const p of order) {
    if (left <= 0) break;
    p.amount += 1;
    left -= 1;
  }

  return parts.map((p) => p.amount);
}

/** One ghosting's write-off in one season, gathered back up from the payments that carry it. */
export interface WriteOffRecord {
  /** The ghosted player. */
  player: ID;
  /** Matches their `ghostedAt`. */
  at: number;
  /** The season it was written off in, when the group has seasons. */
  season?: ID;
  date: string;
  /** Everything written off, in cents. */
  total: number;
  /** True when it was a debt they owed; false when it was money they were owed. */
  debt: boolean;
  /** Each person's share, as the payment carrying it. */
  parts: Payment[];
}

/** Group write-off payments back into one record per ghosting per season, for display and undo. */
export function writeOffRecords(payments: Payment[]): WriteOffRecord[] {
  const byKey = new Map<string, WriteOffRecord>();
  for (const p of payments) {
    if (!p.writeOff) continue;
    const key = `${p.writeOff.player}:${p.writeOff.at}:${p.season ?? ''}`;
    let record = byKey.get(key);
    if (!record) {
      record = {
        player: p.writeOff.player,
        at: p.writeOff.at,
        season: p.season,
        date: p.date,
        total: 0,
        debt: p.from === p.writeOff.player,
        parts: [],
      };
      byKey.set(key, record);
    }
    record.total += p.amount;
    record.parts.push(p);
  }
  return [...byKey.values()];
}

/** The write-offs standing for a player right now, one per season. Empty when there are none. */
export function standingWriteOffs(ledger: Ledger, playerId: ID): WriteOffRecord[] {
  const mine = activePayments(ledger).filter((p) => p.writeOff?.player === playerId);
  return writeOffRecords(mine);
}

/** Who a share of a write-off belongs to: whichever side of it isn't the ghost. */
export function sharer(part: Payment): ID {
  return part.writeOff && part.from === part.writeOff.player ? part.to : part.from;
}
