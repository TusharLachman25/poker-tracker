import { useMemo } from 'react';
import { Avatar, Money, Sheet } from '../components/ui';
import { settle } from '../lib/settle';
import type { Player } from '../lib/types';

/**
 * Turns a set of net positions into the shortest list of payments that
 * squares everyone up. Used both for a single night and for all-time balances.
 */
export function SettleSheet({
  stats,
  title = 'Settle up',
  onClose,
}: {
  stats: { player: Player; net: number }[];
  title?: string;
  onClose: () => void;
}) {
  const byId = useMemo(() => new Map(stats.map((s) => [s.player.id, s.player])), [stats]);

  const { transfers, leftover } = useMemo(
    () => settle(new Map(stats.map((s) => [s.player.id, s.net]))),
    [stats],
  );

  return (
    <Sheet title={title} onClose={onClose}>
      {transfers.length === 0 ? (
        <p style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.6 }}>
          Everyone&apos;s square — nothing to pay.
        </p>
      ) : (
        <>
          <p className="hint" style={{ marginBottom: 14 }}>
            {transfers.length} payment{transfers.length === 1 ? '' : 's'} clears everyone.
          </p>

          <div className="card">
            {transfers.map((t, i) => {
              const from = byId.get(t.from);
              const to = byId.get(t.to);
              if (!from || !to) return null;
              return (
                <div
                  key={i}
                  className="row"
                  style={{
                    padding: '12px 14px',
                    borderBottom: i < transfers.length - 1 ? '1px solid var(--line-soft)' : undefined,
                    gap: 9,
                  }}
                >
                  <Avatar name={from.name} color={from.color} size="sm" />
                  <span style={{ fontSize: 14, fontWeight: 620 }} className="truncate">
                    {from.name}
                  </span>
                  <span style={{ color: 'var(--text-faint)', fontSize: 15 }}>→</span>
                  <Avatar name={to.name} color={to.color} size="sm" />
                  <span style={{ fontSize: 14, fontWeight: 620 }} className="truncate grow">
                    {to.name}
                  </span>
                  <Money cents={t.amount} colored={false} />
                </div>
              );
            })}
          </div>
        </>
      )}

      {leftover !== 0 ? (
        <div className="banner banner-warn" style={{ marginTop: 14 }}>
          <span>⚠️</span>
          <span>
            The books are out by <Money cents={Math.abs(leftover)} colored={false} />. That means a
            session&apos;s cash-outs don&apos;t add up to its buy-ins — check the session totals.
          </span>
        </div>
      ) : null}

      <button className="btn btn-block" style={{ marginTop: 14 }} onClick={onClose}>
        Done
      </button>
    </Sheet>
  );
}
