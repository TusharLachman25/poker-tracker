import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, EmptyState } from '../components/ui';
import { BackIcon } from '../components/icons';
import { ACTION_LABELS, NOTABLE } from '../lib/activity';
import { useStore } from '../lib/store';
import type { Activity as ActivityEntry } from '../lib/types';

export function Activity() {
  const navigate = useNavigate();
  const ledger = useStore((s) => s.ledger);
  const [onlyEdits, setOnlyEdits] = useState(false);

  const byId = useMemo(() => new Map(ledger.players.map((p) => [p.id, p])), [ledger.players]);

  const entries = useMemo(() => {
    const all = [...(ledger.activity ?? [])].sort((a, b) => b.at - a.at);
    return onlyEdits ? all.filter((a) => NOTABLE.has(a.action)) : all;
  }, [ledger.activity, onlyEdits]);

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn btn-ghost btn-icon" onClick={() => navigate(-1)} aria-label="Back">
          <BackIcon />
        </button>
        <h2 className="grow" style={{ fontSize: 18 }}>
          Group activity
        </h2>
      </div>

      <div className="row" style={{ gap: 6, marginBottom: 12 }}>
        <button
          className={`btn btn-sm ${onlyEdits ? '' : 'btn-primary'}`.trim()}
          onClick={() => setOnlyEdits(false)}
        >
          Everything
        </button>
        <button
          className={`btn btn-sm ${onlyEdits ? 'btn-primary' : ''}`.trim()}
          onClick={() => setOnlyEdits(true)}
        >
          Edits &amp; deletions
        </button>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon="📜"
          title={onlyEdits ? 'Nothing has been changed' : 'Nothing logged yet'}
          body={
            onlyEdits
              ? 'No sessions or payments have been edited or deleted.'
              : 'Every session, payment and player change shows up here, with who made it.'
          }
        />
      ) : (
        <div className="card">
          {entries.map((item, i) => (
            <Row
              key={item.id}
              item={item}
              color={item.actorId ? byId.get(item.actorId)?.color : undefined}
              last={i === entries.length - 1}
            />
          ))}
        </div>
      )}

      <p className="hint" style={{ marginTop: 12 }}>
        Entries are recorded on the device that made the change and sync to everyone. They say who
        the device is set to in Settings, so treat this as a record for an honest group — it answers
        &quot;who changed my numbers?&quot;, not much more.
      </p>
    </div>
  );
}

function Row({
  item,
  color,
  last,
}: {
  item: ActivityEntry;
  color?: string;
  last: boolean;
}) {
  const notable = NOTABLE.has(item.action);

  return (
    <div
      style={{
        padding: '12px 14px',
        borderBottom: last ? undefined : '1px solid var(--line-soft)',
      }}
    >
      <div className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
        <Avatar name={item.actorName} color={color ?? '#44615a'} size="sm" />
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.4 }}>
            <span>{item.actorName}</span>{' '}
            <span style={{ color: notable ? 'var(--gold)' : 'var(--text-dim)', fontWeight: 600 }}>
              {ACTION_LABELS[item.action]}
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 3 }}>
            {item.summary}
          </div>
          {/* Gold is reserved for numbers that moved. A payment note is just a
              note, so it stays quiet. */}
          {item.detail ? (
            <div
              style={
                notable
                  ? {
                      fontSize: 12,
                      color: 'var(--gold)',
                      marginTop: 5,
                      padding: '6px 9px',
                      background: 'rgba(227, 179, 65, 0.08)',
                      border: '1px solid rgba(227, 179, 65, 0.2)',
                      borderRadius: 'var(--radius-sm)',
                      lineHeight: 1.5,
                    }
                  : { fontSize: 12, color: 'var(--text-faint)', marginTop: 3, lineHeight: 1.5 }
              }
            >
              {item.detail}
            </div>
          ) : null}
        </div>
        <span
          style={{ fontSize: 11, color: 'var(--text-faint)', whiteSpace: 'nowrap', flex: '0 0 auto' }}
        >
          {when(item.at)}
        </span>
      </div>
    </div>
  );
}

/** Relative for anything recent, then a plain date. */
function when(at: number): string {
  const mins = Math.round((Date.now() - at) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
