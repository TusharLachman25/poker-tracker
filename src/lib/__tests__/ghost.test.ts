import { beforeEach, describe, expect, it } from 'vitest';
import { apportion, planWriteOff, standingWriteOff, writeOffRecords } from '../ghost';
import { mergeLedgers } from '../merge';
import { settle } from '../settle';
import { computeBalances, removedBalances, totalPaid } from '../stats';
import { useStore } from '../store';
import type { Ledger, Payment, Player, Session } from '../types';

const player = (id: string, name: string, extra: Partial<Player> = {}): Player => ({
  id, name, color: '#fff', updatedAt: 1, ...extra,
});

const dollars = (n: number) => Math.round(n * 100);

/**
 * The night from the design discussion, all in one session:
 * Sam -$30, Sid -$20, Tushar +$30, Kabir +$20.
 */
const night: Session = {
  id: 's1',
  date: '2026-11-14',
  gameType: 'nlh',
  updatedAt: 1,
  entries: [
    { playerId: 'sam', buyIn: dollars(40), cashOut: dollars(10) },
    { playerId: 'sid', buyIn: dollars(30), cashOut: dollars(10) },
    { playerId: 'tushar', buyIn: dollars(10), cashOut: dollars(40) },
    { playerId: 'kabir', buyIn: dollars(10), cashOut: dollars(30) },
  ],
};

function ledgerOf(overrides: Partial<Ledger> = {}): Ledger {
  return {
    players: [
      player('sam', 'Sam'),
      player('sid', 'Sid'),
      player('tushar', 'Tushar'),
      player('kabir', 'Kabir'),
    ],
    sessions: [night],
    payments: [],
    activity: [],
    settings: {
      currency: 'AUD',
      groupName: 'Test',
      defaultBuyIn: 1000,
      defaultStakes: '0.05/0.10',
      updatedAt: 0,
    },
    ...overrides,
  };
}

const outstanding = (ledger: Ledger) =>
  Object.fromEntries(computeBalances(ledger).map((b) => [b.player.id, b.outstanding]));

const planOf = (ledger: Ledger) =>
  settle(new Map(computeBalances(ledger).map((b) => [b.player.id, b.outstanding])));

const shareMap = (ledger: Ledger, id: string) =>
  Object.fromEntries(planWriteOff(ledger, id)!.shares.map((s) => [s.balance.player.id, s.amount]));

describe('splitting an amount to the cent', () => {
  it('splits in proportion', () => {
    expect(apportion(3000, [3000, 2000])).toEqual([1800, 1200]);
  });

  it('always adds back up to exactly the total', () => {
    for (const [total, weights] of [
      [1000, [1, 1, 1]],
      [1, [5, 5]],
      [9999, [123, 456, 789, 1011]],
      [2500, [1, 2, 3, 4, 5, 6, 7]],
    ] as const) {
      const parts = apportion(total, [...weights]);
      expect(parts.reduce((s, p) => s + p, 0)).toBe(total);
    }
  });

  it('hands leftover cents to the largest remainders, the same way every time', () => {
    // $10 three ways: one person gets the extra cent, and always the same one.
    expect(apportion(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(apportion(1000, [1, 1, 1])).toEqual(apportion(1000, [1, 1, 1]));
  });

  it('never gives anyone more than their own weight', () => {
    const weights = [1, 1, 1, 7, 13, 2999];
    const total = weights.reduce((s, w) => s + w, 0);
    for (let t = 0; t <= total; t += 7) {
      apportion(t, weights).forEach((part, i) => expect(part).toBeLessThanOrEqual(weights[i]));
    }
  });

  it('gives nothing when there is nothing to split or nobody to split it between', () => {
    expect(apportion(0, [10, 20])).toEqual([0, 0]);
    expect(apportion(500, [0, 0])).toEqual([0, 0]);
    expect(apportion(500, [])).toEqual([]);
  });
});

describe('planning a write-off', () => {
  it('splits a debt between the people owed, by how much each is owed', () => {
    const plan = planWriteOff(ledgerOf(), 'sam')!;
    expect(plan.target.outstanding).toBe(dollars(-30));
    expect(shareMap(ledgerOf(), 'sam')).toEqual({ tushar: dollars(18), kabir: dollars(12) });
    expect(plan.unplaced).toBe(0);
  });

  it('lets the people who owed a ghost keep it, by how much each owed', () => {
    // Sam wins $50 off Sid and Tushar instead.
    const ledger = ledgerOf({
      players: [player('sam', 'Sam'), player('sid', 'Sid'), player('tushar', 'Tushar')],
      sessions: [
        {
          ...night,
          entries: [
            { playerId: 'sam', buyIn: dollars(10), cashOut: dollars(60) },
            { playerId: 'sid', buyIn: dollars(30), cashOut: 0 },
            { playerId: 'tushar', buyIn: dollars(30), cashOut: dollars(10) },
          ],
        },
      ],
    });
    expect(shareMap(ledger, 'sam')).toEqual({ sid: dollars(30), tushar: dollars(20) });
  });

  it('has nothing to split for someone who is square', () => {
    const ledger = ledgerOf({ sessions: [] });
    const plan = planWriteOff(ledger, 'sam')!;
    expect(plan.shares).toEqual([]);
    expect(plan.unplaced).toBe(0);
  });

  it('never hands a share to someone ghosted or removed themselves', () => {
    const ledger = ledgerOf({
      players: [
        player('sam', 'Sam'),
        player('sid', 'Sid'),
        player('tushar', 'Tushar', { ghostedAt: 5 }),
        player('kabir', 'Kabir'),
      ],
    });
    expect(Object.keys(shareMap(ledger, 'sam'))).toEqual(['kabir']);

    const gone = ledgerOf({
      players: [
        player('sam', 'Sam'),
        player('sid', 'Sid'),
        player('tushar', 'Tushar'),
        player('kabir', 'Kabir', { deleted: true }),
      ],
    });
    expect(Object.keys(shareMap(gone, 'sam'))).toEqual(['tushar']);
  });

  it('places only what others are owed when the books are already out', () => {
    // Tushar's real cash-out was never typed in, so he shows as square and
    // only Kabir's $20 is there to absorb Sam's $30.
    const ledger = ledgerOf({
      sessions: [
        {
          ...night,
          entries: night.entries.map((e) =>
            e.playerId === 'tushar' ? { ...e, cashOut: e.buyIn } : e,
          ),
        },
      ],
    });
    const plan = planWriteOff(ledger, 'sam')!;
    expect(shareMap(ledger, 'sam')).toEqual({ kabir: dollars(20) });
    expect(plan.unplaced).toBe(dollars(10));
  });
});

describe('ghosting a player', () => {
  beforeEach(() => {
    useStore.setState({ ledger: ledgerOf(), whoAmI: 'tushar' });
  });

  const state = () => useStore.getState().ledger;

  it('clears their balance and takes it off the people they owed', () => {
    useStore.getState().ghostPlayer('sam');
    expect(outstanding(state())).toEqual({
      sam: 0,
      sid: dollars(-20),
      tushar: dollars(12),
      kabir: dollars(8),
    });
  });

  it('leaves a plan that clears everyone with nothing left over', () => {
    useStore.getState().ghostPlayer('sam');
    const { transfers, leftover } = planOf(state());
    expect(leftover).toBe(0);
    expect(transfers).toEqual(
      expect.arrayContaining([
        { from: 'sid', to: 'tushar', amount: dollars(12) },
        { from: 'sid', to: 'kabir', amount: dollars(8) },
      ]),
    );
    expect(transfers).toHaveLength(2);
  });

  it('marks them ghosted, keeps them in the game, and logs who did it', () => {
    useStore.getState().ghostPlayer('sam');
    const sam = state().players.find((p) => p.id === 'sam')!;
    expect(sam.ghostedAt).toBeGreaterThan(0);
    expect(sam.deleted).toBeFalsy();

    const log = state().activity.at(-1)!;
    expect(log.action).toBe('player.ghost');
    expect(log.actorName).toBe('Tushar');
    expect(log.summary).toBe('Sam');
    expect(log.detail).toContain('written off');
    expect(log.detail).toContain('Tushar takes');
    expect(log.detail).toContain('Kabir takes');
  });

  it('records the write-off apart from real money', () => {
    useStore.getState().ghostPlayer('sam');
    const rows = computeBalances(state());
    const tushar = rows.find((r) => r.player.id === 'tushar')!;
    expect(tushar.received).toBe(0);
    expect(tushar.writtenOff).toBe(dollars(-18));
    expect(rows.find((r) => r.player.id === 'sam')!.writtenOff).toBe(dollars(30));
    expect(totalPaid(state())).toBe(0);

    const record = standingWriteOff(state(), 'sam')!;
    expect(record.total).toBe(dollars(30));
    expect(record.debt).toBe(true);
  });

  it('does nothing the second time', () => {
    useStore.getState().ghostPlayer('sam');
    const once = state();
    useStore.getState().ghostPlayer('sam');
    expect(state()).toBe(once);
  });

  it('writes nothing off for someone square, but still marks them', () => {
    useStore.setState({ ledger: ledgerOf({ sessions: [] }) });
    useStore.getState().ghostPlayer('sam');
    expect(state().payments).toEqual([]);
    expect(state().players.find((p) => p.id === 'sam')!.ghostedAt).toBeGreaterThan(0);
    expect(state().activity.at(-1)!.detail).toBe('Square, so nothing was written off');
  });

  it('counts only real payments made before they vanished', () => {
    // Sam paid Tushar $10 of the $30, then disappeared.
    useStore.setState({
      ledger: ledgerOf({
        payments: [{ id: 'p1', from: 'sam', to: 'tushar', amount: dollars(10), date: '2026-11-15', updatedAt: 1 }],
      }),
    });
    expect(shareMap(state(), 'sam')).toEqual({ kabir: dollars(10), tushar: dollars(10) });
    useStore.getState().ghostPlayer('sam');
    expect(outstanding(state())).toMatchObject({ sam: 0, tushar: dollars(10), kabir: dollars(10) });
    expect(totalPaid(state())).toBe(dollars(10));
  });
});

describe('unghosting a player', () => {
  beforeEach(() => {
    useStore.setState({ ledger: ledgerOf(), whoAmI: 'kabir' });
  });

  const state = () => useStore.getState().ledger;

  it('puts every balance back exactly as it was', () => {
    const before = outstanding(state());
    useStore.getState().ghostPlayer('sam');
    useStore.getState().unghostPlayer('sam');
    expect(outstanding(state())).toEqual(before);
    expect(state().players.find((p) => p.id === 'sam')!.ghostedAt).toBeUndefined();
  });

  it('tombstones the write-off so older versions of the app undo it too', () => {
    useStore.getState().ghostPlayer('sam');
    useStore.getState().unghostPlayer('sam');
    const writeOffs = state().payments.filter((p) => p.writeOff);
    expect(writeOffs.length).toBeGreaterThan(0);
    expect(writeOffs.every((p) => p.deleted)).toBe(true);
  });

  it('logs what went back on', () => {
    useStore.getState().ghostPlayer('sam');
    useStore.getState().unghostPlayer('sam');
    const log = state().activity.at(-1)!;
    expect(log.action).toBe('player.unghost');
    expect(log.actorName).toBe('Kabir');
    expect(log.detail).toContain('back on their balance');
  });

  it('keeps payments recorded once they are back', () => {
    useStore.getState().ghostPlayer('sam');
    useStore.getState().unghostPlayer('sam');
    useStore.getState().savePayment({
      id: 'back', from: 'sam', to: 'tushar', amount: dollars(30), date: '2026-11-20', updatedAt: 1,
    });
    expect(outstanding(state())).toMatchObject({ sam: 0, tushar: 0, kabir: dollars(20) });
  });

  it('can ghost them again later, from their full balance', () => {
    useStore.getState().ghostPlayer('sam');
    useStore.getState().unghostPlayer('sam');
    useStore.getState().ghostPlayer('sam');
    expect(outstanding(state())).toMatchObject({ sam: 0, tushar: dollars(12), kabir: dollars(8) });
    expect(writeOffRecords(state().payments.filter((p) => !p.deleted))).toHaveLength(1);
  });

  it('does nothing for someone who is not ghosted', () => {
    const before = state();
    useStore.getState().unghostPlayer('sam');
    expect(state()).toBe(before);
  });
});

describe('write-offs across phones and versions', () => {
  beforeEach(() => {
    useStore.setState({ ledger: ledgerOf() });
  });

  it('counts only one write-off when two phones ghost the same player before syncing', async () => {
    useStore.getState().ghostPlayer('sam');
    const phoneA = useStore.getState().ledger;

    useStore.setState({ ledger: ledgerOf() });
    // A later clock on the second phone, as it would be in real life.
    await new Promise((r) => setTimeout(r, 5));
    useStore.getState().ghostPlayer('sam');
    const phoneB = useStore.getState().ledger;

    const merged = mergeLedgers(phoneA, phoneB);
    // Both sets of write-off payments survive the merge...
    expect(merged.payments.filter((p) => p.writeOff && !p.deleted)).toHaveLength(4);
    // ...but only the ghosting that won counts.
    expect(outstanding(merged)).toEqual({
      sam: 0,
      sid: dollars(-20),
      tushar: dollars(12),
      kabir: dollars(8),
    });
  });

  it('gives an older app that sees write-offs as plain payments the same balances', () => {
    useStore.getState().ghostPlayer('sam');
    const ledger = useStore.getState().ledger;
    const asOldAppSeesIt: Ledger = {
      ...ledger,
      players: ledger.players.map(({ ghostedAt: _ghostedAt, ...p }) => p),
      payments: ledger.payments.map(({ writeOff: _writeOff, ...p }): Payment => p),
    };
    expect(outstanding(asOldAppSeesIt)).toEqual(outstanding(ledger));
  });

  it('ignores a write-off whose ghosting has been undone elsewhere', () => {
    useStore.getState().ghostPlayer('sam');
    const ledger = useStore.getState().ledger;
    // Another phone unghosted Sam; only the player record has arrived so far.
    const partly: Ledger = {
      ...ledger,
      players: ledger.players.map((p) => (p.id === 'sam' ? { ...p, ghostedAt: undefined } : p)),
    };
    expect(outstanding(partly)).toEqual(outstanding(ledgerOf()));
  });
});

describe('a player removed while still owing', () => {
  const removedLedger = () =>
    ledgerOf({
      players: [
        player('sam', 'Sam', { deleted: true }),
        player('sid', 'Sid'),
        player('tushar', 'Tushar'),
        player('kabir', 'Kabir'),
      ],
    });

  it('is found, so the shortfall can be blamed on the right thing', () => {
    const removed = removedBalances(removedLedger());
    expect(removed.map((b) => [b.player.id, b.outstanding])).toEqual([['sam', dollars(-30)]]);
    expect(planOf(removedLedger()).leftover).toBe(dollars(30));
  });

  it('can have their balance written off, which squares the books', () => {
    useStore.setState({ ledger: removedLedger() });
    useStore.getState().ghostPlayer('sam');
    const ledger = useStore.getState().ledger;
    expect(removedBalances(ledger)).toEqual([]);
    expect(planOf(ledger).leftover).toBe(0);
    expect(outstanding(ledger)).toEqual({ sid: dollars(-20), tushar: dollars(12), kabir: dollars(8) });
    // Still removed: writing off a balance doesn't bring anyone back.
    expect(ledger.players.find((p) => p.id === 'sam')!.deleted).toBe(true);
  });
});
