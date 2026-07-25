import { describe, expect, it } from "vitest";
import { BOT_CATALOG } from "../data/bots";

describe("BOT_CATALOG", () => {
  it("contains five spot and fifteen futures WEEX bots with unique ids", () => {
    expect(BOT_CATALOG).toHaveLength(20);
    expect(BOT_CATALOG.filter((bot) => bot.market === "spot")).toHaveLength(5);
    expect(BOT_CATALOG.filter((bot) => bot.market === "futures")).toHaveLength(15);
    expect(new Set(BOT_CATALOG.map((bot) => bot.id)).size).toBe(20);
    expect(BOT_CATALOG.every((bot) => bot.exchange === "WEEX")).toBe(true);
    expect(BOT_CATALOG.every((bot) => bot.blocks.some((block) => block.group === "entry"))).toBe(true);
    expect(BOT_CATALOG.every((bot) => bot.blocks.some((block) => block.group === "risk"))).toBe(true);
  });

  it("qualifies the ten new aggressive futures bots with positive, active backtests", () => {
    const newBots = BOT_CATALOG.slice(-10);
    expect(newBots).toHaveLength(10);
    expect(newBots.every((bot) => bot.market === "futures" && bot.risk === "高")).toBe(true);
    expect(newBots.every((bot) => bot.leverage >= 6 && bot.leverage <= 15)).toBe(true);
    expect(newBots.every((bot) => bot.metrics.runningDays === 30)).toBe(true);
    expect(newBots.every((bot) => bot.metrics.totalReturn >= 5 && bot.metrics.profitFactor > 1)).toBe(true);
    expect(newBots.every((bot) => bot.metrics.trades >= 10)).toBe(true);
    const signatures = newBots.map((bot) => JSON.stringify({
      logicMode: bot.logicMode,
      leverage: bot.leverage,
      blocks: bot.blocks.map((block) => [block.id, block.parameters.map((parameter) => parameter.value)]),
    }));
    expect(new Set(signatures).size).toBe(10);
  });

  it("qualifies the original ten bots with positive, active 30-day backtests", () => {
    const originalBots = BOT_CATALOG.slice(0, 10);
    expect(originalBots).toHaveLength(10);
    expect(originalBots.every((bot) => bot.metrics.runningDays === 30)).toBe(true);
    expect(originalBots.every((bot) => bot.metrics.totalReturn >= 1 && bot.metrics.profitFactor > 1)).toBe(true);
    expect(originalBots.every((bot) => bot.metrics.trades >= 10)).toBe(true);
    expect(originalBots.filter((bot) => bot.market === "spot").every((bot) => bot.leverage === 1)).toBe(true);
    expect(originalBots.filter((bot) => bot.market === "futures").every((bot) => bot.leverage >= 6 && bot.leverage <= 15)).toBe(true);
  });

  it("provides complete metrics and at least twelve equity points", () => {
    for (const bot of BOT_CATALOG) {
      expect(bot.equityCurve.length).toBeGreaterThanOrEqual(12);
      expect(bot.metrics.maxDrawdown).toBeLessThanOrEqual(0);
      expect(bot.metrics.winRate).toBeGreaterThanOrEqual(0);
      expect(bot.metrics.winRate).toBeLessThanOrEqual(100);
      expect(bot.metrics.trades).toBeGreaterThan(0);
      expect(bot.disclaimer).toBe("模擬回測資料，不代表未來績效");
    }
  });
});
