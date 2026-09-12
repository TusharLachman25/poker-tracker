import type { ID, Transfer } from './types';

/**
 * Turn a set of net positions into a short list of payments.
 *
 * Repeatedly matches the biggest debtor against the biggest creditor. Each
 * pass zeroes out at least one person, so this lands in at most n-1 transfers
 * — far fewer than everyone-pays-everyone, and in practice usually optimal.
 * (Finding the true minimum is NP-hard; this is the standard greedy answer.)
 *
 * If the nets don't sum to zero — which happens when a session's cash-outs
 * don't match its buy-ins — the leftover is reported rather than smeared
 * silently across the payments.
 */
export function settle(nets: Map<ID, number>): { transfers: Transfer[]; leftover: number } {
  const creditors: { id: ID; amount: number }[] = [];
  const debtors: { id: ID; amount: number }[] = [];

  for (const [id, net] of nets) {
    if (net > 0) creditors.push({ id, amount: net });
    else if (net < 0) debtors.push({ id, amount: -net });
  }

  // Biggest first: settling large positions early leaves fewer stragglers.
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

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
