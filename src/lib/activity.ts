import { sharer, type SeasonWriteOff, type WriteOffPlan } from './ghost';
import { money } from './money';
import { entryNet, isLive } from './stats';
import type { Activity, ActivityAction, Payment, Player, Session } from './types';

/**
 * Describe a session the way a person would recognise it:
 * "Sat 12 Sep · 5 players · $50 in play".
 */
export function describeSession(session: Session, currency: string): string {
  const live = session.entries.filter(isLive);
  const pot = live.reduce((sum, e) => sum + e.buyIn, 0);
  const when = session.name || formatShortDate(session.date);
  return `${when} · ${live.length} player${live.length === 1 ? '' : 's'} · ${money(pot, currency)} in play`;
}

function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/**
 * What actually changed between two versions of a session, per player.
 *
 * This is the line that matters for trust: if someone quietly turns their loss
 * into a win, it shows up here as "Sam: -$12.00 -> +$3.00" rather than a bare
 * "session edited".
 */
export function diffSession(
  before: Session,
  after: Session,
  players: Player[],
  currency: string,
): string | undefined {
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? 'Someone';
  const netsOf = (s: Session) =>
    new Map(s.entries.filter(isLive).map((e) => [e.playerId, entryNet(e)]));

  const from = netsOf(before);
  const to = netsOf(after);
  const changes: string[] = [];

  for (const id of new Set([...from.keys(), ...to.keys()])) {
    const was = from.get(id);
    const now = to.get(id);
    if (was === now) continue;

    if (was === undefined) changes.push(`${name(id)} added at ${signed(now!, currency)}`);
    else if (now === undefined) changes.push(`${name(id)} removed (was ${signed(was, currency)})`);
    else changes.push(`${name(id)}: ${signed(was, currency)} → ${signed(now, currency)}`);
  }

  if (before.date !== after.date) changes.push(`date ${before.date} → ${after.date}`);

  return changes.length ? changes.join(', ') : undefined;
}

function signed(cents: number, currency: string): string {
  const text = money(Math.abs(cents), currency);
  return cents > 0 ? `+${text}` : cents < 0 ? `-${text}` : text;
}

export function describePayment(
  payment: Payment,
  players: Player[],
  currency: string,
): string {
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? 'Someone';
  return `${name(payment.from)} → ${name(payment.to)} · ${money(payment.amount, currency)}`;
}

/**
 * The detail line for a ghosting: what was written off and who took it on,
 * e.g. "$30 written off: Tushar takes $18, Kabir takes $12".
 */
export function describeWriteOff(plan: WriteOffPlan, currency: string): string {
  const placed = plan.shares.reduce((sum, s) => sum + s.amount, 0);
  if (placed === 0 && plan.unplaced === 0) return 'Square, so nothing was written off';

  // Their debt is taken on by the people they owed; money they were owed is
  // kept by the people who owed it.
  const verb = plan.target.outstanding < 0 ? 'takes' : 'keeps';
  const parts = plan.shares.map((s) => `${s.balance.player.name} ${verb} ${money(s.amount, currency)}`);

  let text =
    placed > 0
      ? `${money(placed, currency)} written off: ${parts.join(', ')}`
      : 'Nothing could be written off';
  if (plan.unplaced > 0) {
    text += `. ${money(plan.unplaced, currency)} couldn't be placed and stays on their balance`;
  }
  return text;
}

/**
 * The detail line for a whole ghosting, a season at a time when the group has
 * seasons: "Sem 2 2026: $30 written off: Tushar takes $18, Kabir takes $12".
 */
export function describeGhosting(parts: SeasonWriteOff[], currency: string): string {
  if (parts.length === 0) return 'Square, so nothing was written off';
  return parts
    .map(({ season, plan }) => `${season ? `${season.name}: ` : ''}${describeWriteOff(plan, currency)}`)
    .join('; ');
}

/** The detail line for an unghost: what went back on, e.g. "$30 back on their balance: Tushar $18, Kabir $12". */
export function describeUnghost(parts: Payment[], players: Player[], currency: string): string {
  if (parts.length === 0) return 'Nothing had been written off';
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? 'Someone';
  const total = parts.reduce((sum, p) => sum + p.amount, 0);
  const who = parts.map((p) => `${name(sharer(p))} ${money(p.amount, currency)}`);
  return `${money(total, currency)} back on their balance: ${who.join(', ')}`;
}

/** Build a log entry. `at` and `id` are filled in here so callers can't forget. */
export function entry(
  actor: { id?: string; name: string },
  action: ActivityAction,
  summary: string,
  detail?: string,
): Activity {
  const now = Date.now();
  return {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    actorId: actor.id,
    actorName: actor.name,
    action,
    summary,
    detail,
    at: now,
    updatedAt: now,
  };
}

export const ACTION_LABELS: Record<ActivityAction, string> = {
  'session.create': 'logged a session',
  'session.update': 'edited a session',
  'session.delete': 'deleted a session',
  'payment.create': 'recorded a payment',
  'payment.delete': 'deleted a payment',
  'player.add': 'added a player',
  'player.rename': 'renamed a player',
  'player.remove': 'removed a player',
  'player.ghost': 'ghosted a player',
  'player.unghost': 'unghosted a player',
  'season.start': 'started a new season',
  'season.rename': 'renamed a season',
  'season.undo': 'took back a new season',
  'ledger.import': 'restored from a backup',
  'ledger.erase': 'erased everything',
};

/** Edits and deletions are what people want to scrutinise. */
export const NOTABLE: ReadonlySet<ActivityAction> = new Set<ActivityAction>([
  'session.update',
  'session.delete',
  'payment.delete',
  'player.remove',
  // Both move other people's balances without any money changing hands.
  'player.ghost',
  'player.unghost',
  // Moves a season's nights and payments back into the one before.
  'season.undo',
  'ledger.import',
  'ledger.erase',
]);
