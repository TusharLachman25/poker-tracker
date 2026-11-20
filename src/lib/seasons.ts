import { isoDate } from './dates';
import type { ID, Ledger, Payment, Season } from './types';

/**
 * Seasons: a fresh leaderboard and fresh debts — at the end of a semester,
 * say — without deleting anything.
 *
 * A season is only a name and a start date. Sessions belong to the season
 * their date falls in; payments to the season whose debts they settle. Every
 * screen works on the ledger narrowed to one season, so the stats, balances
 * and settle-up code underneath never needs to know seasons exist.
 */

/** What the screens are showing: the season in play, an earlier one by id, or all of them. */
export type SeasonView = 'current' | 'all' | ID;

/** Oldest first. Empty until the group starts its first new season. */
export function seasonsOf(ledger: Ledger): Season[] {
  return [...(ledger.settings.seasons ?? [])].sort((a, b) => a.start.localeCompare(b.start));
}

/** The season in play: the one started most recently. Null before seasons exist. */
export function currentSeason(ledger: Ledger): Season | null {
  const all = seasonsOf(ledger);
  return all.length ? all[all.length - 1] : null;
}

/** The season a date falls in: the last to have started by then. `seasons` is oldest first. */
export function seasonOfDate(seasons: Season[], date: string): Season | null {
  let found = seasons[0] ?? null;
  for (const season of seasons) if (season.start <= date) found = season;
  return found;
}

/** The season a payment settles debts in: the one it was recorded against, or else its date's. */
export function seasonOfPayment(seasons: Season[], payment: Payment): Season | null {
  const pinned = payment.season ? seasons.find((s) => s.id === payment.season) : undefined;
  return pinned ?? seasonOfDate(seasons, payment.date);
}

/** Which season a view means. Null for all of them, and always null before seasons exist. */
export function resolveView(ledger: Ledger, view: SeasonView): Season | null {
  const seasons = seasonsOf(ledger);
  if (view === 'all' || seasons.length === 0) return null;
  const current = seasons[seasons.length - 1];
  if (view === 'current') return current;
  // A season undone on another phone falls back to the one in play.
  return seasons.find((s) => s.id === view) ?? current;
}

/**
 * The ledger as it stands within one season: only that season's sessions and
 * payments. Null gives back everything.
 */
export function seasonLedger(ledger: Ledger, season: Season | null): Ledger {
  if (!season) return ledger;
  const seasons = seasonsOf(ledger);
  return {
    ...ledger,
    sessions: ledger.sessions.filter((s) => seasonOfDate(seasons, s.date)?.id === season.id),
    payments: (ledger.payments ?? []).filter((p) => seasonOfPayment(seasons, p)?.id === season.id),
  };
}

/**
 * Each season's own ledger, oldest first — or the whole ledger as a single
 * scope before seasons exist. Anything to do with debts runs once per scope,
 * because a debt never crosses from one season into another.
 */
export function seasonScopes(ledger: Ledger): { season: Season | null; ledger: Ledger }[] {
  const seasons = seasonsOf(ledger);
  if (seasons.length === 0) return [{ season: null, ledger }];
  return seasons.map((season) => ({ season, ledger: seasonLedger(ledger, season) }));
}

/** `YYYY-MM-DD` shifted by whole days. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d + days).getTime());
}

/**
 * The earliest a new season can start: the day after the current one did, so
 * no season is ever empty by definition. Empty when any day will do.
 */
export function earliestStart(ledger: Ledger): string {
  const current = currentSeason(ledger);
  return current?.start ? addDays(current.start, 1) : '';
}

/** The last day of a season, or null for the one still in play. */
export function seasonEnd(ledger: Ledger, season: Season): string | null {
  const seasons = seasonsOf(ledger);
  const index = seasons.findIndex((s) => s.id === season.id);
  const next = index >= 0 ? seasons[index + 1] : undefined;
  return next ? addDays(next.start, -1) : null;
}
