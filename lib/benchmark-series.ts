import type { BotDefinition, EquityPoint } from "./types";

export const benchmarkSeries = (bot: BotDefinition): EquityPoint[] => {
  const seed = [...bot.id].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  let value = 100;
  return bot.equityCurve.map((point, index) => {
    if (index > 0) {
      const cycle = ((seed + index * 7) % 9) - 3;
      value *= 1 + (0.012 + cycle * 0.002);
    }
    return { label: point.label, value: Number(value.toFixed(2)) };
  });
};
