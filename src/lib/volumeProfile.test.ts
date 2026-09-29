import { describe, it, expect } from 'vitest';
import {
  calculateProfile,
  groupProfiles,
  profileDefaults,
} from './volumeProfile';
import type { Candle } from './engine';
const bar = (overrides: Partial<Candle> = {}): Candle => ({
  time: 1704205800,
  open: 10,
  close: 18,
  low: 10,
  high: 20,
  volume: 100,
  ...overrides,
});
describe('volume distribution', () => {
  it('conserves volume and allocates proportionally across price rows', () => {
    const p = calculateProfile(
      [bar(), bar({ open: 18, close: 12, volume: 50 })],
      10,
    )!;
    expect(p.total).toBeCloseTo(150);
    expect(p.bins).toHaveLength(10);
    for (const b of p.bins) {
      expect(b.up).toBeCloseTo(10);
      expect(b.down).toBeCloseTo(5);
    }
    expect(
      p.bins.slice(p.from, p.to + 1).reduce((s, b) => s + b.total, 0),
    ).toBeGreaterThanOrEqual(105);
  });
  it('includes flat candles exactly once and handles missing/zero volume', () => {
    const p = calculateProfile(
      [bar({ low: 12, high: 12, open: 12, close: 12 })],
      32,
    )!;
    expect(p.total).toBe(100);
    expect(p.bins.filter((b) => b.total > 0)).toHaveLength(1);
    expect(
      calculateProfile([bar({ volume: 0 }), bar({ volume: NaN })]),
    ).toBeNull();
  });
  it('finds the highest-volume row and includes it in value area', () => {
    const p = calculateProfile(
      [bar(), bar({ low: 12, high: 13, volume: 1000 })],
      10,
    )!;
    expect(p.pocPrice).toBe(12.5);
    expect(p.from).toBeLessThanOrEqual(p.poc);
    expect(p.to).toBeGreaterThanOrEqual(p.poc);
  });
});
describe('profile scope and sessions', () => {
  it('uses only completed bars in the visible window', () => {
    const bars = [
      bar({ time: 1 }),
      bar({ time: 2 }),
      bar({ time: 3, complete: false }),
      bar({ time: 4 }),
    ];
    expect(
      groupProfiles(
        bars,
        { ...profileDefaults, mode: 'visible' },
        'UTC',
        '1m',
        { from: 2, to: 3 },
      )[0].bars.map((b) => b.time),
    ).toEqual([2]);
    expect(
      groupProfiles(
        bars,
        { ...profileDefaults, mode: 'visible' },
        'UTC',
        '1m',
        null,
      ),
    ).toEqual([]);
  });
  it('groups by exchange dates across DST and custom overnight start', () => {
    const bars = [
      '2024-03-08T23:00:00Z',
      '2024-03-09T01:00:00Z',
      '2024-03-11T22:00:00Z',
    ].map((time) => bar({ time: Date.parse(time) / 1000 }));
    const groups = groupProfiles(
      bars,
      { ...profileDefaults, mode: 'sessions', startHour: 18 },
      'America/New_York',
      '1m',
      null,
    );
    expect(groups.map((g) => g.label)).toEqual(['2024-03-08', '2024-03-11']);
    expect(groups[0].bars).toHaveLength(2);
    expect(
      groupProfiles(
        bars,
        { ...profileDefaults, mode: 'session' },
        'America/New_York',
        '1d',
        null,
      ),
    ).toEqual([]);
  });
  it('honors session tags and excludes future bars simply by receiving revealed history', () => {
    const bars = [
      bar({ session: 'premarket' }),
      bar({ time: 1704205900, session: 'regular' }),
      bar({ time: 1704292200, session: 'regular' }),
    ];
    const s = {
      ...profileDefaults,
      mode: 'sessions' as const,
      filter: 'regular' as const,
    };
    const groups = groupProfiles(
      bars.slice(0, 2),
      s,
      'America/New_York',
      '1m',
      null,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].bars).toHaveLength(1);
  });
});
