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
/** A sync asked for while one was running. The running one pushed what the
 * device held when it started, so an edit made during it still has to go up. */
let queued = false;

/**
 * One full sync: pull the group, merge it with this device, push the result.
 * Safe to call from anywhere; a call made while one is running runs once more
 * straight after it, rather than being dropped.
 */
export async function syncNow(): Promise<void> {
  const { sync, ledger, setSyncState, markSynced, mergeIn } = useStore.getState();
  if (!sync) return;
  if (inFlight) {
    queued = true;
    return;
  }

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
    if (queued) {
      queued = false;
      void syncNow();
    }
  }
}

/**
 * Mount exactly once, at the root. Syncs when the app regains focus, comes
 * back online, shortly after a local edit, and on a slow timer while open.
 * Every path merges rather than overwrites — see lib/merge.ts.
 */
export function useSyncEngine(): void {
  const sync = useStore((s) => s.sync);
  const edits = useStore((s) => s.edits);
  const connectionKey = sync ? `${sync.url}|${sync.ledgerId}` : null;

  // Push shortly after an edit made on this device, but not for the initial
  // mount — the effect below already does a full sync on connect. Keyed on the
  // edit count rather than the ledger: a sync changes the ledger too, and
  // reacting to that scheduled the next sync from inside the last one.
  const settled = useRef(false);
  useEffect(() => {
    if (!connectionKey) return;
    if (!settled.current) {
      settled.current = true;
      return;
    }
    const timer = setTimeout(syncNow, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [edits, connectionKey]);

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
