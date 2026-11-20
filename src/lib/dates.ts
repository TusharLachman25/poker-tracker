/** A moment as a local calendar date, `YYYY-MM-DD` — the form sessions and payments are dated in. */
export function isoDate(at: number = Date.now()): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
