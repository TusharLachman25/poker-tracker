import { describe, expect, it } from 'vitest';
import { money, parseMoney, signedMoney, toInput } from '../money';
import { niceStep } from '../../components/ProfitChart';
import { computeBalances, computeStats, sessionTotals } from '../stats';
import { settle } from '../settle';
import { NOTABLE, describeSession, diffSession, entry } from '../activity';
import { MIN_PASSWORD, configFor, groupId, validateGroup } from '../sync';
import type { Ledger, Session } from '../types';
import { mergeLedgers } from '../merge';

const player = (id: string, name: string) => ({
  id, name, color: '#fff', updatedAt: 1,
});

function ledgerOf(sessions: Session[]): Ledger {
  return {
    players: [player('a', 'Ana'), player('b', 'Ben'), player('c', 'Cy')],
    sessions,
    payments: [],
    activity: [],
    settings: {
      currency: 'AUD',
      groupName: 'Test',
      defaultBuyIn: 1000,
      defaultStakes: '0.05/0.10',
      updatedAt: 0,
    },
  };
}

const session = (id: string, date: string, entries: Session['entries'], extra: Partial<Session> = {}): Session => ({
  id, date, gameType: 'nlh', entries, updatedAt: 1, ...extra,
});

describe('parseMoney', () => {
  it('parses plain and decorated input into cents', () => {
    expect(parseMoney('12.50')).toBe(1250);
    expect(parseMoney('$1,200')).toBe(120000);
    expect(parseMoney('-40')).toBe(-4000);
    expect(parseMoney('')).toBe(0);
    expect(parseMoney('abc')).toBe(0);
  });

  it('rounds rather than truncating', () => {
    expect(parseMoney('0.005')).toBe(1);
    expect(parseMoney('19.99')).toBe(1999);
  });

  it('preserves value through a parse -> input -> parse round-trip', () => {
    for (const raw of ['12.50', '100', '0.01', '-37.25']) {
      const cents = parseMoney(raw);
      expect(parseMoney(toInput(cents))).toBe(cents);
    }
    expect(toInput(0)).toBe(''); // a zero renders as an empty field, not "0"
  });
});

describe('signedMoney', () => {
  it('marks direction and leaves zero bare', () => {
    expect(signedMoney(2500, 'USD')).toBe('+$25');
    expect(signedMoney(-2500, 'USD')).toBe('-$25');
    expect(signedMoney(0, 'USD')).toBe('$0');
  });
});

describe('sessionTotals', () => {
  it('flags a table where the chips do not balance', () => {
    const s = session('s1', '2026-01-01', [
      { playerId: 'a', buyIn: 10000, cashOut: 25000 },
      { playerId: 'b', buyIn: 10000, cashOut: 0 },
    ]);
    const t = sessionTotals(s);
    expect(t.buyIn).toBe(20000);
    expect(t.cashOut).toBe(25000);
    expect(t.discrepancy).toBe(5000);
    expect(t.balanced).toBe(false);
  });

  it('ignores rows where no money moved', () => {
    const s = session('s1', '2026-01-01', [
      { playerId: 'a', buyIn: 10000, cashOut: 10000 },
      { playerId: 'c', buyIn: 0, cashOut: 0 },
    ]);
    expect(sessionTotals(s).players).toBe(1);
    expect(sessionTotals(s).balanced).toBe(true);
  });
});

describe('computeStats', () => {
  const ledger = ledgerOf([
    session('s1', '2026-01-01', [
      { playerId: 'a', buyIn: 10000, cashOut: 25000 },
      { playerId: 'b', buyIn: 10000, cashOut: 0 },
      { playerId: 'c', buyIn: 10000, cashOut: 5000 },
    ], { durationMins: 120 }),
    session('s2', '2026-01-08', [
      { playerId: 'a', buyIn: 10000, cashOut: 5000 },
      { playerId: 'b', buyIn: 10000, cashOut: 15000 },
    ], { durationMins: 60 }),
  ]);

  const stats = computeStats(ledger);
  const byName = (n: string) => stats.find((s) => s.player.name === n)!;

  it('ranks by net, biggest winner first', () => {
    expect(stats.map((s) => s.player.name)).toEqual(['Ana', 'Ben', 'Cy']);
  });

  it('sums net across sessions', () => {
    expect(byName('Ana').net).toBe(10000);   // +150 then -50
    expect(byName('Ben').net).toBe(-5000);   // -100 then +50
    expect(byName('Cy').net).toBe(-5000);    // -50, one session
  });

  it('counts only sessions the player actually played', () => {
    expect(byName('Ana').sessions).toBe(2);
    expect(byName('Cy').sessions).toBe(1);
  });

  it('tracks wins, losses and extremes', () => {
    expect(byName('Ana').wins).toBe(1);
    expect(byName('Ana').losses).toBe(1);
    expect(byName('Ana').biggestWin).toBe(15000);
    expect(byName('Ana').biggestLoss).toBe(-5000);
  });

  it('computes ROI against money staked', () => {
    expect(byName('Ana').roi).toBeCloseTo(10000 / 20000);
    expect(byName('Cy').roi).toBeCloseTo(-5000 / 10000);
  });

  it('computes hourly rate from recorded durations only', () => {
    // Ben: -50 over 3 hours
    expect(byName('Ben').hourly).toBe(Math.round(-5000 / 3));
    expect(byName('Ben').minutesPlayed).toBe(180);
  });

  it('builds a cumulative series that ends at the net', () => {
    const c = byName('Ana').cumulative;
    expect(c.map((p) => p.total)).toEqual([15000, 10000]);
  });

  it('reports the current streak with a sign', () => {
    expect(byName('Ana').streak).toBe(-1); // last session was a loss
    expect(byName('Ben').streak).toBe(1);  // last session was a win
  });

  it('is zero-sum when every table balanced', () => {
    const total = stats.reduce((sum, s) => sum + s.net, 0);
    expect(total).toBe(0);
  });
});

describe('settle', () => {
  it('clears everyone with at most n-1 payments', () => {
    const nets = new Map([['a', 10000], ['b', -5000], ['c', -5000]]);
    const { transfers, leftover } = settle(nets);
    expect(leftover).toBe(0);
    expect(transfers.length).toBeLessThanOrEqual(2);

    const settled = new Map([...nets].map(([id]) => [id, 0]));
    for (const t of transfers) {
      settled.set(t.from, settled.get(t.from)! - t.amount);
      settled.set(t.to, settled.get(t.to)! + t.amount);
    }
    expect([...settled.entries()]).toEqual([...nets.entries()]);
  });

  it('never invents a payment from a winner', () => {
    const nets = new Map([['a', 7500], ['b', 2500], ['c', -10000]]);
    const { transfers } = settle(nets);
    expect(transfers.every((t) => t.from === 'c')).toBe(true);
    expect(transfers.reduce((s, t) => s + t.amount, 0)).toBe(10000);
  });

  it('reports leftover instead of hiding an unbalanced table', () => {
    const nets = new Map([['a', 10000], ['b', -4000]]);
    const { transfers, leftover } = settle(nets);
    expect(transfers.reduce((s, t) => s + t.amount, 0)).toBe(4000);
    expect(leftover).toBe(6000);
  });

  it('handles an all-square night', () => {
    const { transfers, leftover } = settle(new Map([['a', 0], ['b', 0]]));
    expect(transfers).toEqual([]);
    expect(leftover).toBe(0);
  });
});

describe('money at micro stakes', () => {
  it('keeps cents exact through a $10 buy-in game', () => {
    // 0.05/0.10 blinds: a night's swing is a few dollars and change.
    expect(parseMoney('10')).toBe(1000);
    expect(parseMoney('0.10')).toBe(10);
    expect(parseMoney('12.35')).toBe(1235);
    expect(signedMoney(1235 - 1000, 'USD')).toBe('+$2.35');
    expect(signedMoney(-235, 'USD')).toBe('-$2.35');
  });

  it('sums a rebuy-heavy night without drift', () => {
    // Three players, $10 buy-ins with rebuys, cents in the cash-outs.
    const s = session('s1', '2026-01-01', [
      { playerId: 'a', buyIn: 3000, cashOut: 4265 }, // 3 bullets
      { playerId: 'b', buyIn: 2000, cashOut: 515 },  // 2 bullets
      { playerId: 'c', buyIn: 1000, cashOut: 1220 },
    ]);
    const t = sessionTotals(s);
    expect(t.buyIn).toBe(6000);
    expect(t.cashOut).toBe(6000);
    expect(t.balanced).toBe(true);

    const stats = computeStats(ledgerOf([s]));
    expect(stats.reduce((sum, x) => sum + x.net, 0)).toBe(0);
    expect(stats.find((x) => x.player.name === 'Ana')!.net).toBe(1265);
  });
});

describe('money never shows a single decimal', () => {
  it('renders whole amounts bare and part-amounts with both digits', () => {
    expect(signedMoney(1350, 'USD')).toBe('+$13.50');  // not "+$13.5"
    expect(signedMoney(1300, 'USD')).toBe('+$13');
    expect(signedMoney(-350, 'USD')).toBe('-$3.50');
    expect(signedMoney(-10, 'USD')).toBe('-$0.10');
    expect(signedMoney(1305, 'USD')).toBe('+$13.05');
  });
});

describe('chart axis steps', () => {
  it('never renders negative zero as "-$0"', () => {
    expect(money(-0, 'USD')).toBe('$0');
    expect(money(0, 'USD')).toBe('$0');
    expect(signedMoney(-0, 'USD')).toBe('$0');
  });

  it('picks a step that yields a useful number of gridlines', () => {
    // A $10-buy-in season: roughly an $18 swing should not collapse to
    // two gridlines.
    for (const span of [500, 1840, 4205, 25_000, 120_000]) {
      const step = niceStep(span);
      const intervals = span / step;
      expect(intervals).toBeGreaterThanOrEqual(2);
      expect(intervals).toBeLessThanOrEqual(10);
    }
  });

  it('keeps steps on the 1/2/5 progression and never below a cent', () => {
    expect(niceStep(1)).toBe(1);
    for (const span of [7, 60, 1840, 4205, 99_999]) {
      const step = niceStep(span);
      const mantissa = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5]).toContain(Math.round(mantissa));
    }
  });
});

describe('group name and password', () => {
  it('forgives case, spacing and punctuation when joining', () => {
    const canonical = groupId('Friday Night Crew');
    expect(canonical).toBe('friday-night-crew');
    for (const typed of [
      'friday night crew',
      '  Friday Night Crew  ',
      'FRIDAY NIGHT CREW',
      'Friday-Night Crew!',
      'Friday   Night   Crew',
    ]) {
      expect(groupId(typed)).toBe(canonical);
    }
  });

  it('strips accents so the name is typeable on any keyboard', () => {
    expect(groupId('José’s Game')).toBe(groupId("Jose's Game"));
  });

  it('keeps different groups apart', () => {
    expect(groupId('Friday Crew')).not.toBe(groupId('Saturday Crew'));
  });

  it('rejects names that carry no letters or digits', () => {
    expect(groupId('!!!')).toBe('');
    expect(validateGroup('!!!', 'longenough')).toBeTruthy();
  });

  it('requires a password the server will accept', () => {
    expect(validateGroup('Friday Night Crew', 'short')).toContain(String(MIN_PASSWORD));
    expect(validateGroup('', 'longenough')).toBeTruthy();
    expect(validateGroup('Friday Night Crew', 'longenough')).toBeNull();
  });

  it('builds a config both sides of the group agree on', () => {
    const project = { url: 'https://x.supabase.co', anonKey: 'key' };
    const mine = configFor(project, 'Friday Night Crew', 'aces-high-99');
    const theirs = configFor(project, 'friday night crew', 'aces-high-99');
    expect(theirs.ledgerId).toBe(mine.ledgerId);
    expect(theirs.secret).toBe(mine.secret);
    // The display name lives in the ledger, not the connection config — there
    // is only ever one name for the group.
    expect('groupName' in mine).toBe(false);
  });
});

describe('outstanding balances', () => {
  const night = session('s1', '2026-01-01', [
    { playerId: 'a', buyIn: 10000, cashOut: 25000 }, // Ana +150
    { playerId: 'b', buyIn: 10000, cashOut: 0 },     // Ben -100
    { playerId: 'c', buyIn: 10000, cashOut: 5000 },  // Cy  -50
  ]);

  const pay = (id: string, from: string, to: string, amount: number) => ({
    id, from, to, amount, date: '2026-01-02', updatedAt: 1,
  });

  const withPayments = (payments: ReturnType<typeof pay>[]) => ({
    ...ledgerOf([night]),
    payments,
  });

  const find = (rows: ReturnType<typeof computeBalances>, name: string) =>
    rows.find((r) => r.player.name === name)!;

  it('starts equal to the session nets when nobody has paid', () => {
    const rows = computeBalances(withPayments([]));
    expect(find(rows, 'Ana').outstanding).toBe(15000);
    expect(find(rows, 'Ben').outstanding).toBe(-10000);
    expect(find(rows, 'Cy').outstanding).toBe(-5000);
  });

  it('subtracts a payment from both sides', () => {
    const rows = computeBalances(withPayments([pay('p1', 'b', 'a', 10000)]));
    expect(find(rows, 'Ben').outstanding).toBe(0);      // paid in full
    expect(find(rows, 'Ana').outstanding).toBe(5000);   // only Cy left to collect
    expect(find(rows, 'Cy').outstanding).toBe(-5000);   // untouched
  });

  it('handles a partial payment', () => {
    const rows = computeBalances(withPayments([pay('p1', 'b', 'a', 4000)]));
    expect(find(rows, 'Ben').outstanding).toBe(-6000);  // still $60 short
    expect(find(rows, 'Ana').outstanding).toBe(11000);
    expect(find(rows, 'Ben').paid).toBe(4000);
    expect(find(rows, 'Ana').received).toBe(4000);
  });

  it('clears everyone once every debt is paid', () => {
    const rows = computeBalances(
      withPayments([pay('p1', 'b', 'a', 10000), pay('p2', 'c', 'a', 5000)]),
    );
    for (const row of rows) expect(row.outstanding).toBe(0);
    expect(settle(new Map(rows.map((r) => [r.player.id, r.outstanding]))).transfers).toEqual([]);
  });

  it('stays zero-sum no matter how much is paid', () => {
    for (const payments of [
      [],
      [pay('p1', 'b', 'a', 3000)],
      [pay('p1', 'b', 'a', 10000), pay('p2', 'c', 'a', 2500)],
      [pay('p1', 'b', 'a', 20000)], // deliberate overpayment
    ]) {
      const rows = computeBalances(withPayments(payments));
      expect(rows.reduce((sum, r) => sum + r.outstanding, 0)).toBe(0);
    }
  });

  it('lets an overpayment flip who is owed', () => {
    const rows = computeBalances(withPayments([pay('p1', 'b', 'a', 15000)]));
    expect(find(rows, 'Ben').outstanding).toBe(5000);   // paid $50 too much
    expect(find(rows, 'Ana').outstanding).toBe(0);
  });

  it('ignores deleted payments', () => {
    const rows = computeBalances({
      ...ledgerOf([night]),
      payments: [{ ...pay('p1', 'b', 'a', 10000), deleted: true }],
    });
    expect(find(rows, 'Ben').outstanding).toBe(-10000);
  });

  it('feeds a settle-up plan that reflects what is already paid', () => {
    const rows = computeBalances(withPayments([pay('p1', 'b', 'a', 10000)]));
    const { transfers } = settle(new Map(rows.map((r) => [r.player.id, r.outstanding])));
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toEqual({ from: 'c', to: 'a', amount: 5000 });
  });
});

describe('activity log', () => {
  const players = [player('a', 'Ana'), player('b', 'Ben'), player('c', 'Cy')];

  it('spells out which numbers moved when a session is edited', () => {
    const before = session('s1', '2026-01-01', [
      { playerId: 'a', buyIn: 1000, cashOut: 2000 }, // +$10
      { playerId: 'b', buyIn: 1000, cashOut: 0 },    // -$10
    ]);
    const after = session('s1', '2026-01-01', [
      { playerId: 'a', buyIn: 1000, cashOut: 500 },  // now -$5
      { playerId: 'b', buyIn: 1000, cashOut: 1500 }, // now +$5
    ]);

    const detail = diffSession(before, after, players, 'USD')!;
    expect(detail).toContain('Ana: +$10 → -$5');
    expect(detail).toContain('Ben: -$10 → +$5');
  });

  it('reports a player being added to or dropped from a session', () => {
    const before = session('s1', '2026-01-01', [{ playerId: 'a', buyIn: 1000, cashOut: 2000 }]);
    const withCy = session('s1', '2026-01-01', [
      { playerId: 'a', buyIn: 1000, cashOut: 2000 },
      { playerId: 'c', buyIn: 1000, cashOut: 0 },
    ]);

    expect(diffSession(before, withCy, players, 'USD')).toContain('Cy added at -$10');
    expect(diffSession(withCy, before, players, 'USD')).toContain('Cy removed (was -$10)');
  });

  it('notices the date being moved', () => {
    const before = session('s1', '2026-01-01', [{ playerId: 'a', buyIn: 1000, cashOut: 2000 }]);
    const after = { ...before, date: '2026-02-09' };
    expect(diffSession(before, after, players, 'USD')).toContain('2026-01-01 → 2026-02-09');
  });

  it('says nothing when an edit changed no numbers', () => {
    const s = session('s1', '2026-01-01', [{ playerId: 'a', buyIn: 1000, cashOut: 2000 }]);
    expect(diffSession(s, { ...s, location: 'somewhere new' }, players, 'USD')).toBeUndefined();
  });

  it('describes a session the way a person would recognise it', () => {
    const s = session('s1', '2026-01-01', [
      { playerId: 'a', buyIn: 1000, cashOut: 2000 },
      { playerId: 'b', buyIn: 1000, cashOut: 0 },
    ]);
    const text = describeSession(s, 'USD');
    expect(text).toContain('2 players');
    expect(text).toContain('$20 in play');
  });

  it('flags edits and deletions as the entries worth scrutinising', () => {
    expect(NOTABLE.has('session.update')).toBe(true);
    expect(NOTABLE.has('session.delete')).toBe(true);
    expect(NOTABLE.has('ledger.erase')).toBe(true);
    expect(NOTABLE.has('session.create')).toBe(false);
  });

  it('stamps every entry with an actor and a time', () => {
    const e = entry({ id: 'a', name: 'Ana' }, 'session.delete', 'a session');
    expect(e.actorName).toBe('Ana');
    expect(e.actorId).toBe('a');
    expect(e.at).toBeGreaterThan(0);
    expect(e.id).toBeTruthy();
  });
});

describe('settings survive a sync', () => {
  const base = (patch: Partial<Ledger['settings']>, updatedAt: number): Ledger => ({
    players: [],
    sessions: [],
    payments: [],
    activity: [],
    settings: {
      currency: 'USD',
      groupName: 'Friday Night Crew',
      defaultBuyIn: 1000,
      defaultStakes: '0.05/0.10',
      updatedAt,
      ...patch,
    },
  });

  it('keeps a change made here over the older copy on the server', () => {
    // The reported bug: switch to AUD, and a sync a few seconds later pulls
    // the server's stale USD back over it.
    const mine = base({ currency: 'AUD' }, 2000);
    const theirs = base({ currency: 'USD' }, 1000);
    expect(mergeLedgers(mine, theirs).settings.currency).toBe('AUD');
  });

  it('adopts the group settings when the server is the newer one', () => {
    const mine = base({ currency: 'USD' }, 1000);
    const theirs = base({ currency: 'AUD' }, 2000);
    expect(mergeLedgers(mine, theirs).settings.currency).toBe('AUD');
  });

  it('adopts the group settings when joining with untouched defaults', () => {
    // A fresh device has never edited its settings, so updatedAt is 0.
    const mine = base({ currency: 'AUD' }, 0);
    const theirs = base({ currency: 'GBP', groupName: 'Other Crew' }, 5);
    const merged = mergeLedgers(mine, theirs).settings;
    expect(merged.currency).toBe('GBP');
    expect(merged.groupName).toBe('Other Crew');
  });

  it('carries the buy-in and stakes with it, not just the currency', () => {
    const mine = base({ defaultBuyIn: 2000, defaultStakes: '0.10/0.20' }, 2000);
    const theirs = base({ defaultBuyIn: 1000, defaultStakes: '0.05/0.10' }, 1000);
    const merged = mergeLedgers(mine, theirs).settings;
    expect(merged.defaultBuyIn).toBe(2000);
    expect(merged.defaultStakes).toBe('0.10/0.20');
  });

  it('is stable when the same ledger syncs twice', () => {
    const mine = base({ currency: 'AUD' }, 2000);
    const theirs = base({ currency: 'USD' }, 1000);
    const once = mergeLedgers(mine, theirs);
    const twice = mergeLedgers(once, theirs);
    expect(twice.settings.currency).toBe('AUD');
  });
});

describe('settling in as few payments as possible', () => {
  /** Replays the plan and checks everyone ends exactly where they should. */
  const clears = (nets: Map<string, number>, transfers: ReturnType<typeof settle>['transfers']) => {
    const moved = new Map([...nets.keys()].map((id) => [id, 0]));
    for (const t of transfers) {
      moved.set(t.from, moved.get(t.from)! - t.amount);
      moved.set(t.to, moved.get(t.to)! + t.amount);
    }
    return [...nets.entries()].every(([id, net]) => moved.get(id) === net);
  };

  it('nets a chain of debts down to one payer', () => {
    // Kabir owes Tushar $10 and Sid $10; Sid owes Tushar $3.
    // Expected: Kabir pays Tushar $13 and Sid $7 — not three payments.
    const nets = new Map([['kabir', -2000], ['sid', 700], ['tushar', 1300]]);
    const { transfers, leftover } = settle(nets);

    expect(leftover).toBe(0);
    expect(transfers).toHaveLength(2);
    expect(clears(nets, transfers)).toBe(true);
    expect(transfers.every((t) => t.from === 'kabir')).toBe(true);
    expect(transfers.find((t) => t.to === 'tushar')?.amount).toBe(1300);
    expect(transfers.find((t) => t.to === 'sid')?.amount).toBe(700);
  });

  it('never makes anyone both pay and get paid', () => {
    const nets = new Map([['a', -2000], ['b', 700], ['c', 1300], ['d', -500], ['e', 500]]);
    const { transfers } = settle(nets);
    for (const id of nets.keys()) {
      const pays = transfers.some((t) => t.from === id);
      const receives = transfers.some((t) => t.to === id);
      expect(pays && receives).toBe(false);
    }
  });

  it('spots independent groups instead of chaining everyone together', () => {
    // {a,b} and {c,d} each square off on their own: two payments, not three.
    const nets = new Map([['a', 1000], ['b', -1000], ['c', 2500], ['d', -2500]]);
    const { transfers } = settle(nets);
    expect(transfers).toHaveLength(2);
    expect(clears(nets, transfers)).toBe(true);
  });

  it('beats the plain biggest-first approach when a subset cancels out', () => {
    // {b,c} cancel exactly, as do {a,d,e}. Best is 1 + 2 = 3 payments;
    // matching biggest-against-biggest would take 4.
    const nets = new Map([
      ['a', 1000],
      ['b', 600],
      ['c', -600],
      ['d', -400],
      ['e', -600],
    ]);
    const { transfers } = settle(nets);
    expect(transfers).toHaveLength(3);
    expect(clears(nets, transfers)).toBe(true);
  });

  it('always clears the books exactly, on any shape of table', () => {
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

    for (let round = 0; round < 200; round++) {
      const count = 2 + Math.floor(random() * 7);
      const nets = new Map<string, number>();
      let running = 0;
      for (let i = 0; i < count - 1; i++) {
        const amount = Math.round((random() - 0.5) * 10000);
        nets.set(`p${i}`, amount);
        running += amount;
      }
      nets.set(`p${count - 1}`, -running); // forces the table to balance

      const { transfers, leftover } = settle(nets);
      const live = [...nets.values()].filter((v) => v !== 0).length;

      expect(leftover).toBe(0);
      expect(clears(nets, transfers)).toBe(true);
      expect(transfers.length).toBeLessThanOrEqual(Math.max(live - 1, 0));
      expect(transfers.every((t) => t.amount > 0)).toBe(true);
    }
  });

  it('still reports a shortfall when the books do not balance', () => {
    const { transfers, leftover } = settle(new Map([['a', 10000], ['b', -4000]]));
    expect(transfers.reduce((s, t) => s + t.amount, 0)).toBe(4000);
    expect(leftover).toBe(6000);
  });

  it('handles an all-square night', () => {
    expect(settle(new Map([['a', 0], ['b', 0]])).transfers).toEqual([]);
    expect(settle(new Map()).transfers).toEqual([]);
  });
});
