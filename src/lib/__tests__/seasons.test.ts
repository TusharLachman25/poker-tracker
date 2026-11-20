import { beforeEach, describe, expect, it } from 'vitest';
import { isoDate } from '../dates';
import { standingWriteOffs } from '../ghost';
import { mergeLedgers } from '../merge';
import {
  addDays,
  currentSeason,
  earliestStart,
  resolveView,
  seasonEnd,
  seasonLedger,
  seasonOfDate,
  seasonOfPayment,
  seasonScopes,
  seasonsOf,
} from '../seasons';
import { settle } from '../settle';
import { computeBalances, computeStats } from '../stats';
import { useStore } from '../store';
import type { Ledger, Payment, Season, Session } from '../types';

// Dates relative to today, so the tests don't depend on when they run.
const day = (offset: number) => addDays(isoDate(), offset);
const dollars = (n: number) => Math.round(n * 100);

const player = (id: string, name: string) => ({ id, name, color: '#fff', updatedAt: 1 });

const session = (id: string, date: string, entries: [string, number, number][]): Session => ({
  id,
  date,
  gameType: 'nlh',
  updatedAt: 1,
  entries: entries.map(([playerId, buyIn, cashOut]) => ({
    playerId,
    buyIn: dollars(buyIn),
    cashOut: dollars(cashOut),
  })),
});

const payment = (id: string, from: string, to: string, amount: number, date: string, extra: Partial<Payment> = {}): Payment => ({
  id, from, to, amount: dollars(amount), date, updatedAt: 1, ...extra,
});

/**
 * Last semester: one night, Ana +30, Ben -10, Cy -20. Ben has paid his $10,
 * so Cy still owes Ana $20 going into the break.
 */
function lastSemester(overrides: Partial<Ledger> = {}): Ledger {
  return {
    players: [player('ana', 'Ana'), player('ben', 'Ben'), player('cy', 'Cy'), player('dee', 'Dee')],
    sessions: [session('s1', day(-60), [['ana', 10, 40], ['ben', 10, 0], ['cy', 30, 10]])],
    payments: [payment('p1', 'ben', 'ana', 10, day(-58))],
    activity: [],
    settings: {
      currency: 'AUD',
      groupName: 'Test',
      defaultBuyIn: 1000,
      defaultStakes: '0.05/0.10',
      updatedAt: 1,
    },
    ...overrides,
  };
}

const balancesIn = (ledger: Ledger, season: Season | null) =>
  Object.fromEntries(
    computeBalances(seasonLedger(ledger, season))
      .filter((b) => b.outstanding !== 0)
      .map((b) => [b.player.id, b.outstanding]),
  );

const netsIn = (ledger: Ledger, season: Season | null) =>
  Object.fromEntries(
    computeStats(seasonLedger(ledger, season))
      .filter((s) => s.sessions > 0)
      .map((s) => [s.player.id, s.net]),
  );

const state = () => useStore.getState().ledger;
const seasonNamed = (name: string) => seasonsOf(state()).find((s) => s.name === name)!;

const start = (endingName: string, name: string, on = day(0)) =>
  useStore.getState().startSeason({ endingName, name, start: on });

describe('which season something belongs to', () => {
  const seasons: Season[] = [
    { id: 'one', name: 'Sem 1', start: '' },
    { id: 'two', name: 'Sem 2', start: '2026-07-20' },
    { id: 'three', name: 'Summer', start: '2026-11-20' },
  ];

  it('puts everything before the second season in the first', () => {
    expect(seasonOfDate(seasons, '2020-01-01')?.id).toBe('one');
    expect(seasonOfDate(seasons, '2026-07-19')?.id).toBe('one');
  });

  it('counts a season from its first day', () => {
    expect(seasonOfDate(seasons, '2026-07-20')?.id).toBe('two');
    expect(seasonOfDate(seasons, '2026-11-19')?.id).toBe('two');
    expect(seasonOfDate(seasons, '2026-11-20')?.id).toBe('three');
  });

  it('files a payment under the season it settles, whatever day it was paid', () => {
    const late = payment('p', 'cy', 'ana', 5, '2026-12-01', { season: 'two' });
    expect(seasonOfPayment(seasons, late)?.id).toBe('two');
  });

  it('goes by date for a payment from before seasons, or from an older app', () => {
    expect(seasonOfPayment(seasons, payment('p', 'cy', 'ana', 5, '2026-08-01'))?.id).toBe('two');
    // Pinned to a season that has since been taken back.
    expect(seasonOfPayment(seasons, payment('p', 'cy', 'ana', 5, '2026-08-01', { season: 'gone' }))?.id).toBe('two');
  });

  it('knows where each season ends, and when the next can start', () => {
    const ledger = lastSemester({ settings: { ...lastSemester().settings, seasons } });
    expect(seasonEnd(ledger, seasons[0])).toBe('2026-07-19');
    expect(seasonEnd(ledger, seasons[1])).toBe('2026-11-19');
    expect(seasonEnd(ledger, seasons[2])).toBeNull();
    expect(earliestStart(ledger)).toBe('2026-11-21');
    expect(earliestStart(lastSemester())).toBe('');
  });

  it('treats a view of a season that no longer exists as the current one', () => {
    const ledger = lastSemester({ settings: { ...lastSemester().settings, seasons } });
    expect(resolveView(ledger, 'current')?.id).toBe('three');
    expect(resolveView(ledger, 'two')?.id).toBe('two');
    expect(resolveView(ledger, 'gone')?.id).toBe('three');
    expect(resolveView(ledger, 'all')).toBeNull();
  });

  it('is all one ledger before the group has seasons', () => {
    const ledger = lastSemester();
    expect(seasonsOf(ledger)).toEqual([]);
    expect(seasonLedger(ledger, resolveView(ledger, 'current'))).toBe(ledger);
    expect(seasonScopes(ledger)).toEqual([{ season: null, ledger }]);
  });
});

describe('starting a new season', () => {
  beforeEach(() => {
    useStore.setState({ ledger: lastSemester(), viewing: 'current', whoAmI: 'ana' });
  });

  it('turns everything so far into a season of its own, the first time', () => {
    start('Sem 2 2026', 'Sem 1 2027');
    const seasons = seasonsOf(state());
    expect(seasons.map((s) => [s.name, s.start])).toEqual([
      ['Sem 2 2026', ''],
      ['Sem 1 2027', day(0)],
    ]);
    expect(currentSeason(state())?.name).toBe('Sem 1 2027');
  });

  it('starts the leaderboard from zero without losing the old one', () => {
    start('Sem 2 2026', 'Sem 1 2027');
    expect(netsIn(state(), currentSeason(state()))).toEqual({});
    expect(netsIn(state(), seasonNamed('Sem 2 2026'))).toEqual({
      ana: dollars(30),
      ben: dollars(-10),
      cy: dollars(-20),
    });
    // All time is still everything.
    expect(netsIn(state(), null)).toEqual(netsIn(lastSemester(), null));
  });

  it('does not carry debts over: the new season starts square, the old one keeps them', () => {
    start('Sem 2 2026', 'Sem 1 2027');
    expect(balancesIn(state(), currentSeason(state()))).toEqual({});
    expect(balancesIn(state(), seasonNamed('Sem 2 2026'))).toEqual({
      ana: dollars(20),
      cy: dollars(-20),
    });
  });

  it("keeps last season's debts out of this season's plan, even once both have some", () => {
    start('Sem 2 2026', 'Sem 1 2027');
    // A night in the new season: Cy wins $15 off Dee.
    useStore.getState().saveSession(session('s2', day(0), [['cy', 10, 25], ['dee', 15, 0]]));

    const now = computeBalances(seasonLedger(state(), currentSeason(state())));
    const { transfers } = settle(new Map(now.map((b) => [b.player.id, b.outstanding])));
    // Not netted against the $20 Cy owes Ana from last season.
    expect(transfers).toEqual([{ from: 'dee', to: 'cy', amount: dollars(15) }]);
    expect(balancesIn(state(), seasonNamed('Sem 2 2026'))).toEqual({ ana: dollars(20), cy: dollars(-20) });
  });

  it("keeps a payment made today for last season's debt in last season", () => {
    // Settling up on the last day, then starting the new season the same day.
    useStore.getState().savePayment(payment('today', 'cy', 'ana', 20, day(0)));
    start('Sem 2 2026', 'Sem 1 2027');
    expect(balancesIn(state(), seasonNamed('Sem 2 2026'))).toEqual({});
    expect(balancesIn(state(), currentSeason(state()))).toEqual({});
  });

  it('lets a late payment settle last season without touching this one', () => {
    start('Sem 2 2026', 'Sem 1 2027');
    const old = seasonNamed('Sem 2 2026');
    useStore.getState().savePayment(payment('late', 'cy', 'ana', 20, day(0), { season: old.id }));
    expect(balancesIn(state(), old)).toEqual({});
    expect(balancesIn(state(), currentSeason(state()))).toEqual({});
  });

  it('can start on an earlier day, taking nights already played with it', () => {
    useStore.getState().saveSession(session('s2', day(-2), [['ana', 10, 5], ['ben', 10, 15]]));
    start('Sem 2 2026', 'Sem 1 2027', day(-3));
    expect(netsIn(state(), currentSeason(state()))).toEqual({ ana: dollars(-5), ben: dollars(5) });
    expect(netsIn(state(), seasonNamed('Sem 2 2026'))).toEqual({
      ana: dollars(30),
      ben: dollars(-10),
      cy: dollars(-20),
    });
  });

  it("can start tomorrow, keeping a game played tonight in the season that's ending", () => {
    useStore.getState().saveSession(session('tonight', day(0), [['ana', 10, 0], ['ben', 10, 20]]));
    start('Sem 2 2026', 'Sem 1 2027', day(1));
    expect(netsIn(state(), currentSeason(state()))).toEqual({});
    expect(netsIn(state(), seasonNamed('Sem 2 2026'))).toMatchObject({ ana: dollars(20), ben: 0 });
  });

  it('turns down a start further ahead than tomorrow, on or before the current season, or with no name', () => {
    const before = state();
    start('Sem 2 2026', 'Sem 1 2027', day(2));
    start('Sem 2 2026', '  ');
    expect(state()).toBe(before);

    start('Sem 2 2026', 'Sem 1 2027', day(-10));
    const once = state();
    start('Sem 1 2027', 'Summer', day(-10));
    start('Sem 1 2027', 'Summer', day(-11));
    expect(state()).toBe(once);
    start('Sem 1 2027', 'Summer', day(-9));
    expect(seasonsOf(state()).map((s) => s.name)).toEqual(['Sem 2 2026', 'Sem 1 2027', 'Summer']);
  });

  it('can rename the season that is ending as it goes', () => {
    start('Sem 2 2026', 'Sem 1 2027', day(-10));
    start('Semester 1, 2027', 'Summer');
    expect(seasonsOf(state()).map((s) => s.name)).toEqual(['Sem 2 2026', 'Semester 1, 2027', 'Summer']);
  });

  it('logs who started it and what the old season was left owing', () => {
    start('Sem 2 2026', 'Sem 1 2027');
    const log = state().activity.at(-1)!;
    expect(log.action).toBe('season.start');
    expect(log.actorName).toBe('Ana');
    expect(log.summary).toBe('Sem 1 2027');
    expect(log.detail).toMatch(/Sem 2 2026 ended with .*20 still owed/);
  });

  it('opens every screen on the new season', () => {
    useStore.getState().setViewing('all');
    start('Sem 2 2026', 'Sem 1 2027');
    expect(useStore.getState().viewing).toBe('current');
  });
});

describe('renaming and taking back seasons', () => {
  beforeEach(() => {
    useStore.setState({ ledger: lastSemester(), viewing: 'current', whoAmI: 'ana' });
  });

  it('renames a season and logs it', () => {
    start('Sem 2 2026', 'Sem 1 2027');
    useStore.getState().renameSeason(seasonNamed('Sem 1 2027').id, 'Semester 1');
    expect(currentSeason(state())?.name).toBe('Semester 1');
    expect(state().activity.at(-1)!.summary).toBe('Sem 1 2027 → Semester 1');
  });

  it('takes back a season started by mistake, putting everything as it was', () => {
    useStore.getState().saveSession(session('s2', day(0), [['cy', 10, 25], ['dee', 15, 0]]));
    const before = computeBalances(state());
    start('Sem 2 2026', 'Sem 1 2027');
    useStore.getState().undoSeason(currentSeason(state())!.id);
    expect(seasonsOf(state())).toEqual([]);
    expect(computeBalances(state())).toEqual(before);
    expect(state().activity.at(-1)!.action).toBe('season.undo');
  });

  it('goes back one season at a time', () => {
    start('Sem 2 2026', 'Sem 1 2027', day(-10));
    start('Sem 1 2027', 'Summer');
    useStore.getState().undoSeason(seasonNamed('Summer').id);
    expect(seasonsOf(state()).map((s) => s.name)).toEqual(['Sem 2 2026', 'Sem 1 2027']);
  });

  it('only takes back the season in play', () => {
    start('Sem 2 2026', 'Sem 1 2027', day(-10));
    start('Sem 1 2027', 'Summer');
    const before = state();
    useStore.getState().undoSeason(seasonNamed('Sem 1 2027').id);
    useStore.getState().undoSeason(seasonNamed('Sem 2 2026').id);
    expect(state()).toBe(before);
  });

  it('files a payment recorded in a season that was taken back by its date', () => {
    start('Sem 2 2026', 'Sem 1 2027', day(-10));
    start('Sem 1 2027', 'Summer');
    useStore.getState().saveSession(session('s2', day(0), [['cy', 10, 25], ['dee', 15, 0]]));
    useStore.getState().savePayment(
      payment('p2', 'dee', 'cy', 15, day(0), { season: currentSeason(state())!.id }),
    );
    useStore.getState().undoSeason(seasonNamed('Summer').id);
    // Both the night and the payment are back in Sem 1 2027, and square.
    expect(balancesIn(state(), seasonNamed('Sem 1 2027'))).toEqual({});
  });
});

describe('seasons and the rest of the app', () => {
  beforeEach(() => {
    useStore.setState({ ledger: lastSemester(), viewing: 'current', whoAmI: 'ana' });
  });

  it('writes a ghost off season by season, among the people in each', () => {
    start('Sem 2 2026', 'Sem 1 2027');
    // This season Cy loses another $10, to Dee.
    useStore.getState().saveSession(session('s2', day(0), [['cy', 10, 0], ['dee', 10, 20]]));
    useStore.getState().ghostPlayer('cy');

    // Last season's $20 lands on Ana; this season's $10 on Dee.
    expect(balancesIn(state(), seasonNamed('Sem 2 2026'))).toEqual({});
    expect(balancesIn(state(), currentSeason(state()))).toEqual({});
    const records = standingWriteOffs(state(), 'cy');
    expect(records.map((r) => r.total).sort()).toEqual([dollars(10), dollars(20)]);
    const detail = state().activity.at(-1)!.detail!;
    expect(detail).toContain('Sem 2 2026: ');
    expect(detail).toContain('Sem 1 2027: ');

    useStore.getState().unghostPlayer('cy');
    expect(balancesIn(state(), seasonNamed('Sem 2 2026'))).toEqual({ ana: dollars(20), cy: dollars(-20) });
    expect(balancesIn(state(), currentSeason(state()))).toEqual({ cy: dollars(-10), dee: dollars(10) });
  });

  it('keeps a ghosting from before seasons in the season it happened in', () => {
    useStore.getState().ghostPlayer('cy');
    start('Sem 2 2026', 'Sem 1 2027');
    expect(balancesIn(state(), seasonNamed('Sem 2 2026'))).toEqual({});
    expect(balancesIn(state(), currentSeason(state()))).toEqual({});
  });

  it('survives a sync with a phone that has older settings', () => {
    const other = lastSemester();
    start('Sem 2 2026', 'Sem 1 2027');
    const merged = mergeLedgers(other, state());
    expect(seasonsOf(merged).map((s) => s.name)).toEqual(['Sem 2 2026', 'Sem 1 2027']);
    expect(balancesIn(merged, currentSeason(merged))).toEqual({});
  });

  it("survives an older app's settings edit, which carries fields it doesn't know", () => {
    start('Sem 2 2026', 'Sem 1 2027');
    // What updateSettings has always done: spread the old record, patch, stamp.
    const edited = { ...state().settings, currency: 'USD', updatedAt: Date.now() + 1 };
    expect(seasonsOf({ ...state(), settings: edited }).map((s) => s.name)).toEqual([
      'Sem 2 2026',
      'Sem 1 2027',
    ]);
  });
});
