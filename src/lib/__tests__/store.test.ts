import { describe, expect, it } from 'vitest';
import { useStore } from '../store';

/**
 * The sync engine pushes a couple of seconds after an edit on this device. A
 * merge from the group changes the ledger as well, and when that counted as an
 * edit every sync scheduled the next: an open phone pulled and pushed the whole
 * ledger every 2.5 seconds for as long as the app was open.
 */
describe('what the sync engine treats as an edit', () => {
  it('does not count a merge from the group', () => {
    const before = useStore.getState().edits;
    const remote = structuredClone(useStore.getState().ledger);
    useStore.getState().mergeIn(remote);
    useStore.getState().mergeIn(remote);
    expect(useStore.getState().edits).toBe(before);
  });

  it('still takes in what the merge brought', () => {
    const remote = structuredClone(useStore.getState().ledger);
    remote.players.push({ id: 'from-a-friend', name: 'Ari', color: '#fff', updatedAt: 1 });
    const before = useStore.getState().edits;
    useStore.getState().mergeIn(remote);
    expect(useStore.getState().ledger.players.some((p) => p.name === 'Ari')).toBe(true);
    expect(useStore.getState().edits).toBe(before);
  });

  it('counts every change made on this device', () => {
    const before = useStore.getState().edits;
    useStore.getState().addPlayer('Sam');
    useStore.getState().updateSettings({ defaultStakes: '0.10/0.20' });
    useStore.getState().saveSession({
      id: 's1',
      date: '2026-10-16',
      gameType: 'nlh',
      entries: [],
      updatedAt: 1,
    });
    expect(useStore.getState().edits).toBe(before + 3);
  });
});
