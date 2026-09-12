import { describe, expect, it } from 'vitest';
import { money, parseMoney, signedMoney, toInput } from '../money';
import { niceStep } from '../../components/ProfitChart';
import { computeStats, sessionTotals } from '../stats';
import { settle } from '../settle';
import { MIN_PASSWORD, configFor, groupId, validateGroup } from '../sync';
import type { Ledger, Session } from '../types';

const player = (id: string, name: string) => ({
  id, name, color: '#fff', updatedAt: 1,
});

function ledgerOf(sessions: Session[]): Ledger {
  return {
    players: [player('a', 'Ana'), player('b', 'Ben'), player('c', 'Cy')],
    sessions,
    settings: { currency: 'USD', groupName: 'Test', defaultBuyIn: 1000, defaultStakes: '0.05/0.10' },
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
    expect(mine.groupName).toBe('Friday Night Crew'); // display keeps their capitals
  });
});
