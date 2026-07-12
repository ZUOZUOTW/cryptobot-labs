import type { ControlPlaneDatabase } from "../index";
import { exactInput, hash, id, time } from "./shared";

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

export interface SavedStrategyVersionRecord {
  id: string;
  strategyId: string;
  version: number;
  configHash: string;
  createdAt: number;
}

/** Deliberately owner-scoped; immutable strategy versions have no update API. */
export function createStrategyVersionRepository(database: ControlPlaneDatabase) {
  const savedByKey = async (userId: string, key: string, requestHash: string): Promise<{
    strategyVersion: SavedStrategyVersionRecord; idempotent: true;
  } | null> => {
    const row = await database.prepare(`
      SELECT v.id, v.strategy_id AS strategyId, v.version, v.config_hash AS configHash,
        v.created_at AS createdAt, k.request_hash AS requestHash
      FROM strategy_save_keys k JOIN strategy_versions v
        ON v.id=k.strategy_version_id AND v.user_id=k.user_id
      WHERE k.user_id=? AND k.key=?
    `).bind(id(userId, "userId"), key).first<SavedStrategyVersionRecord & { requestHash: string }>();
    if (!row) return null;
    if (row.requestHash !== requestHash) throw new Error("idempotency key request conflict");
    const { requestHash: _requestHash, ...strategyVersion } = row;
    void _requestHash;
    return { strategyVersion, idempotent: true };
  };
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

    async createVisualIdempotent(input: { idempotencyId: string; idempotencyKey: string; requestHash: string;
      strategyId: string; strategyVersionId: string; userId: string; name: string; market: "spot" | "futures";
      symbol: string; configHash: string; configJson: string; now: number }): Promise<{
        strategyVersion: SavedStrategyVersionRecord; idempotent: boolean;
      }> {
      return this.createIdempotent({ ...input, sourceHash: null, sourceCode: null });
    },

    async createIdempotent(input: { idempotencyId: string; idempotencyKey: string; requestHash: string;
      strategyId: string; strategyVersionId: string; userId: string; name: string; market: "spot" | "futures";
      symbol: string; configHash: string; configJson: string; sourceHash: string | null; sourceCode: string | null;
      now: number }): Promise<{ strategyVersion: SavedStrategyVersionRecord; idempotent: boolean }> {
      exactInput(input, ["idempotencyId", "idempotencyKey", "requestHash", "strategyId", "strategyVersionId",
        "userId", "name", "market", "symbol", "configHash", "configJson", "sourceHash", "sourceCode", "now"]);
      const owner = id(input.userId, "userId");
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.idempotencyKey)) throw new Error("idempotency key invalid");
      const digest = hash(input.requestHash);
      const replay = await savedByKey(owner, input.idempotencyKey, digest);
      if (replay) return replay;
      const strategyId = id(input.strategyId, "strategyId");
      const versionId = id(input.strategyVersionId, "strategyVersionId");
      if ((input.sourceHash === null) !== (input.sourceCode === null)) throw new Error("strategy source hash is inconsistent");
      const sourceHash = input.sourceHash === null ? null : hash(input.sourceHash);
      if (input.sourceCode !== null && (input.sourceCode.length < 1 || input.sourceCode.length > 262_144)) {
        throw new Error("strategy source is invalid");
      }
      const now = time(input.now, "now");
      try {
        const results = await database.batch([
          database.prepare(`INSERT INTO strategies (id,user_id,name,market,symbol,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?)`).bind(strategyId, owner, input.name, input.market, input.symbol, now, now),
          database.prepare(`INSERT INTO strategy_versions
            (id,user_id,strategy_id,version,config_hash,source_hash,config_json,source_code,created_at)
            SELECT ?,user_id,id,1,?,?,?,?,? FROM strategies WHERE id=? AND user_id=?`)
            .bind(versionId, hash(input.configHash), sourceHash, input.configJson, input.sourceCode, now, strategyId, owner),
          database.prepare(`INSERT INTO strategy_save_keys
            (id,user_id,key,request_hash,strategy_version_id,created_at)
            SELECT ?,user_id,?,?,id,? FROM strategy_versions WHERE id=? AND user_id=?`)
            .bind(id(input.idempotencyId, "idempotencyId"), input.idempotencyKey, digest, now, versionId, owner),
        ]);
        if (results.some((entry) => !entry.success) || !results.every((entry) => (entry.meta.changes ?? 0) === 1)) {
          throw new Error("atomic strategy save failed");
        }
      } catch (error) {
        const raced = await savedByKey(owner, input.idempotencyKey, digest);
        if (raced) return raced;
        throw error;
      }
      const row = await database.prepare(`SELECT id,strategy_id AS strategyId,version,config_hash AS configHash,
        created_at AS createdAt FROM strategy_versions WHERE id=? AND user_id=?`)
        .bind(versionId, owner).first<SavedStrategyVersionRecord>();
      if (!row) throw new Error("atomic strategy save failed");
      return { strategyVersion: row, idempotent: false };
    },
  };
}
