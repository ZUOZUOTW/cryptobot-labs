import { describe, expect, it } from "vitest";
import { BOT_CATALOG } from "../data/bots";

describe("BOT_CATALOG", () => {
  it("contains five spot and five futures WEEX bots with unique ids", () => {
    expect(BOT_CATALOG).toHaveLength(10);
    expect(BOT_CATALOG.filter((bot) => bot.market === "spot")).toHaveLength(5);
    expect(BOT_CATALOG.filter((bot) => bot.market === "futures")).toHaveLength(5);
    expect(new Set(BOT_CATALOG.map((bot) => bot.id)).size).toBe(10);
    expect(BOT_CATALOG.every((bot) => bot.exchange === "WEEX")).toBe(true);
    expect(BOT_CATALOG.every((bot) => bot.blocks.some((block) => block.group === "entry"))).toBe(true);
    expect(BOT_CATALOG.every((bot) => bot.blocks.some((block) => block.group === "risk"))).toBe(true);
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
