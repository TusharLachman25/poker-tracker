import { useMemo, useState } from 'react';
import { Avatar, Confirm, EmptyState, Field, Money, Sheet, formatDate, todayISO } from '../components/ui';
import { CashIcon, PlusIcon, TrashIcon } from '../components/icons';
import { parseMoney, toInput } from '../lib/money';
import { settle } from '../lib/settle';
import { activePayments, computeBalances, sortedPayments, totalPaid } from '../lib/stats';
import { newId, useStore } from '../lib/store';
import type { Balance, ID, Payment } from '../lib/types';

/** What the "Pay" button on a suggested transfer pre-fills. */
interface Draft {
  from: ID;
  to: ID;
  amount: string;
}

export function Payments() {
  const ledger = useStore((s) => s.ledger);
  const deletePayment = useStore((s) => s.deletePayment);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirming, setConfirming] = useState<Payment | null>(null);

  const balances = useMemo(() => computeBalances(ledger), [ledger]);
  const history = useMemo(() => sortedPayments(activePayments(ledger)), [ledger]);
  const byId = useMemo(() => new Map(ledger.players.map((p) => [p.id, p])), [ledger.players]);

  // The plan is built from outstanding amounts, not raw winnings, so anything
  // already handed over has been taken off.
  const { transfers, leftover } = useMemo(
    () => settle(new Map(balances.map((b) => [b.player.id, b.outstanding]))),
    [balances],
  );

  const owing = balances.filter((b) => b.outstanding !== 0);
  const hasPlayers = balances.length > 0;

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
      {transfers.length === 0 && history.length === 0 && owing.length === 0 ? (
        <EmptyState
          icon="💸"
          title="Everyone's square"
          body="Nobody owes anybody. Log a session and any debts will appear here."
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

      {leftover !== 0 ? (
        <div className="banner banner-warn" style={{ marginTop: 12 }}>
          <span>⚠️</span>
          <span>
            The books are out by <Money cents={Math.abs(leftover)} colored={false} />, so a
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
            {history.map((payment, i) => {
              const from = byId.get(payment.from);
              const to = byId.get(payment.to);
              return (
                <div
                  key={payment.id}
                  className="row"
                  style={{
                    padding: '11px 14px',
                    gap: 9,
                    borderBottom: i < history.length - 1 ? '1px solid var(--line-soft)' : undefined,
                  }}
                >
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
            <Money cents={totalPaid(ledger)} colored={false} /> settled across {history.length}{' '}
            payment{history.length === 1 ? '' : 's'}.
          </p>
        </>
      ) : null}

      {draft ? <PaymentSheet draft={draft} onClose={() => setDraft(null)} /> : null}

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
  const { player, outstanding, paid, received } = balance;

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

function PaymentSheet({ draft, onClose }: { draft: Draft; onClose: () => void }) {
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
