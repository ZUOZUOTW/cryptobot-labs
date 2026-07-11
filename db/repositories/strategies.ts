import type { ControlPlaneDatabase } from "../index";
import { id } from "./shared";

export interface OwnedStrategyVersionRecord {
  id: string;
  userId: string;
  strategyId: string;
  version: number;
  market: "spot" | "futures";
  symbol: string;
  configHash: string;
  sourceHash: string | null;
  configJson: string;
  sourceCode: string | null;
  createdAt: number;
}

/** Deliberately owner-scoped; immutable strategy versions have no update API. */
export function createStrategyVersionRepository(database: ControlPlaneDatabase) {
  return {
    getOwned(userId: string, strategyVersionId: string): Promise<OwnedStrategyVersionRecord | null> {
      return database.prepare(`
        SELECT v.id, v.user_id AS userId, v.strategy_id AS strategyId, v.version,
          s.market, s.symbol, v.config_hash AS configHash, v.source_hash AS sourceHash,
          v.config_json AS configJson, v.source_code AS sourceCode, v.created_at AS createdAt
        FROM strategy_versions v
        JOIN strategies s ON s.id = v.strategy_id AND s.user_id = v.user_id
        WHERE v.user_id = ? AND v.id = ?
      `).bind(id(userId, "userId"), id(strategyVersionId, "strategyVersionId"))
        .first<OwnedStrategyVersionRecord>();
    },
  };
}
