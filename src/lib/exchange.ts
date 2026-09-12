import { activePlayers, entryNet, isLive, sortedSessions, activeSessions } from './stats';
import { validateLedger } from './storage';
import { GAME_LABELS, type Ledger, type PlayerStats } from './types';

/**
 * Hand a generated file to the user.
 *
 * Web Share is tried first: inside an installed PWA or the Android WebView a
 * plain download link often goes nowhere, whereas the share sheet reliably
 * lands the file in Files/Drive/WhatsApp. Falls back to a download anchor.
 */
async function deliver(filename: string, contents: string, mime: string): Promise<void> {
  const file = new File([contents], filename, { type: mime });

  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      // User dismissed the sheet, or the platform refused — fall through.
      if ((e as Error)?.name === 'AbortError') return;
    }
  }

  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

export function exportJson(ledger: Ledger): Promise<void> {
  return deliver(
    `poker-tracker-${stamp()}.json`,
    JSON.stringify(ledger, null, 2),
    'application/json',
  );
}

/** Escape a CSV cell: quote it and double any inner quotes. */
function cell(value: string | number): string {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Two tables in one file: a per-session-per-player ledger, then a summary.
 * Amounts are written as decimal units (not cents) so spreadsheets total them.
 */
export function exportCsv(ledger: Ledger, stats: PlayerStats[]): Promise<void> {
  const names = new Map(ledger.players.map((p) => [p.id, p.name]));
  const amount = (cents: number) => (cents / 100).toFixed(2);
  const lines: string[] = [];

  lines.push(['Date', 'Session', 'Game', 'Location', 'Player', 'Buy-in', 'Cash-out', 'Net'].join(','));

  for (const session of sortedSessions(activeSessions(ledger))) {
    for (const entry of session.entries) {
      if (!isLive(entry)) continue;
      lines.push(
        [
          cell(session.date),
          cell(session.name ?? ''),
          cell(GAME_LABELS[session.gameType]),
          cell(session.location ?? ''),
          cell(names.get(entry.playerId) ?? 'Unknown'),
          amount(entry.buyIn),
          amount(entry.cashOut),
          amount(entryNet(entry)),
        ].join(','),
      );
    }
  }

  lines.push('');
  lines.push(['Player', 'Sessions', 'Wins', 'Losses', 'Total buy-ins', 'Net', 'ROI %'].join(','));

  for (const s of stats) {
    if (s.sessions === 0) continue;
    lines.push(
      [
        cell(s.player.name),
        s.sessions,
        s.wins,
        s.losses,
        amount(s.volume),
        amount(s.net),
        s.roi !== null ? (s.roi * 100).toFixed(1) : '',
      ].join(','),
    );
  }

  return deliver(`poker-tracker-${stamp()}.csv`, lines.join('\n'), 'text/csv');
}

export type ImportResult =
  | { ok: true; ledger: Ledger }
  | { ok: false; error: string };

export async function pickAndImport(file: File): Promise<ImportResult> {
  try {
    const text = await file.text();
    const parsed = validateLedger(JSON.parse(text));
    if (!parsed) {
      return { ok: false, error: "That file isn't a Poker Tracker backup." };
    }
    return { ok: true, ledger: parsed };
  } catch {
    return { ok: false, error: "Couldn't read that file — it may be damaged." };
  }
}

/** Plain-text standings, handy for pasting into the group chat. */
export function standingsText(ledger: Ledger, stats: PlayerStats[], currency: string): string {
  const fmt = (cents: number) => {
    const sign = cents > 0 ? '+' : cents < 0 ? '-' : '';
    return `${sign}${currency} ${Math.abs(cents / 100).toFixed(2)}`;
  };
  const played = stats.filter((s) => s.sessions > 0);
  const header = `${ledger.settings.groupName} — standings`;
  const rows = played.map((s, i) => `${i + 1}. ${s.player.name}  ${fmt(s.net)}`);
  const footer = `${activeSessions(ledger).length} sessions · ${activePlayers(ledger).length} players`;
  return [header, ''.padEnd(header.length, '─'), ...rows, '', footer].join('\n');
}
