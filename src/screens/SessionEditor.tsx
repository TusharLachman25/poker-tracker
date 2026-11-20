import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Avatar, Confirm, Field, Money, todayISO } from '../components/ui';
import { BackIcon, HandshakeIcon, TrashIcon } from '../components/icons';
import { parseMoney, toInput } from '../lib/money';
import { activePlayers, isLive } from '../lib/stats';
import { newId, useStore } from '../lib/store';
import { GAME_LABELS, type Entry, type GameType, type Player, type Session } from '../lib/types';
import { SettleSheet } from './SettleSheet';

/** Per-row state is kept as raw strings so typing "1", "12", "12." never fights the parser. */
interface Row {
  playerId: string;
  active: boolean;
  buyIn: string;
  cashOut: string;
}

export function SessionEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const ledger = useStore((s) => s.ledger);
  const saveSession = useStore((s) => s.saveSession);
  const deleteSession = useStore((s) => s.deleteSession);

  const isNew = id === 'new';
  const existing = useMemo(
    () => (isNew ? undefined : ledger.sessions.find((s) => s.id === id && !s.deleted)),
    [ledger.sessions, id, isNew],
  );

  const players = useMemo(() => {
    const everyone = activePlayers(ledger);
    // Ghosted players sink to the bottom: they're rarely at the table any more.
    return [...everyone.filter((p) => !p.ghostedAt), ...everyone.filter((p) => p.ghostedAt)];
  }, [ledger]);

  const [date, setDate] = useState(existing?.date ?? todayISO());
  const [name, setName] = useState(existing?.name ?? '');
  const [location, setLocation] = useState(existing?.location ?? '');
  const [gameType, setGameType] = useState<GameType>(existing?.gameType ?? 'nlh');
  const { defaultBuyIn, defaultStakes } = ledger.settings;
  const [stakes, setStakes] = useState(existing?.stakes ?? defaultStakes);
  const [hours, setHours] = useState(
    existing?.durationMins ? String(existing.durationMins / 60) : '',
  );
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [settling, setSettling] = useState(false);

  const [rows, setRows] = useState<Row[]>(() =>
    players.map((p) => {
      const entry = existing?.entries.find((e) => e.playerId === p.id);
      // On a new session everyone starts switched on — the usual case is
      // "the regulars played" and toggling off is faster than toggling on.
      // Ghosted players are the exception: they've stopped coming.
      const active = existing ? Boolean(entry) : !p.ghostedAt;
      return {
        playerId: p.id,
        active,
        // A new session starts everyone at one standard buy-in, so a normal
        // night only needs the cash-outs typed in.
        buyIn: entry ? toInput(entry.buyIn) : active ? toInput(defaultBuyIn) : '',
        cashOut: entry ? toInput(entry.cashOut) : '',
      };
    }),
  );

  // Results from players who have since been removed. They can't be edited,
  // but they're part of the night: they count towards its totals and are
  // saved back untouched, so editing an old session never deletes them.
  // Anyone with a row of their own is left out, so nobody is counted twice.
  const removed = useMemo(() => {
    if (!existing) return [];
    const editable = new Set(rows.map((r) => r.playerId));
    return existing.entries.filter((e) => isLive(e) && !editable.has(e.playerId));
  }, [existing, rows]);

  const patch = (playerId: string, change: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.playerId === playerId ? { ...r, ...change } : r)));

  /** Toggling someone in mid-edit gives them a buy-in too, if they have none. */
  function toggleActive(row: Row) {
    patch(row.playerId, {
      active: !row.active,
      buyIn: !row.active && row.buyIn === '' ? toInput(defaultBuyIn) : row.buyIn,
    });
  }

  /** Another bullet. Rebuys are constant at small stakes, so this is one tap. */
  function addBuyIn(row: Row, multiple: number) {
    const next = Math.max(0, parseMoney(row.buyIn) + defaultBuyIn * multiple);
    patch(row.playerId, { buyIn: toInput(next) });
  }

  const live = useMemo(
    () =>
      rows
        .filter((r) => r.active)
        .map((r) => ({
          playerId: r.playerId,
          buyIn: parseMoney(r.buyIn),
          cashOut: parseMoney(r.cashOut),
        })),
    [rows],
  );

  const totals = useMemo(() => {
    const all = [...live, ...removed];
    const buyIn = all.reduce((sum, e) => sum + e.buyIn, 0);
    const cashOut = all.reduce((sum, e) => sum + e.cashOut, 0);
    return { buyIn, cashOut, diff: cashOut - buyIn };
  }, [live, removed]);

  const playing = live.filter((e) => e.buyIn !== 0 || e.cashOut !== 0);
  const seated = playing.length + removed.length;
  const canSave = seated > 0 && Boolean(date);

  // With buy-ins pre-filled, a fresh session would otherwise open showing a
  // loss on every row and a "doesn't balance" warning. Neither is true yet —
  // the results just haven't been entered. Hold both back until they are.
  const scoring = rows.some((r) => r.active && r.cashOut.trim() !== '');

  const positions = useMemo(() => {
    // Every player ever, so a removed player's result still has a name.
    const byId = new Map(ledger.players.map((p) => [p.id, p]));
    return [...playing, ...removed]
      .map((e) => ({ player: byId.get(e.playerId), net: e.cashOut - e.buyIn }))
      .filter((p): p is { player: Player; net: number } => p.player !== undefined);
  }, [playing, removed, ledger.players]);

  function handleSave() {
    const entries: Entry[] = [
      ...live.map((e) => ({
        playerId: e.playerId,
        buyIn: e.buyIn,
        cashOut: e.cashOut,
      })),
      ...removed.map((e) => ({ ...e })),
    ];

    const parsedHours = Number(hours);
    const session: Session = {
      id: existing?.id ?? newId(),
      date,
      name: name.trim() || undefined,
      location: location.trim() || undefined,
      gameType,
      stakes: stakes.trim() || undefined,
      durationMins:
        hours.trim() !== '' && Number.isFinite(parsedHours) && parsedHours > 0
          ? Math.round(parsedHours * 60)
          : undefined,
      notes: notes.trim() || undefined,
      entries,
      updatedAt: Date.now(),
    };

    saveSession(session);
    navigate('/sessions', { replace: true });
  }

  if (!isNew && !existing) {
    return (
      <div className="page">
        <p className="hint">That session no longer exists.</p>
        <button className="btn" style={{ marginTop: 12 }} onClick={() => navigate('/sessions')}>
          Back to sessions
        </button>
      </div>
    );
  }

  if (players.length === 0) {
    return (
      <div className="page">
        <p className="hint">Add some players before logging a session.</p>
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => navigate('/players')}>
          Add players
        </button>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn btn-ghost btn-icon" onClick={() => navigate(-1)} aria-label="Back">
          <BackIcon />
        </button>
        <h2 className="grow" style={{ fontSize: 18 }}>
          {isNew ? 'New session' : 'Edit session'}
        </h2>
        {existing ? (
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => setConfirmDelete(true)}
            aria-label="Delete session"
            style={{ color: 'var(--loss)' }}
          >
            <TrashIcon />
          </button>
        ) : null}
      </div>

      <div className="card card-pad stack" style={{ marginBottom: 14 }}>
        <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
          <div className="grow">
            <Field label="Date">
              <input
                className="input"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
          </div>
          <div className="grow">
            <Field label="Hours played">
              <input
                className="input input-money"
                inputMode="decimal"
                placeholder="optional"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
            </Field>
          </div>
        </div>

        <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
          <div className="grow">
            <Field label="Game">
              <select
                className="input"
                value={gameType}
                onChange={(e) => setGameType(e.target.value as GameType)}
              >
                {(Object.keys(GAME_LABELS) as GameType[]).map((key) => (
                  <option key={key} value={key}>
                    {GAME_LABELS[key]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grow">
            <Field label="Stakes">
              <input
                className="input"
                placeholder="1/2"
                value={stakes}
                onChange={(e) => setStakes(e.target.value)}
              />
            </Field>
          </div>
        </div>

        <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
          <div className="grow">
            <Field label="Name">
              <input
                className="input"
                placeholder="optional"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          </div>
          <div className="grow">
            <Field label="Where">
              <input
                className="input"
                placeholder="optional"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </Field>
          </div>
        </div>
      </div>

      <div className="section-label">Who played</div>
      <div className="card">
        <div
          className="row"
          style={{
            padding: '9px 14px',
            borderBottom: '1px solid var(--line-soft)',
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--text-faint)',
          }}
        >
          <span className="grow">Player</span>
          <span style={{ width: 78, textAlign: 'right' }}>Buy-in</span>
          <span style={{ width: 78, textAlign: 'right' }}>Cash-out</span>
        </div>

        {rows.map((row) => {
          const player = players.find((p) => p.id === row.playerId);
          if (!player) return null;
          const buyIn = parseMoney(row.buyIn);
          const net = parseMoney(row.cashOut) - buyIn;
          const touched = row.cashOut.trim() !== '';
          // Whole multiples of the standard buy-in read as "3 buy-ins";
          // an odd amount (a short stack, a partial rebuy) just shows the money.
          const bullets =
            defaultBuyIn > 0 && buyIn > 0 && buyIn % defaultBuyIn === 0 ? buyIn / defaultBuyIn : 0;

          return (
            <div
              key={row.playerId}
              style={{
                padding: '10px 14px',
                borderBottom: '1px solid var(--line-soft)',
                opacity: row.active ? 1 : 0.42,
              }}
            >
              <div className="row">
                <button
                  onClick={() => toggleActive(row)}
                  aria-label={row.active ? `Remove ${player.name}` : `Add ${player.name}`}
                  aria-pressed={row.active}
                  style={{
                    border: 0,
                    background: 'transparent',
                    padding: 0,
                    cursor: 'pointer',
                    display: 'flex',
                  }}
                >
                  <Avatar name={player.name} color={row.active ? player.color : '#44615a'} size="sm" />
                </button>

                <span className="grow truncate" style={{ fontSize: 14, fontWeight: 600 }}>
                  {player.name}
                  {player.ghostedAt ? ' 👻' : ''}
                </span>

                <input
                  className="input input-money"
                  style={{ width: 78, padding: '8px 9px' }}
                  inputMode="decimal"
                  placeholder="0"
                  value={row.buyIn}
                  disabled={!row.active}
                  onChange={(e) => patch(row.playerId, { buyIn: e.target.value })}
                />
                <input
                  className="input input-money"
                  style={{ width: 78, padding: '8px 9px' }}
                  inputMode="decimal"
                  placeholder="0"
                  value={row.cashOut}
                  disabled={!row.active}
                  onChange={(e) => patch(row.playerId, { cashOut: e.target.value })}
                />
              </div>

              {row.active ? (
                <div className="row" style={{ marginTop: 6, gap: 6 }}>
                  <button
                    className="btn btn-sm"
                    style={{ padding: '4px 9px', fontSize: 12 }}
                    onClick={() => addBuyIn(row, 1)}
                    aria-label={`Add a buy-in for ${player.name}`}
                  >
                    + buy-in
                  </button>
                  {bullets > 1 ? (
                    <button
                      className="btn btn-sm btn-ghost"
                      style={{ padding: '4px 7px', fontSize: 12 }}
                      onClick={() => addBuyIn(row, -1)}
                      aria-label={`Remove a buy-in for ${player.name}`}
                    >
                      −
                    </button>
                  ) : null}
                  <span className="grow" style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
                    {bullets > 1 ? `${bullets} buy-ins` : ''}
                  </span>
                  {touched ? (
                    <span style={{ fontSize: 12 }}>
                      <Money cents={net} signed />
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}

        {removed.map((e) => {
          const who = ledger.players.find((p) => p.id === e.playerId);
          return (
            <div
              key={e.playerId}
              className="row"
              style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-soft)' }}
            >
              <Avatar name={who?.name ?? '?'} color="#44615a" size="sm" />
              <span className="grow truncate" style={{ fontSize: 14, fontWeight: 600 }}>
                {who?.name ?? 'Removed player'}
                <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--text-faint)' }}>
                  {' '}
                  · removed
                </span>
              </span>
              <span style={{ width: 78, textAlign: 'right' }}>
                <Money cents={e.buyIn} colored={false} />
              </span>
              <span style={{ width: 78, textAlign: 'right' }}>
                <Money cents={e.cashOut} colored={false} />
              </span>
            </div>
          );
        })}

        <div className="row" style={{ padding: '12px 14px' }}>
          <span className="grow" style={{ fontSize: 13, fontWeight: 650, color: 'var(--text-dim)' }}>
            Totals
          </span>
          <span style={{ width: 78, textAlign: 'right' }}>
            <Money cents={totals.buyIn} colored={false} />
          </span>
          <span style={{ width: 78, textAlign: 'right' }}>
            <Money cents={totals.cashOut} colored={false} />
          </span>
        </div>
      </div>

      {totals.diff !== 0 && seated > 0 && scoring ? (
        <div className="banner banner-warn" style={{ marginTop: 12 }}>
          <span>⚠️</span>
          <span>
            Cash-outs are <Money cents={Math.abs(totals.diff)} colored={false} />{' '}
            {totals.diff > 0 ? 'more' : 'less'} than buy-ins. Chips can&apos;t appear or vanish, so
            something&apos;s mistyped — you can still save, but the totals will be off.
          </span>
        </div>
      ) : null}

      {totals.diff === 0 && seated > 1 && scoring ? (
        <div className="banner banner-ok" style={{ marginTop: 12 }}>
          <span>✓</span>
          <span>The table balances.</span>
        </div>
      ) : null}

      <div className="section-label">Notes</div>
      <textarea
        className="input"
        placeholder="Bad beats, house rules, who owes what…"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      <div className="stack-sm" style={{ marginTop: 16 }}>
        <button className="btn btn-primary btn-block" onClick={handleSave} disabled={!canSave}>
          {isNew ? 'Save session' : 'Save changes'}
        </button>
        {positions.length > 1 ? (
          <button className="btn btn-block" onClick={() => setSettling(true)}>
            <HandshakeIcon />
            Settle this night
          </button>
        ) : null}
      </div>

      {settling ? (
        <SettleSheet stats={positions} title="Settle this night" onClose={() => setSettling(false)} />
      ) : null}

      {confirmDelete && existing ? (
        <Confirm
          title="Delete this session?"
          body="It comes out of everyone's running totals. This can't be undone."
          onConfirm={() => {
            deleteSession(existing.id);
            navigate('/sessions', { replace: true });
          }}
          onClose={() => setConfirmDelete(false)}
        />
      ) : null}
    </div>
  );
}
