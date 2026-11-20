import { useMemo, useState } from 'react';
import { SeasonTabs } from '../components/SeasonTabs';
import { Avatar, Confirm, EmptyState, Field, Money, Sheet, formatDate, todayISO } from '../components/ui';
import { CashIcon, PlusIcon, TrashIcon } from '../components/icons';
import { sharer, writeOffRecords, type WriteOffRecord } from '../lib/ghost';
import { parseMoney, toInput } from '../lib/money';
import { settle } from '../lib/settle';
import { activePayments, computeBalances, removedBalances, totalPaid } from '../lib/stats';
import { newId, useStore } from '../lib/store';
import type { Balance, ID, Payment, Season } from '../lib/types';
import { useSeason } from '../lib/useSeason';
import { GhostSheet } from './GhostSheet';

type HistoryItem =
  | { kind: 'payment'; key: string; date: string; at: number; payment: Payment }
  | { kind: 'writeoff'; key: string; date: string; at: number; record: WriteOffRecord };

/**
 * Payments and write-offs in one list, newest first. A write-off is one line
 * however many people shared it — it was one decision, not several payments.
 */
function historyOf(payments: Payment[]): HistoryItem[] {
  const items: HistoryItem[] = [
    ...payments
      .filter((p) => !p.writeOff)
      .map((p) => ({ kind: 'payment' as const, key: p.id, date: p.date, at: p.updatedAt, payment: p })),
    ...writeOffRecords(payments).map((r) => ({
      kind: 'writeoff' as const,
      key: `${r.player}:${r.at}:${r.season ?? ''}`,
      date: r.date,
      at: r.at,
      record: r,
    })),
  ];
  return items.sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
}

/** What the "Pay" button on a suggested transfer pre-fills. */
interface Draft {
  from: ID;
  to: ID;
  amount: string;
}

export function Payments() {
  const deletePayment = useStore((s) => s.deletePayment);
  // Debts belong to a season and never carry over, so everything here is one
  // season's: its plan, its standing and its history.
  const { season, isCurrent, ledger } = useSeason({ allTime: false });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirming, setConfirming] = useState<Payment | null>(null);
  const [writingOff, setWritingOff] = useState<ID | null>(null);

  const balances = useMemo(() => computeBalances(ledger), [ledger]);
  const history = useMemo(() => historyOf(activePayments(ledger)), [ledger]);
  const byId = useMemo(() => new Map(ledger.players.map((p) => [p.id, p])), [ledger.players]);
  const removed = useMemo(() => removedBalances(ledger), [ledger]);

  // The plan is built from outstanding amounts, not raw winnings, so anything
  // already handed over has been taken off.
  const { transfers, leftover } = useMemo(
    () => settle(new Map(balances.map((b) => [b.player.id, b.outstanding]))),
    [balances],
  );

  // Someone removed while still owing (or owed) money accounts for that much
  // of any shortfall. Only what's left after them is a session that doesn't
  // add up.
  const fromRemoved = removed.reduce((sum, b) => sum - b.outstanding, 0);
  const typo = leftover - fromRemoved;

  const owing = balances.filter((b) => b.outstanding !== 0);
  const hasPlayers = balances.length > 0;
  const paymentCount = history.filter((item) => item.kind === 'payment').length;
  const writtenOff = history.reduce(
    (sum, item) => sum + (item.kind === 'writeoff' ? item.record.total : 0),
    0,
  );

  if (!hasPlayers) {
    return (
      <div className="page">
        <EmptyState
          icon="💸"
          title="Nothing to settle yet"
          body="Add your players and log a session — whatever people end up owing each other shows up here."
        />
      </div>
    );
  }

  return (
    <div className="page">
      <SeasonTabs allTime={false} />

      {season && !isCurrent ? (
        <div className="banner banner-info" style={{ marginBottom: 12 }}>
          <span>🗂️</span>
          <span>
            Debts from {season.name} stay here — they don&apos;t carry into the new season. If
            someone settles one late, record it here.
          </span>
        </div>
      ) : null}

      {transfers.length === 0 && history.length === 0 && owing.length === 0 ? (
        <EmptyState
          icon="💸"
          title="Everyone's square"
          body={
            isCurrent
              ? 'Nobody owes anybody this season. Log a session and any debts will appear here.'
              : 'Nobody owes anybody. Log a session and any debts will appear here.'
          }
        />
      ) : null}

      {transfers.length > 0 ? (
        <>
          <div className="section-label">Who owes who</div>
          <div className="card">
            {transfers.map((t, i) => {
              const from = byId.get(t.from);
              const to = byId.get(t.to);
              if (!from || !to) return null;
              return (
                <div
                  key={`${t.from}-${t.to}-${i}`}
                  style={{
                    padding: '12px 14px',
                    borderBottom: i < transfers.length - 1 ? '1px solid var(--line-soft)' : undefined,
                  }}
                >
                  <div className="row" style={{ gap: 8 }}>
                    <Avatar name={from.name} color={from.color} size="sm" />
                    <span style={{ fontSize: 14, fontWeight: 620 }} className="truncate">
                      {from.name}
                    </span>
                    <span style={{ color: 'var(--text-faint)' }}>→</span>
                    <Avatar name={to.name} color={to.color} size="sm" />
                    <span style={{ fontSize: 14, fontWeight: 620 }} className="truncate grow">
                      {to.name}
                    </span>
                    <Money cents={t.amount} colored={false} />
                  </div>
                  <button
                    className="btn btn-sm btn-block"
                    style={{ marginTop: 9 }}
                    onClick={() => setDraft({ from: t.from, to: t.to, amount: toInput(t.amount) })}
                  >
                    <CashIcon />
                    Record this payment
                  </button>
                </div>
              );
            })}
          </div>
          <p className="hint" style={{ margin: '8px 2px 0' }}>
            {transfers.length} payment{transfers.length === 1 ? '' : 's'} clears everyone. Recording
            one takes it off these totals — part payments are fine.
          </p>
        </>
      ) : null}

      {leftover !== 0
        ? removed.map((b) => (
            <div key={b.player.id} className="banner banner-warn" style={{ marginTop: 12 }}>
              <span>⚠️</span>
              <span className="grow">
                {b.player.name} was removed while still {b.outstanding < 0 ? 'owing' : 'owed'}{' '}
                <Money cents={Math.abs(b.outstanding)} colored={false} />, so nobody&apos;s been
                asked to {b.outstanding < 0 ? 'cover it' : 'pay it'}.
                {!b.player.ghostedAt ? (
                  <>
                    {' '}
                    Write it off to share it out, the same way as ghosting.
                    <button
                      className="btn btn-sm btn-block"
                      style={{ marginTop: 8 }}
                      onClick={() => setWritingOff(b.player.id)}
                    >
                      Write it off
                    </button>
                  </>
                ) : null}
              </span>
            </div>
          ))
        : null}

      {typo !== 0 ? (
        <div className="banner banner-warn" style={{ marginTop: 12 }}>
          <span>⚠️</span>
          <span>
            The books are out by <Money cents={Math.abs(typo)} colored={false} />, so a
            session&apos;s cash-outs don&apos;t match its buy-ins. Fix that session and this will
            square up.
          </span>
        </div>
      ) : null}

      {owing.length > 0 ? (
        <>
          <div className="section-label">Standing</div>
          <div className="card">
            {owing.map((b) => (
              <BalanceRow key={b.player.id} balance={b} />
            ))}
          </div>
        </>
      ) : null}

      <button
        className="btn btn-primary btn-block"
        style={{ marginTop: 14 }}
        onClick={() => setDraft({ from: '', to: '', amount: '' })}
      >
        <PlusIcon />
        Record a payment
      </button>

      {history.length > 0 ? (
        <>
          <div className="section-label">Payment history</div>
          <div className="card">
            {history.map((item, i) => {
              const style = {
                padding: '11px 14px',
                gap: 9,
                borderBottom: i < history.length - 1 ? '1px solid var(--line-soft)' : undefined,
              };

              if (item.kind === 'writeoff') {
                const { record } = item;
                const ghost = byId.get(record.player);
                return (
                  <div key={item.key} className="row" style={style}>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }} className="truncate">
                        👻 {ghost?.name ?? 'Someone'}&apos;s {record.debt ? 'debt' : 'winnings'}{' '}
                        written off
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>
                        {record.date ? formatDate(record.date, { weekday: undefined }) : 'No date'}
                        {record.parts.map((part) => (
                          <span key={part.id}>
                            {' · '}
                            {byId.get(sharer(part))?.name ?? 'Someone'}{' '}
                            <Money cents={part.amount} colored={false} />
                          </span>
                        ))}
                      </div>
                    </div>
                    <Money cents={record.total} colored={false} />
                    {/* Not deletable piecemeal — unghosting undoes the whole thing.
                        The invisible icon keeps the amounts lined up. */}
                    <span
                      className="btn btn-ghost btn-icon"
                      style={{ visibility: 'hidden' }}
                      aria-hidden="true"
                    >
                      <TrashIcon />
                    </span>
                  </div>
                );
              }

              const { payment } = item;
              const from = byId.get(payment.from);
              const to = byId.get(payment.to);
              return (
                <div key={item.key} className="row" style={style}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }} className="truncate">
                      {from?.name ?? 'Someone'} → {to?.name ?? 'someone'}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>
                      {payment.date ? formatDate(payment.date, { weekday: undefined }) : 'No date'}
                      {payment.note ? ` · ${payment.note}` : ''}
                    </div>
                  </div>
                  <Money cents={payment.amount} colored={false} />
                  <button
                    className="btn btn-ghost btn-icon"
                    style={{ color: 'var(--text-faint)' }}
                    aria-label="Delete this payment"
                    onClick={() => setConfirming(payment)}
                  >
                    <TrashIcon />
                  </button>
                </div>
              );
            })}
          </div>
          <p className="hint" style={{ margin: '8px 2px 0' }}>
            {paymentCount > 0 ? (
              <>
                <Money cents={totalPaid(ledger)} colored={false} /> settled across {paymentCount}{' '}
                payment{paymentCount === 1 ? '' : 's'}
              </>
            ) : null}
            {paymentCount > 0 && writtenOff > 0 ? ' · ' : ''}
            {writtenOff > 0 ? (
              <>
                <Money cents={writtenOff} colored={false} /> written off
              </>
            ) : null}
            .
          </p>
        </>
      ) : null}

      {draft ? <PaymentSheet draft={draft} season={season} onClose={() => setDraft(null)} /> : null}

      {writingOff ? <GhostSheet playerId={writingOff} onClose={() => setWritingOff(null)} /> : null}

      {confirming ? (
        <Confirm
          title="Delete this payment?"
          body="It goes back onto what's owed, as though it never happened."
          onConfirm={() => deletePayment(confirming.id)}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </div>
  );
}

function BalanceRow({ balance }: { balance: Balance }) {
  const { player, outstanding, paid, received, writtenOff } = balance;

  return (
    <div className="row" style={{ padding: '11px 14px', gap: 10 }}>
      <Avatar name={player.name} color={player.color} size="sm" />
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 620 }} className="truncate">
          {player.name}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>
          {outstanding > 0 ? 'still owed' : 'still owes'}
          {paid > 0 ? <> · paid <Money cents={paid} colored={false} /> so far</> : null}
          {received > 0 ? <> · got <Money cents={received} colored={false} /> so far</> : null}
          {writtenOff !== 0 ? (
            <> · <Money cents={Math.abs(writtenOff)} colored={false} /> written off</>
          ) : null}
        </div>
      </div>
      <Money
        cents={Math.abs(outstanding)}
        colored={false}
        className={outstanding > 0 ? 'win' : 'loss'}
      />
    </div>
  );
}

function PaymentSheet({
  draft,
  season,
  onClose,
}: {
  draft: Draft;
  /** The season whose debts this settles, whatever day it's paid on. Null before seasons exist. */
  season: Season | null;
  onClose: () => void;
}) {
  const ledger = useStore((s) => s.ledger);
  const savePayment = useStore((s) => s.savePayment);

  const players = useMemo(() => ledger.players.filter((p) => !p.deleted), [ledger.players]);
  const [from, setFrom] = useState(draft.from);
  const [to, setTo] = useState(draft.to);
  const [amount, setAmount] = useState(draft.amount);
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');

  const cents = parseMoney(amount);
  const samePerson = from !== '' && from === to;
  const canSave = from !== '' && to !== '' && !samePerson && cents > 0;

  return (
    <Sheet title="Record a payment" onClose={onClose}>
      <div className="stack">
        <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
          <div className="grow">
            <Field label="Who paid">
              <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="">Choose…</option>
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grow">
            <Field label="Who got paid">
              <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Choose…</option>
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
          <div className="grow">
            <Field label="Amount">
              <input
                className="input input-money"
                inputMode="decimal"
                placeholder="0"
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
          </div>
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
        </div>

        <Field label="Note">
          <input
            className="input"
            placeholder="optional — e.g. cash, UPI"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        {samePerson ? (
          <div className="banner banner-warn">
            <span>⚠️</span>
            <span>Pick two different people.</span>
          </div>
        ) : null}

        <button
          className="btn btn-primary btn-block"
          disabled={!canSave}
          onClick={() => {
            savePayment({
              id: newId(),
              from,
              to,
              amount: cents,
              date,
              note: note.trim() || undefined,
              ...(season ? { season: season.id } : {}),
              updatedAt: Date.now(),
            });
            onClose();
          }}
        >
          Save payment
        </button>
      </div>
    </Sheet>
  );
}
