import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ProfitChart } from '../components/ProfitChart';
import { Avatar, Money, StatTile, formatDate } from '../components/ui';
import { BackIcon, ChevronIcon, EditIcon } from '../components/icons';
import { formatHours } from '../lib/money';
import { computeStats, entryNet, sessionEntry, sortedSessions, activeSessions } from '../lib/stats';
import { useStore } from '../lib/store';
import { GAME_LABELS } from '../lib/types';
import { EditPlayerSheet } from './Players';

export function PlayerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const ledger = useStore((s) => s.ledger);
  const [editing, setEditing] = useState(false);

  const stats = useMemo(() => computeStats(ledger), [ledger]);
  const me = stats.find((s) => s.player.id === id);
  const rank = me ? stats.filter((s) => s.sessions > 0).findIndex((s) => s.player.id === id) + 1 : 0;

  const history = useMemo(() => {
    if (!id) return [];
    return sortedSessions(activeSessions(ledger))
      .filter((s) => sessionEntry(s, id))
      .reverse();
  }, [ledger, id]);

  if (!me) {
    return (
      <div className="page">
        <p className="hint">That player isn&apos;t in the game any more.</p>
        <button className="btn" style={{ marginTop: 12 }} onClick={() => navigate('/players')}>
          Back to players
        </button>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 16 }}>
        <button className="btn btn-ghost btn-icon" onClick={() => navigate(-1)} aria-label="Back">
          <BackIcon />
        </button>
        <Avatar name={me.player.name} color={me.player.color} size="lg" />
        <div className="grow" style={{ minWidth: 0 }}>
          <h2 className="truncate" style={{ fontSize: 19 }}>
            {me.player.name}
          </h2>
          <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>
            {me.sessions > 0 ? `Ranked #${rank} of ${stats.filter((s) => s.sessions > 0).length}` : 'No sessions yet'}
          </div>
        </div>
        <button
          className="btn btn-ghost btn-icon"
          onClick={() => setEditing(true)}
          aria-label="Edit player"
        >
          <EditIcon />
        </button>
      </div>

      <div className="card card-pad center" style={{ marginBottom: 12 }}>
        <div className="stat-label">All-time</div>
        <div style={{ fontSize: 34, fontWeight: 760, letterSpacing: '-0.03em', marginTop: 4 }}>
          <Money cents={me.net} signed />
        </div>
        {me.sessions > 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-faint)', marginTop: 4 }}>
            across {me.sessions} session{me.sessions === 1 ? '' : 's'}
          </div>
        ) : null}
      </div>

      {me.cumulative.length > 0 ? (
        <div className="card card-pad" style={{ marginBottom: 12 }}>
          <ProfitChart stats={[me]} />
        </div>
      ) : null}

      {me.sessions > 0 ? (
        <>
          <div className="section-label">Form</div>
          <div className="stat-grid">
            <StatTile
              label="Win rate"
              value={`${Math.round((me.wins / me.sessions) * 100)}%`}
              note={`${me.wins}W ${me.losses}L${me.pushes ? ` ${me.pushes}E` : ''}`}
            />
            <StatTile
              label="Average night"
              value={<Money cents={me.avgPerSession} signed />}
            />
            <StatTile label="Best night" value={<Money cents={me.biggestWin} signed />} />
            <StatTile label="Worst night" value={<Money cents={me.biggestLoss} signed />} />
            <StatTile
              label="Money staked"
              value={<Money cents={me.volume} colored={false} />}
              note="total buy-ins"
            />
            <StatTile
              label="ROI"
              value={me.roi !== null ? `${(me.roi * 100).toFixed(1)}%` : '—'}
              tone={me.roi === null ? undefined : me.roi > 0 ? 'win' : me.roi < 0 ? 'loss' : 'flat'}
              note="profit per dollar in"
            />
            {me.hourly !== null ? (
              <StatTile
                label="Per hour"
                value={<Money cents={me.hourly} signed />}
                note={formatHours(me.minutesPlayed)}
              />
            ) : null}
            {me.streak !== 0 ? (
              <StatTile
                label="Current streak"
                value={streakLabel(me.streak)}
                tone={me.streak > 0 ? 'win' : 'loss'}
                small
              />
            ) : null}
          </div>
        </>
      ) : null}

      {history.length > 0 ? (
        <>
          <div className="section-label">Session history</div>
          <div className="card">
            {history.map((session) => {
              const entry = sessionEntry(session, me.player.id)!;
              return (
                <Link key={session.id} className="lb-row" to={`/sessions/${session.id}`}>
                  <span className="grow">
                    <div className="lb-name" style={{ fontSize: 14 }}>
                      {session.name || formatDate(session.date, { weekday: undefined })}
                    </div>
                    <div className="lb-meta">
                      {GAME_LABELS[session.gameType]} · in{' '}
                      <Money cents={entry.buyIn} colored={false} /> · out{' '}
                      <Money cents={entry.cashOut} colored={false} />
                    </div>
                  </span>
                  <Money cents={entryNet(entry)} signed />
                  <ChevronIcon />
                </Link>
              );
            })}
          </div>
        </>
      ) : null}

      {editing ? <EditPlayerSheet player={me.player} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}

/** "1 win", "3 wins", "2 losses" — never "2 winses". */
function streakLabel(streak: number): string {
  const n = Math.abs(streak);
  if (streak > 0) return `${n} ${n === 1 ? 'win' : 'wins'}`;
  return `${n} ${n === 1 ? 'loss' : 'losses'}`;
}
