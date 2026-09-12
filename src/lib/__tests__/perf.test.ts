import { describe, expect, it } from 'vitest';
import { settle } from '../settle';

describe('settle performance', () => {
  it('stays fast at the worst realistic table size', () => {
    // 14 people with awkward, non-cancelling amounts: the slowest shape.
    const nets = new Map<string, number>();
    let running = 0;
    for (let i = 0; i < 13; i++) {
      const amount = (i % 2 === 0 ? 1 : -1) * (997 + i * 131);
      nets.set(`p${i}`, amount);
      running += amount;
    }
    nets.set('p13', -running);

    const started = performance.now();
    const { transfers, leftover } = settle(nets);
    const elapsed = performance.now() - started;

    expect(leftover).toBe(0);
    expect(transfers.length).toBeLessThanOrEqual(13);
    // Tight on purpose: this runs in a useMemo on the Payments page.
    expect(elapsed).toBeLessThan(250);
  });

  it('falls back instantly past the exact-search limit', () => {
    const nets = new Map<string, number>();
    let running = 0;
    for (let i = 0; i < 39; i++) {
      const amount = (i % 2 === 0 ? 1 : -1) * (500 + i * 37);
      nets.set(`p${i}`, amount);
      running += amount;
    }
    nets.set('p39', -running);

    const started = performance.now();
    const { transfers } = settle(nets);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(20);
    expect(transfers.length).toBeLessThanOrEqual(39);
  });
});
