/**
 * Money helpers. Everything internal is integer cents.
 */

/** Parse user input ("12.50", "$1,200", "-40") into cents. NaN-safe. */
export function parseMoney(input: string): number {
  const cleaned = String(input).replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return 0;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return 0;
  // Round rather than truncate so 0.1 + 0.2 style input lands where users expect.
  return Math.round(value * 100);
}

/** Cents -> a plain editable string for text inputs. Hides trailing ".00". */
export function toInput(cents: number): string {
  if (cents === 0) return '';
  const v = cents / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

const cache = new Map<string, Intl.NumberFormat>();

/**
 * Money shows either no decimals or exactly two — never one.
 *
 * `Intl` with `maximumFractionDigits: 2` renders 1350 cents as "$13.5", which
 * reads as broken. A whole amount stays clean ("$13"), anything with cents
 * gets both digits ("$13.50") — which matters at 10c blinds, where nearly
 * every number has cents.
 */
function formatter(currency: string, withCents: boolean): Intl.NumberFormat {
  const key = `${currency}|${withCents}`;
  let found = cache.get(key);
  if (!found) {
    const digits = withCents ? 2 : 0;
    try {
      found = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
    } catch {
      // Unknown/invalid ISO code — fall back to plain decimal formatting.
      found = new Intl.NumberFormat(undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
    }
    cache.set(key, found);
  }
  return found;
}

/** Cents -> display string, e.g. `$1,240.50`. */
export function money(cents: number, currency = 'USD'): string {
  // `|| 0` collapses negative zero, which Intl would otherwise render as
  // "-$0", and turns a stray NaN into a harmless zero.
  const value = cents / 100 || 0;
  return formatter(currency, cents % 100 !== 0).format(value);
}

/** Cents -> display string with an explicit sign, e.g. `+$240`. Zero stays bare. */
export function signedMoney(cents: number, currency = 'USD'): string {
  const s = money(Math.abs(cents), currency);
  if (cents > 0) return `+${s}`;
  if (cents < 0) return `-${s}`;
  return s;
}

/** Compact form for dense chart axes: `$1.2k`. */
export function compactMoney(cents: number, currency = 'USD'): string {
  const abs = Math.abs(cents);
  if (abs >= 100_000) {
    const sign = cents < 0 ? '-' : '';
    const symbol = money(0, currency).replace(/[\d.,\s]/g, '');
    return `${sign}${symbol}${(abs / 100_000).toFixed(abs >= 1_000_000 ? 0 : 1)}k`;
  }
  return money(cents, currency);
}

export function formatHours(minutes: number): string {
  if (minutes <= 0) return '0h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
