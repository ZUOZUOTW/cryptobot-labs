import type {
  StrategyInput,
  StrategySignal,
} from "../packages/trading-core/src";
import type { BotConfig, TradeDirection } from "./types";

export const resolvedTradeDirection = (
  config: Pick<BotConfig, "market" | "tradeDirection">,
): TradeDirection => config.tradeDirection ?? (config.market === "spot" ? "long" : "both");

export const tradeDirectionLabel = (
  config: Pick<BotConfig, "market" | "tradeDirection">,
): string => {
  const direction = resolvedTradeDirection(config);
  return direction === "long" ? "只做多" : direction === "short" ? "只做空" : "多空雙向";
};

export const positionSideAllowed = (
  config: Pick<BotConfig, "market" | "tradeDirection">,
  side: "long" | "short",
): boolean => {
  const direction = resolvedTradeDirection(config);
  return side === "long"
    ? direction === "long" || direction === "both"
    : config.market === "futures" && (direction === "short" || direction === "both");
};

/**
 * Applies the configured entry-side policy to sandbox signals. Closing or
 * reducing an existing opposite-side position remains allowed, so changing a
 * policy can never trap exposure that is no longer permitted.
 */
export const enforceTradeDirection = (
  config: Pick<BotConfig, "market" | "tradeDirection">,
  input: Readonly<StrategyInput>,
  signal: Readonly<StrategySignal>,
): StrategySignal => {
  const position = input.portfolio?.position;
  if (position && !positionSideAllowed(config, position.side)) {
    return {
      id: `${signal.id}-direction-close`,
      action: "close",
      reason: `trade-direction:${resolvedTradeDirection(config)}:position-not-allowed`,
      createdAt: signal.createdAt,
    };
  }
  if (signal.action === "hold" || signal.action === "close") return { ...signal };

  const signalSide = signal.action === "buy" ? "long" : "short";
  const reducesOpposite = position !== undefined && position.side !== signalSide;
  if (reducesOpposite || positionSideAllowed(config, signalSide)) return { ...signal };

  return {
    id: `${signal.id}-direction-filtered`,
    action: "hold",
    reason: `trade-direction:${resolvedTradeDirection(config)}:entry-suppressed`,
    createdAt: signal.createdAt,
  };
};
