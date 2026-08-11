import { describe, expect, it } from "vitest";
import { STRATEGY_PRESETS } from "../data/strategies";
import {
  STRATEGY_NAME_SENSITIVE_MESSAGE,
  sanitizeStrategyDisplayText,
  validateStrategyName,
} from "../lib/strategy-name";
import { validateConfig, validateDraftConfig } from "../lib/strategy-validation";

describe("strategy name moderation", () => {
  it("accepts professional names and returns a trimmed canonical value", () => {
    expect(validateStrategyName("  BTC 多空趨勢 v2  ")).toEqual({
      valid: true,
      value: "BTC 多空趨勢 v2",
    });
    expect(validateStrategyName("Classic RSI Reversal")).toMatchObject({ valid: true });
  });

  it.each([
    "幹你娘策略",
    "色 情 裸聊策略",
    "保證獲利零風險",
    "WEEX 官方策略",
    "f.u.c.k scalper",
    "guaranteed-profit bot",
    "CryptoBot Labs Official",
  ])("blocks sensitive, obscene, misleading, and impersonating names: %s", (name) => {
    expect(validateStrategyName(name)).toEqual({
      valid: false,
      reason: STRATEGY_NAME_SENSITIVE_MESSAGE,
    });
  });

  it.each([
    "SAFE\u202Egpj.exe",
    "CryptoBot\u200BLabs 官方",
    "Ａtlas Trend",
  ])("rejects bidi, invisible, and non-NFKC names without silently changing config identity: %s", (name) => {
    expect(validateStrategyName(name)).toEqual({
      valid: false,
      reason: STRATEGY_NAME_SENSITIVE_MESSAGE,
    });
  });

  it("strips unsafe Unicode at render boundaries as defense in depth", () => {
    expect(sanitizeStrategyDisplayText("SAFE\u202Egpj.exe")).toBe("SAFEgpj.exe");
    expect(sanitizeStrategyDisplayText("CryptoBot\u200BLabs 官方")).toBe("CryptoBotLabs 官方");
    expect(sanitizeStrategyDisplayText("Ａtlas\u0000  Trend")).toBe("Atlas Trend");
  });

  it("blocks invalid names in both drafts and executable configurations", () => {
    const config = {
      ...STRATEGY_PRESETS[0],
      name: "保證獲利策略",
      blocks: STRATEGY_PRESETS[0].blocks.map((block) => ({
        ...block,
        parameters: block.parameters.map((parameter) => ({ ...parameter })),
      })),
    };
    expect(validateDraftConfig(config).errors).toContain(STRATEGY_NAME_SENSITIVE_MESSAGE);
    expect(validateConfig(config).errors).toContain(STRATEGY_NAME_SENSITIVE_MESSAGE);
  });
});
