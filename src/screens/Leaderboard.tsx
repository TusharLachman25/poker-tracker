import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ProfitChart } from '../components/ProfitChart';
import { Avatar, EmptyState, Money, StatTile, relativeDate } from '../components/ui';
import { HandshakeIcon, SpadeIcon } from '../components/icons';
import { formatHours } from '../lib/money';
import { RANGE_LABELS, computeStats, filterByRange, groupSummary, type RangeKey } from '../lib/stats';
import { useStore } from '../lib/store';
import { SettleSheet } from './SettleSheet';

const RANGES: RangeKey[] = ['all', 'month', 'quarter', 'year'];

export function Leaderboard() {
  const ledger = useStore((s) => s.ledger);
  const [range, setRange] = useState<RangeKey>('all');
  const [settling, setSettling] = useState(false);

  const scoped = useMemo(() => filterByRange(ledger, range), [ledger, range]);
  const stats = useMemo(() => computeStats(scoped), [scoped]);
  const summary = useMemo(() => groupSummary(scoped), [scoped]);

  const played = stats.filter((s) => s.sessions > 0);
  const hasPlayers = ledger.players.some((p) => !p.deleted);

  if (!hasPlayers) {
    return (
      <div className="page">
        <EmptyState
          icon={<SpadeIcon className="empty-glyph" />}
          title="Set up your home game"
          body="Add everyone who plays, then log your first night. The leaderboard fills itself in from there."
          action={
            <Link className="btn btn-primary" to="/players">
              Add players
            </Link>
          }
        />
      </div>
    );
  }

  if (summary.totalSessions === 0) {
    return (
      <div className="page">
        <RangeTabs range={range} setRange={setRange} />
        <EmptyState
          icon="🃏"
          title={range === 'all' ? 'No games logged yet' : `Nothing in the last ${RANGE_LABELS[range].toLowerCase()}`}
          body={
            range === 'all'
              ? 'Log a night of poker and everyone’s running totals start here.'
              : 'Try a wider date range, or log the next session.'
          }
          action={
            <Link className="btn btn-primary" to="/sessions/new">
              Log a session
            </Link>
          }
        />
      </div>
    );
  }

  const leader = played[0];
  const loser = played[played.length - 1];

  return (
    <div className="page">
      <RangeTabs range={range} setRange={setRange} />

      {summary.unbalanced.length > 0 ? (
        <div className="banner banner-warn" style={{ marginBottom: 12 }}>
          <span>⚠️</span>
          <span>
            {summary.unbalanced.length} session{summary.unbalanced.length > 1 ? 's have' : ' has'}{' '}
            buy-ins that don&apos;t match cash-outs, so these totals are off. Open the session to fix it.
          </span>
        </div>
      ) : null}

      <div className="card card-pad" style={{ marginBottom: 12 }}>
        <ProfitChart stats={played} />
      </div>

      <div className="section-label">Standings</div>
      <div className="card">
        {played.map((s, i) => (
          <Link key={s.player.id} className="lb-row" to={`/players/${s.player.id}`}>
            <span className={`rank ${i === 0 ? 'rank-1' : ''}`.trim()}>
              {i === 0 ? '★' : i + 1}
            </span>
            <Avatar name={s.player.name} color={s.player.color} />
            <span className="grow">
              <div className="lb-name">{s.player.name}</div>
              <div className="lb-meta">
                {s.sessions} session{s.sessions === 1 ? '' : 's'} · {s.wins}W&nbsp;{s.losses}L
                {s.streak !== 0 ? (
                  <>
                    {' · '}
                    <span className={s.streak > 0 ? 'win' : 'loss'}>
                      {Math.abs(s.streak)} {s.streak > 0 ? 'win' : 'loss'} streak
                    </span>
                  </>
                ) : null}
              </div>
            </span>
            <span>
              <div className="lb-net">
                <Money cents={s.net} signed />
              </div>
              <div className="lb-sub">
                {s.roi !== null ? `${(s.roi * 100).toFixed(0)}% ROI` : '—'}
              </div>
            </span>
          </Link>
        ))}
      </div>

      <button
        className="btn btn-block"
        style={{ marginTop: 12 }}
        onClick={() => setSettling(true)}
        disabled={played.length < 2}
      >
        <HandshakeIcon />
        Settle up
      </button>

      <div className="section-label">The numbers</div>
      <div className="stat-grid">
        <StatTile label="Biggest winner" value={leader ? leader.player.name : '—'} small />
        <StatTile
          label="Biggest loser"
          value={loser && loser.net < 0 ? loser.player.name : '—'}
          small
        />
        <StatTile label="Sessions" value={summary.totalSessions} />
        <StatTile
          label="Money staked"
          value={<Money cents={summary.totalVolume} colored={false} />}
        />
        {summary.biggestWin ? (
          <StatTile
            label="Best night"
            value={<Money cents={summary.biggestWin.amount} signed />}
            note={summary.biggestWin.player?.name}
          />
        ) : null}
        {summary.biggestLoss ? (
          <StatTile
            label="Worst night"
            value={<Money cents={summary.biggestLoss.amount} signed />}
            note={summary.biggestLoss.player?.name}
          />
        ) : null}
        {summary.minutesPlayed > 0 ? (
          <StatTile label="Time at the table" value={formatHours(summary.minutesPlayed)} small />
        ) : null}
        {summary.lastPlayed ? (
          <StatTile label="Last played" value={relativeDate(summary.lastPlayed)} small />
        ) : null}
      </div>

      {settling ? <SettleSheet stats={played} onClose={() => setSettling(false)} /> : null}
    </div>
  );
}

function RangeTabs({ range, setRange }: { range: RangeKey; setRange: (r: RangeKey) => void }) {
  return (
    <div className="row" style={{ gap: 6, marginBottom: 14, overflowX: 'auto' }}>
      {RANGES.map((key) => (
        <button
          key={key}
          className={`btn btn-sm ${range === key ? 'btn-primary' : ''}`.trim()}
          onClick={() => setRange(key)}
        >
          {RANGE_LABELS[key]}
        </button>
      ))}
    </div>
  );
}
