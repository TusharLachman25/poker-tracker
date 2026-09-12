import type { ID, Transfer } from './types';

/**
 * Above this many people with a non-zero balance, fall back to the greedy
 * pass. The exact search costs 3^n, which is instant at 14 (~5M steps) and
 * unpleasant beyond it. A home game never gets close.
 */
const EXACT_LIMIT = 14;

/**
 * Turn a set of net positions into the shortest list of payments.
 *
 * Balances are netted first, so nobody pays and receives on the same night:
 * if Kabir owes Tushar $10 and Sid $10, and Sid owes Tushar $3, this settles
 * it as Kabir paying Tushar $13 and Sid $7 — two payments instead of three.
 *
 * The minimum is found by splitting everyone into the largest possible number
 * of groups that each sum to zero. A group of k people always needs exactly
 * k-1 payments, so more groups means fewer payments, and n - groups is
 * provably the fewest possible. That search is exponential (the problem is
 * NP-hard in general), so past `EXACT_LIMIT` people this falls back to
 * repeatedly matching the biggest debtor against the biggest creditor, which
 * lands at n-1 and is usually the same answer.
 *
 * If the nets don't sum to zero — which happens when a session's cash-outs
 * don't match its buy-ins — the shortfall is reported rather than smeared
 * silently across the payments.
 */
export function settle(nets: Map<ID, number>): { transfers: Transfer[]; leftover: number } {
  const people = [...nets.entries()].filter(([, net]) => net !== 0);
  const total = people.reduce((sum, [, net]) => sum + net, 0);

  // Only a balanced book can be partitioned into zero-sum groups.
  if (total === 0 && people.length > 0 && people.length <= EXACT_LIMIT) {
    return { transfers: minimalTransfers(people), leftover: 0 };
  }

  return greedy(people);
}

/**
 * Biggest debtor against biggest creditor, repeatedly. Each pass zeroes out at
 * least one person, so this lands at no more than n-1 payments.
 */
function greedy(people: [ID, number][]): { transfers: Transfer[]; leftover: number } {
  const creditors = people.filter(([, n]) => n > 0).map(([id, n]) => ({ id, amount: n }));
  const debtors = people.filter(([, n]) => n < 0).map(([id, n]) => ({ id, amount: -n }));

  creditors.sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
  debtors.sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));

  const transfers: Transfer[] = [];
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const credit = creditors[ci];
    const debt = debtors[di];
    const amount = Math.min(credit.amount, debt.amount);

    if (amount > 0) {
      transfers.push({ from: debt.id, to: credit.id, amount });
      credit.amount -= amount;
      debt.amount -= amount;
    }

    if (credit.amount === 0) ci++;
    if (debt.amount === 0) di++;
  }

  const unpaidCredit = creditors.slice(ci).reduce((sum, c) => sum + c.amount, 0);
  const unpaidDebt = debtors.slice(di).reduce((sum, d) => sum + d.amount, 0);

  return { transfers, leftover: unpaidCredit - unpaidDebt };
}

/**
 * Split everyone into as many zero-sum groups as possible, then settle each
 * group on its own. The result is the provable minimum number of payments.
 */
function minimalTransfers(people: [ID, number][]): Transfer[] {
  const n = people.length;
  const full = (1 << n) - 1;

  // Sum of every subset, built up one bit at a time.
  const sums = new Float64Array(1 << n);
  for (let mask = 1; mask <= full; mask++) {
    const low = mask & -mask;
    const index = Math.log2(low);
    sums[mask] = sums[mask ^ low] + people[index][1];
  }

  // groups[mask]: most zero-sum groups `mask` can be split into, or -1 if it
  // cannot be split cleanly at all. pick[mask]: the group chosen to get there.
  const groups = new Int16Array(1 << n).fill(-1);
  const pick = new Int32Array(1 << n);
  groups[0] = 0;

  for (let mask = 1; mask <= full; mask++) {
    const low = mask & -mask;
    // Every subset considered contains the lowest bit, so each partition is
    // reached exactly once rather than in every possible order.
    for (let sub = mask; sub > 0; sub = (sub - 1) & mask) {
      if ((sub & low) === 0) continue;
      if (sums[sub] !== 0) continue;
      const rest = groups[mask ^ sub];
      if (rest < 0) continue;
      if (rest + 1 > groups[mask]) {
        groups[mask] = rest + 1;
        pick[mask] = sub;
      }
    }
  }

  // A balanced book always splits at least into the single group of everyone.
  if (groups[full] < 0) return greedy(people).transfers;

  const transfers: Transfer[] = [];
  for (let mask = full; mask > 0; ) {
    const group = pick[mask];
    const members: [ID, number][] = [];
    for (let i = 0; i < n; i++) {
      if (group & (1 << i)) members.push(people[i]);
    }
    transfers.push(...greedy(members).transfers);
    mask ^= group;
  }

  return transfers;
}
