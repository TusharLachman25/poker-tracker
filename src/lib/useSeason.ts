import { useMemo } from 'react';
import { currentSeason, resolveView, seasonLedger } from './seasons';
import { useStore } from './store';

/**
 * The season the screens are showing, and the ledger narrowed to it.
 *
 * Payments passes `allTime: false`: debts are per season, so there is no
 * all-time list of who owes whom, and an all-time pick elsewhere shows the
 * current season there instead.
 */
export function useSeason({ allTime = true }: { allTime?: boolean } = {}) {
  const ledger = useStore((s) => s.ledger);
  const viewing = useStore((s) => s.viewing);

  return useMemo(() => {
    const season = resolveView(ledger, !allTime && viewing === 'all' ? 'current' : viewing);
    const current = currentSeason(ledger);
    return {
      /** Null for all time, or before the group has seasons. */
      season,
      isCurrent: season !== null && season.id === current?.id,
      /** How to refer to what's showing: "This season", a past season's name, or "All time". */
      label: !season ? 'All time' : season.id === current?.id ? 'This season' : season.name,
      ledger: seasonLedger(ledger, season),
    };
  }, [ledger, viewing, allTime]);
}
