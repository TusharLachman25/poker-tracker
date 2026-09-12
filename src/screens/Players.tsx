import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, Confirm, EmptyState, Field, Money, Sheet } from '../components/ui';
import { ChevronIcon, PlusIcon } from '../components/icons';
import { computeStats } from '../lib/stats';
import { PALETTE, useStore } from '../lib/store';
import type { Player } from '../lib/types';

export function Players() {
  const ledger = useStore((s) => s.ledger);
  const addPlayer = useStore((s) => s.addPlayer);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Player | null>(null);
  const [draft, setDraft] = useState('');

  const stats = useMemo(() => computeStats(ledger), [ledger]);
  const players = ledger.players.filter((p) => !p.deleted);

  function submitNew() {
    const name = draft.trim();
    if (!name) return;
    addPlayer(name);
    setDraft('');
    // Stay open — adding the whole group in one go is the common case.
  }

  return (
    <div className="page">
      {players.length === 0 ? (
        <EmptyState
          icon="👥"
          title="No players yet"
          body="Add everyone who sits at your table. You can rename or remove them later."
          action={
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <PlusIcon />
              Add a player
            </button>
          }
        />
      ) : (
        <>
          <div className="card">
            {stats.map((s) => (
              <Link key={s.player.id} className="lb-row" to={`/players/${s.player.id}`}>
                <Avatar name={s.player.name} color={s.player.color} />
                <span className="grow">
                  <div className="lb-name">{s.player.name}</div>
                  <div className="lb-meta">
                    {s.sessions === 0
                      ? 'No sessions yet'
                      : `${s.sessions} session${s.sessions === 1 ? '' : 's'}`}
                  </div>
                </span>
                {s.sessions > 0 ? <Money cents={s.net} signed /> : null}
                <ChevronIcon />
              </Link>
            ))}
          </div>

          <button className="btn btn-block" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
            <PlusIcon />
            Add a player
          </button>
        </>
      )}

      {adding ? (
        <Sheet
          title="Add players"
          onClose={() => {
            setAdding(false);
            setDraft('');
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitNew();
            }}
          >
            <Field label="Name" hint="Add them one at a time — the list updates as you go.">
              <input
                className="input"
                autoFocus
                placeholder="e.g. Dev"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </Field>
            <button
              className="btn btn-primary btn-block"
              style={{ marginTop: 12 }}
              type="submit"
              disabled={!draft.trim()}
            >
              Add
            </button>
          </form>

          {players.length > 0 ? (
            <>
              <div className="section-label">In your game</div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 7 }}>
                {players.map((p) => (
                  <button
                    key={p.id}
                    className="pill"
                    onClick={() => {
                      setEditing(p);
                      setAdding(false);
                    }}
                  >
                    <span
                      style={{ width: 8, height: 8, borderRadius: 999, background: p.color }}
                    />
                    {p.name}
                  </button>
                ))}
              </div>
            </>
          ) : null}

          <button
            className="btn btn-block"
            style={{ marginTop: 16 }}
            onClick={() => {
              setAdding(false);
              setDraft('');
            }}
          >
            Done
          </button>
        </Sheet>
      ) : null}

      {editing ? <EditPlayerSheet player={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

export function EditPlayerSheet({ player, onClose }: { player: Player; onClose: () => void }) {
  const renamePlayer = useStore((s) => s.renamePlayer);
  const recolorPlayer = useStore((s) => s.recolorPlayer);
  const deletePlayer = useStore((s) => s.deletePlayer);
  const [name, setName] = useState(player.name);
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <Confirm
        title={`Remove ${player.name}?`}
        body="They come off the leaderboard, but past sessions keep their results so nobody else's totals shift."
        confirmLabel="Remove"
        onConfirm={() => {
          deletePlayer(player.id);
          onClose();
        }}
        onClose={() => setConfirming(false)}
      />
    );
  }

  return (
    <Sheet title="Edit player" onClose={onClose}>
      <div className="stack">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <div className="field">
          <label>Colour</label>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {PALETTE.map((color) => (
              <button
                key={color}
                aria-label={`Use colour ${color}`}
                onClick={() => recolorPlayer(player.id, color)}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 999,
                  background: color,
                  border:
                    player.color === color ? '2.5px solid var(--text)' : '2.5px solid transparent',
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            ))}
          </div>
        </div>

        <button
          className="btn btn-primary btn-block"
          onClick={() => {
            if (name.trim()) renamePlayer(player.id, name);
            onClose();
          }}
          disabled={!name.trim()}
        >
          Save
        </button>

        <button className="btn btn-danger btn-block" onClick={() => setConfirming(true)}>
          Remove from game
        </button>
      </div>
    </Sheet>
  );
}
