import { useMemo } from 'react';
import { Avatar, Money, Sheet } from '../components/ui';
import { planGhosting, sharer, standingWriteOffs, type WriteOffPlan } from '../lib/ghost';
import { seasonsOf } from '../lib/seasons';
import { useStore } from '../lib/store';
import type { ID } from '../lib/types';

const introStyle = { fontSize: 14, lineHeight: 1.6, color: 'var(--text-dim)', marginBottom: 14 };

const rowStyle = (last: boolean) => ({
  padding: '11px 14px',
  gap: 10,
  borderBottom: last ? undefined : '1px solid var(--line-soft)',
});

/** A season's name over its part of the sheet; the first one needs no gap above it. */
function SeasonLabel({ name, first }: { name: string; first: boolean }) {
  return (
    <div className="section-label" style={first ? { marginTop: 0 } : undefined}>
      {name}
    </div>
  );
}

/**
 * Confirms a ghosting, showing exactly who takes on what before anything
 * changes. Also writes off a balance someone was removed with, which is the
 * same thing for a player who's already gone.
 *
 * Debts never cross seasons, so a balance in more than one season is shown —
 * and written off — a season at a time.
 */
export function GhostSheet({
  playerId,
  onClose,
  onDone,
}: {
  playerId: ID;
  onClose: () => void;
  /** Called after confirming, instead of `onClose`. */
  onDone?: () => void;
}) {
  const ledger = useStore((s) => s.ledger);
  const ghostPlayer = useStore((s) => s.ghostPlayer);
  const parts = useMemo(() => planGhosting(ledger, playerId), [ledger, playerId]);
  const player = ledger.players.find((p) => p.id === playerId);
  if (!player) return null;

  const name = player.name;
  const removed = Boolean(player.deleted);

  return (
    <Sheet title={removed ? `Write off ${name}'s balance?` : `Mark ${name} as ghosted?`} onClose={onClose}>
      {parts.length === 0 ? (
        <p style={introStyle}>{name} is square, so there&apos;s nothing to write off.</p>
      ) : (
        parts.map(({ season, plan }, i) => (
          <div key={season?.id ?? 'all'}>
            {season ? <SeasonLabel name={season.name} first={i === 0} /> : null}
            <PlanView plan={plan} name={name} removed={removed} brief={i > 0} />
          </div>
        ))
      )}

      {!removed ? (
        <p className="hint" style={{ marginBottom: 16 }}>
          {name} stays on the leaderboard and starts switched off in new sessions. If they come
          back, unghost them to put all of this back.
        </p>
      ) : null}

      <div className="row" style={{ gap: 8 }}>
        <button className="btn grow" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary grow"
          onClick={() => {
            ghostPlayer(playerId);
            (onDone ?? onClose)();
          }}
        >
          {removed ? 'Write it off' : 'Mark as ghosted'}
        </button>
      </div>
    </Sheet>
  );
}

/** One season's write-off: what they owe or are owed, and who takes how much of it. */
function PlanView({
  plan,
  name,
  removed,
  brief,
}: {
  plan: WriteOffPlan;
  name: string;
  removed: boolean;
  /** Skip explaining the split again for a second season. */
  brief: boolean;
}) {
  const { target, shares, unplaced } = plan;
  const owes = target.outstanding < 0;
  const amount = <Money cents={Math.abs(target.outstanding)} colored={false} />;

  return (
    <>
      <p style={introStyle}>
        {owes ? (
          <>
            {name} {removed ? 'was removed still owing' : 'owes'} {amount}.
            {brief ? null : (
              <>
                {' '}
                It&apos;s written off, and the people {name} owes take it on in proportion to what
                each is owed:
              </>
            )}
          </>
        ) : (
          <>
            {name} {removed ? 'was removed still owed' : 'is owed'} {amount}.
            {brief ? null : (
              <>
                {' '}
                It&apos;s written off, and the people who owe money keep that much, in proportion
                to what each owes:
              </>
            )}
          </>
        )}
      </p>

      {shares.length > 0 ? (
        <div className="card" style={{ marginBottom: 14 }}>
          {shares.map((share, i) => {
            const before = Math.abs(share.balance.outstanding);
            const who = share.balance.player;
            return (
              <div key={who.id} className="row" style={rowStyle(i === shares.length - 1)}>
                <Avatar name={who.name} color={who.color} size="sm" />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 620 }} className="truncate">
                    {who.name}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>
                    {owes ? 'owed' : 'owes'} <Money cents={before} colored={false} /> →{' '}
                    <Money cents={before - share.amount} colored={false} />
                  </div>
                </div>
                <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                  {owes ? 'takes' : 'keeps'}{' '}
                  <Money cents={share.amount} colored={false} className={owes ? 'loss' : 'win'} />
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      {unplaced > 0 ? (
        <div className="banner banner-warn" style={{ marginBottom: 14 }}>
          <span>⚠️</span>
          <span>
            <Money cents={unplaced} colored={false} /> of it can&apos;t be placed: nobody else{' '}
            {owes ? 'is owed' : 'owes'} enough to cover it, which usually means a session&apos;s
            cash-outs don&apos;t match its buy-ins. It stays on {name}&apos;s balance.
          </span>
        </div>
      ) : null}
    </>
  );
}

/** Confirms bringing a ghosted player back, showing what goes back on whose balance. */
export function UnghostSheet({
  playerId,
  onClose,
  onDone,
}: {
  playerId: ID;
  onClose: () => void;
  /** Called after confirming, instead of `onClose`. */
  onDone?: () => void;
}) {
  const ledger = useStore((s) => s.ledger);
  const unghostPlayer = useStore((s) => s.unghostPlayer);
  const records = useMemo(() => standingWriteOffs(ledger, playerId), [ledger, playerId]);
  const player = ledger.players.find((p) => p.id === playerId);
  if (!player) return null;

  const byId = new Map(ledger.players.map((p) => [p.id, p]));
  const seasons = seasonsOf(ledger);
  const name = player.name;

  return (
    <Sheet title={`Unghost ${name}?`} onClose={onClose}>
      {records.length === 0 ? (
        <p style={introStyle}>
          {name} was square when they were ghosted, so nobody&apos;s balance changes.
        </p>
      ) : (
        records.map((record, i) => {
          const season = seasons.find((s) => s.id === record.season);
          const total = <Money cents={record.total} colored={false} />;
          return (
            <div key={`${record.at}:${record.season ?? ''}`}>
              {season ? <SeasonLabel name={season.name} first={i === 0} /> : null}
              <p style={introStyle}>
                {record.debt ? (
                  <>
                    {name} owes {total} again, and the people who took it on are owed their share
                    again:
                  </>
                ) : (
                  <>
                    {name} is owed {total} again, and the people who kept it owe their share again:
                  </>
                )}
              </p>
              <div className="card" style={{ marginBottom: 14 }}>
                {record.parts.map((part, j) => {
                  const who = byId.get(sharer(part));
                  return (
                    <div key={part.id} className="row" style={rowStyle(j === record.parts.length - 1)}>
                      <Avatar name={who?.name ?? '?'} color={who?.color ?? '#44615a'} size="sm" />
                      <span className="grow truncate" style={{ fontSize: 14, fontWeight: 620 }}>
                        {who?.name ?? 'Someone'}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                        {record.debt ? 'owed' : 'owes'} <Money cents={part.amount} colored={false} />{' '}
                        more
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      <p className="hint" style={{ marginBottom: 16 }}>
        {name} starts switched on in new sessions again. If they&apos;ve paid anything, record it
        as a payment once they&apos;re back.
      </p>

      <div className="row" style={{ gap: 8 }}>
        <button className="btn grow" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary grow"
          onClick={() => {
            unghostPlayer(playerId);
            (onDone ?? onClose)();
          }}
        >
          Unghost
        </button>
      </div>
    </Sheet>
  );
}
