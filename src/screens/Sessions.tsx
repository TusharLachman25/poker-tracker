import { Fragment, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, EmptyState, Money, formatDate } from '../components/ui';
import { ChevronIcon } from '../components/icons';
import { seasonOfDate, seasonsOf } from '../lib/seasons';
import { activeSessions, entryNet, isLive, sessionTotals, sortedSessions } from '../lib/stats';
import { useStore } from '../lib/store';
import { GAME_LABELS } from '../lib/types';

export function Sessions() {
  const ledger = useStore((s) => s.ledger);

  const sessions = useMemo(
    () => sortedSessions(activeSessions(ledger)).reverse(),
    [ledger],
  );
  const byId = useMemo(() => new Map(ledger.players.map((p) => [p.id, p])), [ledger.players]);
  const hasPlayers = ledger.players.some((p) => !p.deleted);

  // Every session stays in the one list; seasons just get a heading each.
  const seasons = useMemo(() => seasonsOf(ledger), [ledger]);
  const current = seasons[seasons.length - 1];
  const seasonOf = (date: string) => (seasons.length ? seasonOfDate(seasons, date) : null);
  const freshSeason = current && (sessions.length === 0 || seasonOf(sessions[0].date)?.id !== current.id);

  if (sessions.length === 0) {
    return (
      <div className="page">
        <EmptyState
          icon="🃏"
          title="No sessions yet"
          body={
            hasPlayers
              ? 'Log a night: who played, what they bought in for, and what they walked away with.'
              : 'Add your players first, then log your first night.'
          }
          action={
            <Link className="btn btn-primary" to={hasPlayers ? '/sessions/new' : '/players'}>
              {hasPlayers ? 'Log a session' : 'Add players'}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="stack-sm">
        {freshSeason ? (
          <>
            <SeasonHeading name={current.name} isCurrent />
            <p className="hint" style={{ margin: '0 2px 6px' }}>
              Nothing logged yet this season.
            </p>
          </>
        ) : null}

        {sessions.map((session, i) => {
          const totals = sessionTotals(session);
          const live = session.entries.filter(isLive);
          const best = [...live].sort((a, b) => entryNet(b) - entryNet(a))[0];
          const bestPlayer = best ? byId.get(best.playerId) : undefined;
          const season = seasonOf(session.date);
          const startsSeason = season && (i === 0 || seasonOf(sessions[i - 1].date)?.id !== season.id);

          return (
            <Fragment key={session.id}>
              {startsSeason ? <SeasonHeading name={season.name} isCurrent={season.id === current?.id} /> : null}
              <Link className="card card-pad" to={`/sessions/${session.id}`}>
                <div className="row-between" style={{ marginBottom: 8 }}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 650 }} className="truncate">
                      {session.name || formatDate(session.date)}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }} className="truncate">
                      {session.name ? `${formatDate(session.date)} · ` : ''}
                      {GAME_LABELS[session.gameType]}
                      {session.location ? ` · ${session.location}` : ''}
                    </div>
                  </div>
                  <ChevronIcon className="" />
                </div>
  
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <span className="pill">
                    {totals.players} player{totals.players === 1 ? '' : 's'}
                  </span>
                  <span className="pill">
                    <Money cents={totals.buyIn} colored={false} /> pot
                  </span>
                  {!totals.balanced ? (
                    <span className="pill pill-warn">
                      off by <Money cents={Math.abs(totals.discrepancy)} colored={false} />
                    </span>
                  ) : null}
                </div>
  
                {bestPlayer && entryNet(best) > 0 ? (
                  <div className="row" style={{ marginTop: 10, gap: 8 }}>
                    <Avatar name={bestPlayer.name} color={bestPlayer.color} size="sm" />
                    <span style={{ fontSize: 12.5, color: 'var(--text-dim)' }} className="grow truncate">
                      {bestPlayer.name} took it down
                    </span>
                    <Money cents={entryNet(best)} signed className="" />
                  </div>
                ) : null}
              </Link>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function SeasonHeading({ name, isCurrent }: { name: string; isCurrent: boolean }) {
  return (
    <div className="section-label" style={{ marginTop: 6 }}>
      {name}
      {isCurrent ? ' · this season' : ''}
    </div>
  );
}
