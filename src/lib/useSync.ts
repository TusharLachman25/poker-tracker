import { useEffect, useRef } from 'react';
import { useStore } from './store';
import { syncNow as runSync } from './sync';

/** How long after the last edit to push, so a burst of typing is one round trip. */
const DEBOUNCE_MS = 2500;
/** Background refresh while the app sits open, to pick up a friend's edits. */
const POLL_MS = 60_000;

/**
 * Module-level, not a ref: the top bar, the settings screen and the background
 * timer all call `syncNow`, and they must share one guard or they would race
 * on the push and clobber each other.
 */
let inFlight = false;

/**
 * One full sync: pull the group, merge it with this device, push the result.
 * Safe to call from anywhere; overlapping calls collapse into the first.
 */
export async function syncNow(): Promise<void> {
  const { sync, ledger, setSyncState, markSynced, mergeIn } = useStore.getState();
  if (!sync || inFlight) return;

  inFlight = true;
  setSyncState('syncing');
  try {
    const merged = await runSync(sync, ledger);
    mergeIn(merged);
    markSynced();
  } catch (e) {
    setSyncState('error', e instanceof Error ? e.message : 'Sync failed');
  } finally {
    inFlight = false;
  }
}

/**
 * Mount exactly once, at the root. Syncs when the app regains focus, comes
 * back online, shortly after a local edit, and on a slow timer while open.
 * Every path merges rather than overwrites — see lib/merge.ts.
 */
export function useSyncEngine(): void {
  const sync = useStore((s) => s.sync);
  const ledger = useStore((s) => s.ledger);
  const connectionKey = sync ? `${sync.url}|${sync.ledgerId}` : null;

  // Push shortly after the ledger changes, but not for the initial mount —
  // the effect below already does a full sync on connect.
  const settled = useRef(false);
  useEffect(() => {
    if (!connectionKey) return;
    if (!settled.current) {
      settled.current = true;
      return;
    }
    const timer = setTimeout(syncNow, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [ledger, connectionKey]);

  // Re-arms only when the connection itself changes, not on every edit.
  useEffect(() => {
    if (!connectionKey) return;

    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncNow();
    };
    const onOnline = () => void syncNow();

    void syncNow();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    const poll = setInterval(onVisible, POLL_MS);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      clearInterval(poll);
    };
  }, [connectionKey]);
}
