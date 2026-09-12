import { useMemo } from 'react';
import { compactMoney } from '../lib/money';
import { useStore } from '../lib/store';
import type { PlayerStats } from '../lib/types';

const W = 340;
const H = 170;
const PAD = { top: 12, right: 10, bottom: 18, left: 44 };

/**
 * A readable gridline interval for a range of `span` cents: the 1/2/5/10
 * progression people expect on an axis, never smaller than one cent.
 *
 * Rounds to the *nearest* nice number rather than always up — rounding up
 * can double the interval and leave a chart with only two gridlines.
 */
export function niceStep(span: number): number {
  const target = Math.max(span, 1) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const normalised = target / magnitude; // always in [1, 10)
  const multiple = normalised < 1.5 ? 1 : normalised < 3 ? 2 : normalised < 7 ? 5 : 10;
  return Math.max(magnitude * multiple, 1);
}

/**
 * Cumulative profit per player, session by session.
 *
 * The x axis is session *number*, not calendar date — evenly spacing the games
 * keeps a three-month gap from flattening the rest of the season into a smear.
 */
export function ProfitChart({
  stats,
  height = H,
}: {
  stats: PlayerStats[];
  height?: number;
}) {
  const currency = useStore((s) => s.ledger.settings.currency);

  const model = useMemo(() => {
    const series = stats.filter((s) => s.cumulative.length > 0);
    if (series.length === 0) return null;

    const maxPoints = Math.max(...series.map((s) => s.cumulative.length));
    const totals = series.flatMap((s) => s.cumulative.map((c) => c.total));
    let min = Math.min(0, ...totals);
    let max = Math.max(0, ...totals);

    // Guard against a flat ledger collapsing the scale to a single line.
    if (min === max) {
      min -= 1000;
      max += 1000;
    }
    const headroom = (max - min) * 0.08;
    min -= headroom;
    max += headroom;

    const innerW = W - PAD.left - PAD.right;
    const innerH = height - PAD.top - PAD.bottom;

    // Each line gets a zero point prepended, so indices run 0..maxPoints —
    // that's maxPoints intervals, not maxPoints - 1. Dividing by the wrong one
    // pushes the final point past the right edge of the chart.
    const x = (i: number) => PAD.left + (maxPoints === 0 ? innerW : (i / maxPoints) * innerW);
    const y = (v: number) => PAD.top + innerH - ((v - min) / (max - min)) * innerH;

    const lines = series.map((s) => {
      // Every line starts at zero so they share a common origin.
      const points = [{ i: 0, total: 0 }, ...s.cumulative.map((c, idx) => ({ i: idx + 1, total: c.total }))];
      return {
        id: s.player.id,
        name: s.player.name,
        color: s.player.color,
        net: s.net,
        d: points.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.total).toFixed(1)}`).join(' '),
        last: { x: x(points[points.length - 1].i), y: y(points[points.length - 1].total) },
      };
    });

    // Gridlines land on round numbers and are labelled with the value actually
    // drawn there. The step adapts to the range, so a $10 buy-in game gets
    // 50c gridlines where a $200 game gets $100 ones.
    const step = niceStep(max - min);
    const ticks: { v: number; y: number }[] = [];
    for (let v = Math.ceil(min / step) * step; v <= max && ticks.length < 7; v += step) {
      // `+ 0` normalises -0, which Math.ceil produces for any min in (-step, 0].
      ticks.push({ v: v + 0, y: y(v) });
    }

    return { lines, zeroY: y(0), ticks, innerW };
  }, [stats, height]);

  if (!model) {
    return (
      <div className="center" style={{ padding: '28px 12px', color: 'var(--text-faint)', fontSize: 13 }}>
        Log a session to see the graph.
      </div>
    );
  }

  return (
    <div>
      {/* No height attribute: letting the viewBox set the intrinsic aspect ratio
          means the box always matches the drawing, so nothing can spill out. */}
      <svg
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-label="Cumulative profit by player over time"
        style={{ display: 'block', width: '100%', height: 'auto' }}
      >
        {model.ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={t.y}
              y2={t.y}
              stroke="var(--line-soft)"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 6}
              y={t.y + 3.5}
              textAnchor="end"
              fontSize="9.5"
              fill="var(--text-faint)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {compactMoney(t.v, currency)}
            </text>
          </g>
        ))}

        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={model.zeroY}
          y2={model.zeroY}
          stroke="var(--text-faint)"
          strokeWidth="1.2"
          strokeDasharray="3 3"
          opacity="0.7"
        />

        {model.lines.map((line) => (
          <path
            key={line.id}
            d={line.d}
            fill="none"
            stroke={line.color}
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.95"
          />
        ))}

        {model.lines.map((line) => (
          <circle
            key={line.id}
            cx={line.last.x}
            cy={line.last.y}
            r="3.1"
            fill={line.color}
            stroke="var(--felt-800)"
            strokeWidth="1.4"
          />
        ))}
      </svg>

      <div
        className="row"
        style={{ flexWrap: 'wrap', gap: '6px 12px', marginTop: 12, justifyContent: 'center' }}
      >
        {model.lines.map((line) => (
          <span key={line.id} className="row" style={{ gap: 5 }}>
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: 3,
                background: line.color,
                flex: '0 0 auto',
              }}
            />
            <span style={{ fontSize: 11.5, color: 'var(--text-dim)', fontWeight: 600 }}>
              {line.name}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
