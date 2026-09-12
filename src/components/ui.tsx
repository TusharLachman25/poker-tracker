import { useEffect, type ReactNode } from 'react';
import { signedMoney } from '../lib/money';
import { useStore } from '../lib/store';
import { CloseIcon } from './icons';

/** Initials for the circular player chip: "Tushar Roy" -> "TR". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  name,
  color,
  size = 'md',
}: {
  name: string;
  color: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const cls = size === 'lg' ? 'avatar avatar-lg' : size === 'sm' ? 'avatar avatar-sm' : 'avatar';
  return (
    <div className={cls} style={{ background: color }} aria-hidden="true">
      {initials(name)}
    </div>
  );
}

/** Money with the group's currency and a win/loss colour applied for you. */
export function Money({
  cents,
  signed = false,
  className = '',
  colored = true,
}: {
  cents: number;
  signed?: boolean;
  className?: string;
  colored?: boolean;
}) {
  const currency = useStore((s) => s.ledger.settings.currency);
  const tone = !colored ? '' : cents > 0 ? 'win' : cents < 0 ? 'loss' : 'flat';
  const text = signed ? signedMoney(cents, currency) : signedMoney(cents, currency).replace(/^\+/, '');
  return <span className={`money ${tone} ${className}`.trim()}>{text}</span>;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

/** Bottom sheet on phones, centred dialog on wider screens. */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // Stop the page behind the sheet from scrolling with it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div className="scrim" onClick={onClose} role="presentation">
      <div
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="row-between" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Confirm({
  title,
  body,
  confirmLabel = 'Delete',
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-dim)', marginBottom: 18 }}>
        {body}
      </p>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn grow" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-danger grow"
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}

export function StatTile({
  label,
  value,
  note,
  tone,
  small = false,
}: {
  label: string;
  value: ReactNode;
  note?: string;
  tone?: 'win' | 'loss' | 'flat';
  small?: boolean;
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${small ? 'stat-value-sm' : ''} ${tone ?? ''}`.trim()}>{value}</div>
      {note ? <div className="stat-note">{note}</div> : null}
    </div>
  );
}

/** Date formatted for a UK/US-neutral read: "Sat 12 Sep 2026". */
export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = {}): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...opts,
  });
}

export function relativeDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const then = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - then.getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${days < 14 ? '' : 's'} ago`;
  return formatDate(iso, { weekday: undefined });
}

export const todayISO = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
