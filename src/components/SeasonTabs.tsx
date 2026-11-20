import { resolveView, seasonsOf } from '../lib/seasons';
import { useStore } from '../lib/store';

/**
 * Chips for choosing which season a screen shows: this one, any earlier one,
 * and (except where debts are concerned) all of them together.
 *
 * The choice is shared between screens, so an old season picked on the
 * leaderboard is still showing when you open a player from it. Renders
 * nothing until the group has started a season.
 */
export function SeasonTabs({ allTime = true }: { allTime?: boolean }) {
  const ledger = useStore((s) => s.ledger);
  const viewing = useStore((s) => s.viewing);
  const setViewing = useStore((s) => s.setViewing);

  const seasons = seasonsOf(ledger);
  if (seasons.length === 0) return null;

  const current = seasons[seasons.length - 1];
  const selected = resolveView(ledger, !allTime && viewing === 'all' ? 'current' : viewing)?.id ?? 'all';
  const options = [
    { key: current.id, view: 'current', label: 'This season' },
    // Most recent first, the way people think back.
    ...seasons
      .slice(0, -1)
      .reverse()
      .map((s) => ({ key: s.id, view: s.id, label: s.name })),
    ...(allTime ? [{ key: 'all', view: 'all', label: 'All time' }] : []),
  ];

  return (
    <div className="row" style={{ gap: 6, marginBottom: 14, overflowX: 'auto' }}>
      {options.map((o) => (
        <button
          key={o.key}
          className={`btn btn-sm ${selected === o.key ? 'btn-primary' : ''}`.trim()}
          aria-pressed={selected === o.key}
          onClick={() => setViewing(o.view)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
