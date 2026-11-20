import { useMemo, useState } from 'react';
import { Confirm, Field, Money, Sheet, formatDate, todayISO } from '../components/ui';
import { addDays, earliestStart, seasonEnd, seasonLedger, seasonOfDate, seasonsOf } from '../lib/seasons';
import { settle } from '../lib/settle';
import { computeBalances } from '../lib/stats';
import { useStore } from '../lib/store';
import type { Ledger, Season } from '../lib/types';

const day = (iso: string) => formatDate(iso, { weekday: undefined });

/** "20 Nov 2026 – 3 Mar 2027", "Since 4 Mar 2027", or "Up to 3 Mar 2027" for the first. */
function span(ledger: Ledger, season: Season): string {
  const end = seasonEnd(ledger, season);
  if (!season.start) return end ? `Up to ${day(end)}` : 'Every session';
  return end ? `${day(season.start)} – ${day(end)}` : `Since ${day(season.start)}`;
}

/** Settings → Seasons: start a fresh season, and rename or take back the ones there are. */
export function SeasonsSection() {
  const ledger = useStore((s) => s.ledger);
  const [starting, setStarting] = useState(false);
  const [editing, setEditing] = useState<Season | null>(null);

  const seasons = useMemo(() => seasonsOf(ledger), [ledger]);
  const current = seasons[seasons.length - 1];

  const sessionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const session of ledger.sessions) {
      if (session.deleted) continue;
      const season = seasonOfDate(seasons, session.date);
      if (season) counts.set(season.id, (counts.get(season.id) ?? 0) + 1);
    }
    return counts;
  }, [ledger.sessions, seasons]);

  return (
    <>
      <div className="section-label">Seasons</div>
      <div className="card card-pad stack-sm">
        <p className="hint" style={{ marginBottom: 4 }}>
          {current ? (
            <>
              This season is <b>{current.name}</b>. Starting another gives everyone a fresh
              leaderboard and fresh payments; earlier seasons stay a tap away.
            </>
          ) : (
            <>
              Start a new season — at the end of a semester, say — and everyone gets a fresh
              leaderboard and fresh payments. Nothing is deleted: earlier seasons stay a tap away.
            </>
          )}
        </p>
        <button className="btn btn-block" onClick={() => setStarting(true)}>
          Start a new season
        </button>
      </div>

      {seasons.length > 0 ? (
        <div className="card" style={{ marginTop: 10 }}>
          {[...seasons].reverse().map((season, i) => {
            const count = sessionCounts.get(season.id) ?? 0;
            return (
              <div
                key={season.id}
                className="row"
                style={{
                  padding: '11px 14px',
                  gap: 10,
                  borderBottom: i < seasons.length - 1 ? '1px solid var(--line-soft)' : undefined,
                }}
              >
                <div className="grow" style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 620 }} className="truncate">
                    {season.name}
                    {season.id === current?.id ? (
                      <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}> · this season</span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>
                    {span(ledger, season)} · {count} session{count === 1 ? '' : 's'}
                  </div>
                </div>
                <button
                  className="btn btn-sm"
                  aria-label={`Edit ${season.name}`}
                  onClick={() => setEditing(season)}
                >
                  Edit
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {starting ? <StartSeasonSheet onClose={() => setStarting(false)} /> : null}
      {editing ? <SeasonSheet season={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function StartSeasonSheet({ onClose }: { onClose: () => void }) {
  const ledger = useStore((s) => s.ledger);
  const startSeason = useStore((s) => s.startSeason);

  const seasons = useMemo(() => seasonsOf(ledger), [ledger]);
  const current = seasons[seasons.length - 1] ?? null;
  const today = todayISO();
  // Tomorrow is allowed, so a game played tonight can stay in the old season.
  const latest = addDays(today, 1);
  const earliest = earliestStart(ledger);

  const [endingName, setEndingName] = useState(current?.name ?? 'Season 1');
  const [name, setName] = useState(`Season ${Math.max(seasons.length, 1) + 1}`);
  const [start, setStart] = useState(today);

  // Whatever's still owed in the ending season stays there: show it first,
  // since squaring up before the switch is the tidy way to do it.
  const open = useMemo(() => {
    const balances = computeBalances(seasonLedger(ledger, current));
    return settle(new Map(balances.map((b) => [b.player.id, b.outstanding]))).transfers;
  }, [ledger, current]);
  const byId = new Map(ledger.players.map((p) => [p.id, p]));

  const tooEarly = earliest !== '' && start < earliest;
  const valid =
    name.trim() !== '' && endingName.trim() !== '' && start !== '' && start <= latest && !tooEarly;
  const ending = endingName.trim() || 'the season that’s ending';
  const next = name.trim() || 'the new season';

  // Nights already logged on or after the start move across with it — say
  // so, since starting on the day of a game is the easy case to get wrong.
  const moving = ledger.sessions.filter((s) => !s.deleted && start !== '' && s.date >= start).length;

  return (
    <Sheet title="Start a new season" onClose={onClose}>
      <div className="stack">
        <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-dim)' }}>
          The leaderboard and payments start again from zero. Nothing is deleted: {ending} stays a
          tap away, with its standings and payments exactly as they end.
        </p>

        <Field label="The season that's ending">
          <input
            className="input"
            value={endingName}
            placeholder="e.g. Sem 2 2026"
            onChange={(e) => setEndingName(e.target.value)}
          />
        </Field>

        <Field label="The new season">
          <input
            className="input"
            value={name}
            placeholder="e.g. Sem 1 2027"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field
          label="New season starts"
          hint={
            tooEarly && current
              ? `It has to start after ${current.name} did.`
              : moving > 0
                ? `${moving} night${moving === 1 ? '' : 's'} already logged from this day on will count towards ${next}.` +
                  (start <= today
                    ? ` Start it tomorrow to keep ${moving === 1 ? 'it' : 'them'} in ${ending}.`
                    : '')
                : 'Nights from this day on count towards the new season.'
          }
        >
          <input
            className="input"
            type="date"
            value={start}
            min={earliest || undefined}
            max={latest}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>

        {open.length > 0 ? (
          <div className="banner banner-warn">
            <span>⚠️</span>
            <span>
              Still owed in {ending}:{' '}
              {open.map((t, i) => (
                <span key={`${t.from}-${t.to}`}>
                  {i > 0 ? ', ' : ''}
                  {byId.get(t.from)?.name ?? 'Someone'} owes {byId.get(t.to)?.name ?? 'someone'}{' '}
                  <Money cents={t.amount} colored={false} />
                </span>
              ))}
              . Debts don&apos;t carry over — they stay with {ending}, where you can still record
              them later. Settle up first if you&apos;d rather.
            </span>
          </div>
        ) : null}

        <button
          className="btn btn-primary btn-block"
          disabled={!valid}
          onClick={() => {
            startSeason({ endingName, name, start });
            onClose();
          }}
        >
          Start {name.trim() || 'the new season'}
        </button>
      </div>
    </Sheet>
  );
}

/** Rename a season, or take back the latest one if it was started by mistake. */
function SeasonSheet({ season, onClose }: { season: Season; onClose: () => void }) {
  const ledger = useStore((s) => s.ledger);
  const renameSeason = useStore((s) => s.renameSeason);
  const undoSeason = useStore((s) => s.undoSeason);
  const [name, setName] = useState(season.name);
  const [confirming, setConfirming] = useState(false);

  const seasons = seasonsOf(ledger);
  const previous = seasons[seasons.length - 2];
  // Only the season in play, and never the first: that one holds everything
  // from before there were seasons.
  const canTakeBack = seasons.length >= 2 && seasons[seasons.length - 1].id === season.id;

  if (confirming && previous) {
    return (
      <Confirm
        title={`Take back ${season.name}?`}
        body={
          seasons.length > 2
            ? `Its nights and payments go back into ${previous.name}, as though it had never been started. Nothing is deleted.`
            : 'Its nights and payments go back in with everything before it, and the app goes back to a single running leaderboard. Nothing is deleted.'
        }
        confirmLabel="Take it back"
        onConfirm={() => {
          undoSeason(season.id);
          onClose();
        }}
        onClose={() => setConfirming(false)}
      />
    );
  }

  return (
    <Sheet title="Edit season" onClose={onClose}>
      <div className="stack">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <button
          className="btn btn-primary btn-block"
          disabled={!name.trim()}
          onClick={() => {
            renameSeason(season.id, name);
            onClose();
          }}
        >
          Save
        </button>

        {canTakeBack ? (
          <div className="stack-sm">
            <button className="btn btn-danger btn-block" onClick={() => setConfirming(true)}>
              Take back this season
            </button>
            <span className="hint">
              Started it by mistake? This puts its nights and payments back into the season
              before.
            </span>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
