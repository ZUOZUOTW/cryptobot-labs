import { describe, expect, it } from "vitest";
import { STRATEGY_BLOCKS } from "../data/strategies";
import { summarizeStrategy } from "../lib/strategy-summary";
import type { BotConfig } from "../lib/types";

const requiredIds = ["rsi", "fixed-position", "stop-loss", "take-profit"];
const validConfig: BotConfig = {
  id: "summary-fixture",
  name: "摘要測試",
  exchange: "WEEX",
  market: "futures",
  symbol: "BTCUSDT",
  timeframe: "1h",
  logicMode: "all",
  leverage: 3,
  blocks: STRATEGY_BLOCKS.filter((block) => requiredIds.includes(block.id)),
};

describe("summarizeStrategy", () => {
  it("describes RSI and returns one full sentence per rule", () => {
    const summary = summarizeStrategy(validConfig);

    expect(summary.join(" ")).toContain("RSI");
    expect(summary.every((sentence) => sentence.endsWith("。"))).toBe(true);
  });

  it("includes timeframe, logic mode, position size, leverage, stop loss, and take profit", () => {
    const joined = summarizeStrategy(validConfig).join(" ");

    expect(joined).toContain("1h");
    expect(joined).toContain("全部");
    expect(joined).toContain("固定倉位");
    expect(joined).toContain("3 倍槓桿");
    expect(joined).toContain("停損");
    expect(joined).toContain("停利");
  });

  it("describes every catalog block by its id", () => {
    const joined = summarizeStrategy({ ...validConfig, blocks: STRATEGY_BLOCKS }).join(" ");

    for (const block of STRATEGY_BLOCKS) {
      expect(joined).toContain(block.name);
    }
  });

  it("describes any-mode logic in Traditional Chinese", () => {
    expect(summarizeStrategy({ ...validConfig, logicMode: "any" }).join(" ")).toContain("任一");
  });
});
