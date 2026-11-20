import { useMemo } from 'react';
import { Avatar, Money, Sheet } from '../components/ui';
import { planWriteOff, sharer, standingWriteOff } from '../lib/ghost';
import { useStore } from '../lib/store';
import type { ID } from '../lib/types';

const rowStyle = (last: boolean) => ({
  padding: '11px 14px',
  gap: 10,
  borderBottom: last ? undefined : '1px solid var(--line-soft)',
});

/**
 * Confirms a ghosting, showing exactly who takes on what before anything
 * changes. Also writes off a balance someone was removed with, which is the
 * same thing for a player who's already gone.
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
  const plan = useMemo(() => planWriteOff(ledger, playerId), [ledger, playerId]);
  if (!plan) return null;

  const { target, shares, unplaced } = plan;
  const name = target.player.name;
  const removed = Boolean(target.player.deleted);
  const owes = target.outstanding < 0;
  const amount = <Money cents={Math.abs(target.outstanding)} colored={false} />;

  return (
    <Sheet title={removed ? `Write off ${name}'s balance?` : `Mark ${name} as ghosted?`} onClose={onClose}>
      <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-dim)', marginBottom: 14 }}>
        {target.outstanding === 0 ? (
          <>{name} is square, so there&apos;s nothing to write off.</>
        ) : owes ? (
          <>
            {name} {removed ? 'was removed still owing' : 'owes'} {amount}. It&apos;s written off,
            and the people {name} owes take it on in proportion to what each is owed:
          </>
        ) : (
          <>
            {name} {removed ? 'was removed still owed' : 'is owed'} {amount}. It&apos;s written
            off, and the people who owe money keep that much, in proportion to what each owes:
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
  const record = useMemo(() => standingWriteOff(ledger, playerId), [ledger, playerId]);
  const player = ledger.players.find((p) => p.id === playerId);
  if (!player) return null;

  const byId = new Map(ledger.players.map((p) => [p.id, p]));
  const name = player.name;

  return (
    <Sheet title={`Unghost ${name}?`} onClose={onClose}>
      <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-dim)', marginBottom: 14 }}>
        {!record ? (
          <>{name} was square when they were ghosted, so nobody&apos;s balance changes.</>
        ) : record.debt ? (
          <>
            This puts back the <Money cents={record.total} colored={false} /> that was written off.{' '}
            {name} owes it again, and the people who took it on are owed their share again:
          </>
        ) : (
          <>
            This puts back the <Money cents={record.total} colored={false} /> that was written off.{' '}
            {name} is owed it again, and the people who kept it owe their share again:
          </>
        )}
      </p>

      {record ? (
        <div className="card" style={{ marginBottom: 14 }}>
          {record.parts.map((part, i) => {
            const who = byId.get(sharer(part));
            return (
              <div key={part.id} className="row" style={rowStyle(i === record.parts.length - 1)}>
                <Avatar name={who?.name ?? '?'} color={who?.color ?? '#44615a'} size="sm" />
                <span className="grow truncate" style={{ fontSize: 14, fontWeight: 620 }}>
                  {who?.name ?? 'Someone'}
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                  {record.debt ? 'owed' : 'owes'} <Money cents={part.amount} colored={false} /> more
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

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
