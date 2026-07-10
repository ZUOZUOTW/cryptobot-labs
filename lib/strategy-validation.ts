import type { BotConfig } from "./types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export type SourceValidationResult = ValidationResult;

const FORBIDDEN = ["binance", "okx", "bybit", "coinbase", "kraken", "api.binance.com", "api.bybit.com"];

export const validateJavaScript = (source: string): SourceValidationResult => {
  const lowered = source.toLowerCase();
  const forbidden = FORBIDDEN.find((token) => lowered.includes(token));
  const errors: string[] = [];
  if (forbidden) errors.push(`偵測到非 WEEX 交易所識別字：${forbidden}`);
  const pairs = [["(", ")"], ["{", "}"], ["[", "]"]] as const;
  for (const [open, close] of pairs) {
    if ((source.split(open).length - 1) !== (source.split(close).length - 1)) errors.push(`括號不完整：${open}${close}`);
  }
  return { valid: errors.length === 0, errors };
};

export const validateConfig = (config: BotConfig): ValidationResult => {
  const errors: string[] = [];

  if (config.exchange !== "WEEX") errors.push("只支援 WEEX 交易所");
  if (!config.blocks.some((block) => block.group === "entry")) errors.push("至少需要一個進場訊號");
  if (!config.blocks.some((block) => block.group === "exit" || block.group === "risk")) {
    errors.push("至少需要一個出場或風控規則");
  }

  if (config.market === "spot" && config.leverage !== 1) errors.push("現貨交易槓桿必須為 1");
  if (config.market === "futures" && (!Number.isFinite(config.leverage) || config.leverage < 1 || config.leverage > 20)) {
    errors.push("合約交易槓桿必須介於 1 到 20");
  }

  for (const strategy of config.blocks) {
    for (const item of strategy.parameters) {
      if (!Number.isFinite(item.value) || item.value < item.min || item.value > item.max) {
        errors.push(`${strategy.name}的${item.label}必須介於 ${item.min} 到 ${item.max}`);
      }
    }
  }

  if (config.source !== undefined) errors.push(...validateJavaScript(config.source).errors);

  return { valid: errors.length === 0, errors };
};
