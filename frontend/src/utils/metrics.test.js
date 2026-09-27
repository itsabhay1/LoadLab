import { describe, expect, it } from 'vitest';
import { metricSeries } from './metrics';

describe('completed-run metric series', () => {
  it('keeps five-second snapshots and appends the final aggregate metrics', () => {
    const snapshots = [5_000, 10_000].map((elapsedMs, index) => ({
      capturedAt: ['2026-09-27T10:00:05.000Z', '2026-09-27T10:00:10.000Z'][index],
      metrics: {
        elapsedMs,
        totalRequests: (index + 1) * 50,
        rps: 10,
        p95LatencyMs: 5,
      },
    }));
    const finalMetrics = {
      elapsedMs: 10_250,
      totalRequests: 103,
      rps: 10.05,
      p95LatencyMs: 6,
    };

    const series = metricSeries({
      snapshots,
      finalMetrics,
      finishedAt: '2026-09-27T10:00:11.000Z',
    });

    expect(series.slice(0, 2)).toEqual([
      { capturedAt: snapshots[0].capturedAt, ...snapshots[0].metrics },
      { capturedAt: snapshots[1].capturedAt, ...snapshots[1].metrics },
    ]);
    expect(series.at(-1)).toEqual({
      capturedAt: '2026-09-27T10:00:11.000Z',
      ...finalMetrics,
    });
    expect(snapshots).toHaveLength(2);
  });
});
