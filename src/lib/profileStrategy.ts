import type { Candle } from './engine';
import { calculateProfile } from './volumeProfile';
export type ProfileReclaimSettings = {
  timezone: string;
  startHour: number;
  rows: number;
  valueArea: number;
  minSessionBars: number;
  atrPeriod: number;
  sweepAtr: number;
  stopAtr: number;
  retestAtr: number;
  zoneFraction: number;
  confirmationBars: number;
  minRR: number;
  maxHold: number;
  direction: 'both' | 'long' | 'short';
  target: 'poc' | 'opposite' | 'scale';
};
export const reclaimDefaults: ProfileReclaimSettings = {
  timezone: 'America/New_York',
  startHour: 0,
  rows: 32,
  valueArea: 70,
  minSessionBars: 20,
  atrPeriod: 14,
  sweepAtr: 0.1,
  stopAtr: 0.2,
  retestAtr: 0.25,
  zoneFraction: 0.35,
  confirmationBars: 6,
  minRR: 1,
  maxHold: 24,
  direction: 'both',
  target: 'scale',
};
export type ProfilePlan = {
  side: 'buy' | 'sell';
  stop: number;
  poc: number;
  opposite: number;
  zoneLow: number;
  zoneHigh: number;
  session: string;
  signalTime: number;
};
export function validateProfileSettings(s: ProfileReclaimSettings) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: s.timezone }).format();
  } catch {
    throw new Error('Choose a valid profile session timezone.');
  }
  const limits = {
    startHour: [0, 23],
    rows: [8, 100],
    valueArea: [1, 100],
    minSessionBars: [2, 500],
    atrPeriod: [2, 200],
    sweepAtr: [0, 5],
    stopAtr: [0.01, 5],
    retestAtr: [0, 5],
    zoneFraction: [0.01, 0.5],
    confirmationBars: [2, 30],
    minRR: [0.1, 10],
    maxHold: [1, 1000],
  };
  for (const [key, [lo, hi]] of Object.entries(limits)) {
    const v = s[key as keyof typeof limits];
    if (!Number.isFinite(v) || v < lo || v > hi)
      throw new Error(`Invalid volume-profile setting: ${key}`);
  }
  for (const key of [
    'startHour',
    'rows',
    'minSessionBars',
    'atrPeriod',
    'confirmationBars',
    'maxHold',
  ] as const)
    if (!Number.isInteger(s[key]))
      throw new Error(`${key} must be an integer.`);
  if (
    !['both', 'long', 'short'].includes(s.direction) ||
    !['poc', 'opposite', 'scale'].includes(s.target)
  )
    throw new Error('Invalid profile direction or target.');
}
export function profileSessionKey(settings: ProfileReclaimSettings) {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: settings.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  return (time: number) => {
    const p = Object.fromEntries(
      format.formatToParts(new Date(time * 1000)).map((p) => [p.type, p.value]),
    );
    return new Date(
      Date.UTC(
        +p.year,
        +p.month - 1,
        +p.day - (+p.hour < settings.startHour ? 1 : 0),
      ),
    )
      .toISOString()
      .slice(0, 10);
  };
}
/** Sequential state machine. A plan at i knows nothing about candles after i. */
export function profileReclaimPlans(
  bars: Candle[],
  s: ProfileReclaimSettings,
): (ProfilePlan | null)[] {
  validateProfileSettings(s);
  const plans: (ProfilePlan | null)[] = bars.map(() => null),
    key = profileSessionKey(s);
  let day = '',
    session: Candle[] = [],
    sessionNumber = 0,
    profile: ReturnType<typeof calculateProfile> = null;
  let setup: {
    side: 'buy' | 'sell';
    extreme: number;
    since: number;
    reclaim?: number;
    reclaimClose?: number;
  } | null = null;
  const used = new Set<string>(),
    trs: number[] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (b.complete === false) continue;
    const next = key(b.time);
    if (next !== day) {
      // The first loaded session may start mid-day: do not use it as a reference.
      profile =
        sessionNumber > 1 && session.length >= s.minSessionBars
          ? calculateProfile(session, s.rows, s.valueArea)
          : null;
      session = [];
      day = next;
      sessionNumber++;
      setup = null;
      used.clear();
    }
    session.push(b);
    const prior = bars[i - 1]?.close ?? b.open,
      tr = Math.max(
        b.high - b.low,
        Math.abs(b.high - prior),
        Math.abs(b.low - prior),
      );
    trs.push(tr);
    sum += tr;
    if (trs.length > s.atrPeriod) sum -= trs.shift()!;
    if (!profile || trs.length < s.atrPeriod || sum <= 0) continue;
    const atr = sum / trs.length,
      { val, vah, pocPrice: poc } = profile;
    if (vah <= val || poc <= val || poc >= vah) continue;
    if (setup && i - setup.since > s.confirmationBars) setup = null;
    if (setup) {
      const long = setup.side === 'buy';
      if (setup.reclaim !== undefined) {
        if (
          b.close <= val ||
          b.close >= vah ||
          (long ? b.low < setup.extreme : b.high > setup.extreme)
        ) {
          setup = null;
          continue;
        }
        const retest = long
          ? b.low <= val + s.retestAtr * atr
          : b.high >= vah - s.retestAtr * atr;
        const confirms = long
          ? b.close > setup.reclaimClose! && b.close > b.open
          : b.close < setup.reclaimClose! && b.close < b.open;
        const zoneLow = long ? val : vah - s.zoneFraction * (vah - val),
          zoneHigh = long ? val + s.zoneFraction * (vah - val) : vah;
        if (
          i > setup.reclaim &&
          retest &&
          confirms &&
          b.close >= zoneLow &&
          b.close <= zoneHigh
        ) {
          const extreme = long
            ? Math.min(setup.extreme, b.low)
            : Math.max(setup.extreme, b.high);
          plans[i] = {
            side: setup.side,
            stop: extreme + (long ? -1 : 1) * s.stopAtr * atr,
            poc,
            opposite: long ? vah : val,
            zoneLow,
            zoneHigh,
            session: day,
            signalTime: b.time,
          };
          used.add(setup.side);
          setup = null;
        }
        continue;
      }
      setup.extreme = long
        ? Math.min(setup.extreme, b.low)
        : Math.max(setup.extreme, b.high);
    } else {
      const down = b.low < val - s.sweepAtr * atr,
        up = b.high > vah + s.sweepAtr * atr;
      if (down && up) continue; // Outside both edges is ambiguous, not a setup.
      if (down && s.direction !== 'short' && !used.has('buy'))
        setup = { side: 'buy', extreme: b.low, since: i };
      if (up && s.direction !== 'long' && !used.has('sell'))
        setup = { side: 'sell', extreme: b.high, since: i };
    }
    if (setup && b.close > val && b.close < vah) {
      setup.reclaim = i;
      setup.reclaimClose = b.close;
    }
  }
  return plans;
}
export function profileEntryAllowed(
  plan: ProfilePlan,
  open: number,
  s: ProfileReclaimSettings,
  entryCostBps = 0,
) {
  const sign = plan.side === 'buy' ? 1 : -1,
    entry = open * (1 + (sign * entryCostBps) / 10000);
  const risk = sign * (entry - plan.stop),
    reward = sign * (plan.poc - entry);
  return (
    open >= plan.zoneLow &&
    open <= plan.zoneHigh &&
    risk > 0 &&
    plan.stop > 0 &&
    reward / risk >= s.minRR
  );
}
