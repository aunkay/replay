import { advanceExecution } from './finerExecution';
import { aggregateTimeframe } from './timeframes';
import {
  createRuleEvaluator,
  defaultStrategy,
  validateStrategy,
  type Rule,
} from './strategy';
import { type Candle } from './engine';
import type { StoredSession } from './session';
export type MarketAlert = {
  id: string;
  name: string;
  rule: Rule;
  pause: boolean;
  enabled: boolean;
  armedAfter: number;
};
export type AlertEvent = {
  id: string;
  alertId: string;
  name: string;
  time: number;
  price: number;
  pause: boolean;
};
export type AlertCommand = {
  type: 'alert';
  action: 'save' | 'delete' | 'rearm';
  id: string;
  name?: string;
  rule?: Rule;
  pause?: boolean;
};
export function validateAlert(a: MarketAlert) {
  if (
    !a ||
    typeof a.id !== 'string' ||
    !a.id ||
    a.id.length > 100 ||
    typeof a.name !== 'string' ||
    !a.name.trim() ||
    a.name.length > 100 ||
    typeof a.pause !== 'boolean' ||
    typeof a.enabled !== 'boolean' ||
    !Number.isFinite(a.armedAfter)
  )
    throw new Error('Invalid alert.');
  validateStrategy({ ...defaultStrategy(), longEntry: a.rule });
  if (!a.rule.conditions.length)
    throw new Error('Add at least one alert condition.');
}
export function alertCommand(
  session: StoredSession,
  command: AlertCommand,
): StoredSession {
  const alerts = session.alerts ?? [];
  if (command.action === 'save') {
    if (alerts.length >= 30) throw new Error('Maximum 30 alerts per session.');
    if (alerts.some((a) => a.id === command.id))
      throw new Error('Alert already exists.');
    const alert = {
      id: command.id,
      name: command.name?.trim() ?? '',
      rule: command.rule!,
      pause: command.pause ?? true,
      enabled: true,
      armedAfter: session.market.bars[session.cursor].time,
    };
    validateAlert(alert);
    for (const c of alert.rule.conditions)
      for (const operand of [c.left, c.right])
        if (operand.interval)
          aggregateTimeframe(session.market.bars, operand.interval);
    return { ...session, alerts: [...alerts, structuredClone(alert)] };
  }
  if (!alerts.some((a) => a.id === command.id))
    throw new Error('Alert not found.');
  if (command.action === 'delete')
    return { ...session, alerts: alerts.filter((a) => a.id !== command.id) };
  if (command.action === 'rearm')
    return {
      ...session,
      alerts: alerts.map((a) =>
        a.id === command.id
          ? {
              ...a,
              enabled: true,
              armedAfter: session.market.bars[session.cursor].time,
            }
          : a,
      ),
    };
  throw new Error('Unknown alert action.');
}
export function evaluateAlerts(
  session: StoredSession,
  bars: Candle[] = session.market.bars.slice(0, session.cursor + 1),
): StoredSession {
  const bar = bars.at(-1);
  if (
    !bar ||
    !(session.alerts ?? []).some((a) => a.enabled && bar.time > a.armedAfter)
  )
    return session;
  const matches = createRuleEvaluator(bars),
    events: AlertEvent[] = [];
  const alerts = session.alerts!.map((a) => {
    if (
      !a.enabled ||
      bar.time <= a.armedAfter ||
      !matches(a.rule, bars.length - 1)
    )
      return a;
    events.push({
      id: `${a.id}:${bar.time}`,
      alertId: a.id,
      name: a.name,
      time: bar.time,
      price: bar.close,
      pause: a.pause,
    });
    return { ...a, enabled: false };
  });
  return events.length
    ? {
        ...session,
        alerts,
        alertEvents: [...(session.alertEvents ?? []), ...events].slice(-200),
      }
    : session;
}
export function advanceReplay(
  session: StoredSession,
  target: number,
): StoredSession {
  if (!Number.isInteger(target) || target < session.cursor)
    throw new Error('Forward advancement only.');
  let next = session;
  const end = Math.min(
    target,
    session.market.bars.length - 1,
    session.blind && !session.blind.finished ? session.blind.end : Infinity,
  );
  for (let i = session.cursor + 1; i <= end; i++) {
    const last = next.alertEvents?.at(-1)?.id;
    next = evaluateAlerts({
      ...next,
      cursor: i,
      account: advanceExecution(
        next.account,
        session.market.bars[i],
        session.market.bars[i + 1]?.time,
        session.finerMarket,
      ),
    });
    if (
      next.alertEvents?.at(-1)?.id !== last &&
      next.alertEvents?.some(
        (e) => e.time === session.market.bars[i].time && e.pause,
      )
    )
      break;
  }
  return next;
}
