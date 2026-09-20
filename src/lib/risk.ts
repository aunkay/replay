import type { EngineConfig, Side } from './engine';
export function sizeByRisk(input: {
  entry: number;
  stop: number;
  side: Side;
  budget: number;
  buyingPower: number;
  step: number;
  config: EngineConfig;
}) {
  const { entry, stop, side, budget, buyingPower, step, config } = input;
  if (
    ![entry, stop, budget, step].every((v) => Number.isFinite(v) && v > 0) ||
    !Number.isFinite(buyingPower) ||
    buyingPower < 0
  )
    throw new Error('Enter positive prices, risk and quantity step.');
  const direction = side === 'buy' ? 1 : -1;
  if ((entry - stop) * direction <= 0)
    throw new Error('Stop must be on the loss side of entry.');
  const slip = config.slippageBps / 10000,
    fee = config.commissionBps / 10000;
  const entryFill = entry * (1 + direction * slip),
    exitFill = stop * (1 - direction * slip);
  const unitRisk =
    (entryFill - exitFill) * direction + (entryFill + exitFill) * fee;
  const quantity = Math.max(
    0,
    Math.floor(
      Math.min(budget / unitRisk, buyingPower / (entryFill * (1 + fee))) / step,
    ) * step,
  );
  return {
    quantity: Number(quantity.toPrecision(12)),
    risk: quantity * unitRisk,
    unitRisk,
    notional: quantity * entryFill,
    capped: quantity * unitRisk < budget - unitRisk * step,
  };
}
