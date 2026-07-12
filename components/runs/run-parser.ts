import type { RiskBlock, RiskPolicy, RunOrder, RunPosition, RunSignal, RunView } from "./types";

type UnknownRecord = Record<string, unknown>;
const record = (value: unknown): UnknownRecord | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
const exact = (value: UnknownRecord, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const text = (value: unknown, maximum = 128): string | null => typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
const identifier = (value: unknown): string | null => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? value : null;
const decimal = (value: unknown, signed = false): string | null => typeof value === "string" && value.length <= 128 && (signed ? /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/ : /^(?:0|[1-9]\d*)(?:\.\d+)?$/).test(value) ? value : null;
const integer = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

const riskPolicyOf = (value: unknown): RiskPolicy | null => {
  const item = record(value);
  const keys = ["id", "allowedSymbols", "maxOrderNotional", "maxPositionNotional", "maxTotalExposure", "maxSimultaneousPositions", "maxDailyLoss", "maxLeverage", "maxSlippageBps", "minSignalCooldownMs", "maxConsecutiveFailures", "operationMode"];
  if (!item || !exact(item, keys) || !Array.isArray(item.allowedSymbols) || item.allowedSymbols.length < 1 || item.allowedSymbols.length > 100) return null;
  const allowedSymbols = item.allowedSymbols.map((symbol) => typeof symbol === "string" && /^[A-Z0-9][A-Z0-9._:-]{1,63}$/.test(symbol) ? symbol : null);
  const id = identifier(item.id); const maxOrderNotional = decimal(item.maxOrderNotional); const maxPositionNotional = decimal(item.maxPositionNotional);
  const maxTotalExposure = decimal(item.maxTotalExposure); const maxDailyLoss = decimal(item.maxDailyLoss); const maxLeverage = decimal(item.maxLeverage);
  const maxSimultaneousPositions = integer(item.maxSimultaneousPositions); const maxSlippageBps = integer(item.maxSlippageBps);
  const minSignalCooldownMs = integer(item.minSignalCooldownMs); const maxConsecutiveFailures = integer(item.maxConsecutiveFailures);
  if (!id || allowedSymbols.some((symbol) => !symbol) || !maxOrderNotional || !maxPositionNotional || !maxTotalExposure || !maxDailyLoss || !maxLeverage
    || maxSimultaneousPositions === null || maxSlippageBps === null || minSignalCooldownMs === null || maxConsecutiveFailures === null
    || (item.operationMode !== "approval-required" && item.operationMode !== "automatic")) return null;
  return { id, allowedSymbols: allowedSymbols as string[], maxOrderNotional, maxPositionNotional, maxTotalExposure,
    maxSimultaneousPositions, maxDailyLoss, maxLeverage, maxSlippageBps, minSignalCooldownMs,
    maxConsecutiveFailures, operationMode: item.operationMode };
};

const positionOf = (value: unknown): RunPosition | null => {
  const item = record(value); const keys = ["symbol", "side", "quantity", "entryPrice", "markPrice", "unrealizedPnl", "leverage"];
  if (!item || !exact(item, keys) || (item.side !== "long" && item.side !== "short")) return null;
  const symbol = typeof item.symbol === "string" && /^[A-Z0-9][A-Z0-9._:-]{1,63}$/.test(item.symbol) ? item.symbol : null; const quantity = decimal(item.quantity); const entryPrice = decimal(item.entryPrice);
  const markPrice = decimal(item.markPrice); const unrealizedPnl = decimal(item.unrealizedPnl, true); const leverage = decimal(item.leverage);
  return symbol && quantity && entryPrice && markPrice && unrealizedPnl && leverage ? { symbol, side: item.side, quantity, entryPrice, markPrice, unrealizedPnl, leverage } : null;
};

const orderOf = (value: unknown): RunOrder | null => {
  const item = record(value); const keys = ["id", "symbol", "side", "state", "quantity", "price"];
  if (!item || !exact(item, keys) || (item.side !== "buy" && item.side !== "sell")) return null;
  const id = identifier(item.id); const symbol = typeof item.symbol === "string" && /^[A-Z0-9][A-Z0-9._:-]{1,63}$/.test(item.symbol) ? item.symbol : null; const state = text(item.state, 64); const quantity = decimal(item.quantity);
  const price = item.price === null ? null : decimal(item.price);
  return id && symbol && state && quantity && (item.price === null || price !== null) ? { id, symbol, side: item.side, state, quantity, price } : null;
};

const signalOf = (value: unknown): RunSignal | null => {
  const item = record(value); if (!item || !exact(item, ["action", "reason", "occurredAt", "expectedDeploymentVersion"])) return null;
  const action = item.action === "enter" || item.action === "exit" || item.action === "hold" ? item.action : null; const reason = text(item.reason, 500); const occurredAt = integer(item.occurredAt); const expectedDeploymentVersion = integer(item.expectedDeploymentVersion);
  return action && reason && occurredAt !== null && expectedDeploymentVersion !== null && expectedDeploymentVersion >= 1 ? { action, reason, occurredAt, expectedDeploymentVersion } : null;
};

const riskBlockOf = (value: unknown): RiskBlock | null => {
  const item = record(value); if (!item || !exact(item, ["code", "reason", "occurredAt", "expectedDeploymentVersion"])) return null;
  const code = text(item.code, 64); const reason = text(item.reason, 512); const occurredAt = integer(item.occurredAt); const expectedDeploymentVersion = integer(item.expectedDeploymentVersion);
  return code && reason && occurredAt !== null && expectedDeploymentVersion !== null && expectedDeploymentVersion >= 1 ? { code, reason, occurredAt, expectedDeploymentVersion } : null;
};

const evidenceOf = (value: unknown): RunView["evidence"] | null => {
  const item = record(value); if (!item || !exact(item, ["heartbeatOccurredAt", "heartbeatExpectedDeploymentVersion", "pnlSource"])) return null;
  const heartbeatOccurredAt = item.heartbeatOccurredAt === null ? null : integer(item.heartbeatOccurredAt);
  const heartbeatExpectedDeploymentVersion = item.heartbeatExpectedDeploymentVersion === null ? null : integer(item.heartbeatExpectedDeploymentVersion);
  if ((heartbeatOccurredAt === null) !== (heartbeatExpectedDeploymentVersion === null)
    || (heartbeatExpectedDeploymentVersion !== null && heartbeatExpectedDeploymentVersion < 1)
    || (item.pnlSource !== null && item.pnlSource !== "heartbeat-positions")
    || (item.pnlSource === "heartbeat-positions" && heartbeatOccurredAt === null)) return null;
  return { heartbeatOccurredAt, heartbeatExpectedDeploymentVersion, pnlSource: item.pnlSource as "heartbeat-positions" | null };
};

const arrayOf = <T>(value: unknown, parser: (value: unknown) => T | null, maximum: number): T[] | null => {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const parsed = value.map(parser); return parsed.some((item) => item === null) ? null : parsed as T[];
};

export const parseRunView = (value: unknown): RunView | null => {
  const item = record(value); const keys = ["id", "botName", "market", "mode", "state", "health", "pnl", "positions", "openOrders", "lastSignal", "riskBlocks", "evidence", "device", "strategyVersion", "version", "updatedAt", "riskPolicy"];
  if (!item || !exact(item, keys) || !["paper", "futures-demo", "live"].includes(String(item.mode))
    || (item.market !== "spot" && item.market !== "futures")
    || !["stopped", "running", "paused", "error"].includes(String(item.state))
    || !(item.health === null || ["healthy", "degraded", "paused"].includes(String(item.health)))) return null;
  const id = identifier(item.id); const botName = text(item.botName, 100); const pnl = item.pnl === null ? null : decimal(item.pnl, true);
  const positions = arrayOf(item.positions, positionOf, 100); const openOrders = arrayOf(item.openOrders, orderOf, 200);
  const lastSignal = item.lastSignal === null ? null : signalOf(item.lastSignal); const riskBlocks = arrayOf(item.riskBlocks, riskBlockOf, 100);
  const evidence = evidenceOf(item.evidence); const device = record(item.device); const strategyVersion = record(item.strategyVersion); const version = integer(item.version); const updatedAt = integer(item.updatedAt); const riskPolicy = riskPolicyOf(item.riskPolicy);
  const deviceId = device && exact(device, ["id"]) ? identifier(device.id) : null; const strategyVersionId = strategyVersion && exact(strategyVersion, ["id"]) ? identifier(strategyVersion.id) : null;
  if (!id || !botName || (item.pnl !== null && pnl === null) || !positions || !openOrders || (item.lastSignal !== null && !lastSignal) || !riskBlocks || !evidence || !deviceId || !strategyVersionId || version === null || version < 1 || updatedAt === null || !riskPolicy) return null;
  if (evidence.heartbeatExpectedDeploymentVersion !== null && evidence.heartbeatExpectedDeploymentVersion !== version) return null;
  if ((pnl === null) !== (evidence.pnlSource === null)) return null;
  if (evidence.heartbeatOccurredAt === null && (item.health !== null || positions.length > 0 || pnl !== null)) return null;
  if ((lastSignal && lastSignal.expectedDeploymentVersion !== version) || riskBlocks.some((block) => block.expectedDeploymentVersion !== version)) return null;
  return { id, botName, market: item.market, mode: item.mode as RunView["mode"], state: item.state as RunView["state"], health: item.health as RunView["health"], pnl, positions, openOrders, lastSignal, riskBlocks, evidence, device: { id: deviceId }, strategyVersion: { id: strategyVersionId }, version, updatedAt, riskPolicy };
};

export const parseRunList = (value: unknown): { runs: RunView[]; nextCursor: { createdAt: number; id: string } | null } | null => {
  const item = record(value); if (!item || !exact(item, ["runs", "nextCursor"])) return null;
  const runs = arrayOf(item.runs, parseRunView, 100); if (!runs) return null;
  if (item.nextCursor === null) return { runs, nextCursor: null };
  const cursor = record(item.nextCursor); const createdAt = cursor && exact(cursor, ["createdAt", "id"]) ? integer(cursor.createdAt) : null;
  const id = cursor ? identifier(cursor.id) : null; return createdAt !== null && id ? { runs, nextCursor: { createdAt, id } } : null;
};
