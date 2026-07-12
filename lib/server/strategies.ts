import type { SavedStrategyVersionRecord } from "../../db/repositories";
import { STRATEGY_BLOCKS } from "../../data/strategies";
import type { BotConfig } from "../types";
import { safeCanonicalJsonStringify } from "../control-plane/schemas";
import { createVisualHistoricalEvaluator } from "../historical-strategy";
import type { ApiAuthDependencies } from "./auth";
import { requireApiUser } from "./auth";
import { HttpProblem, errorResponse, jsonResponse, readStrictJson } from "./http";
import type { OriginPolicy } from "./origin";
import { requireSameOrigin } from "./origin";

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

type Repository = { createVisualIdempotent(input: { idempotencyId: string; idempotencyKey: string; requestHash: string;
  strategyId: string; strategyVersionId: string; userId: string; name: string; market: "spot" | "futures";
  symbol: string; configHash: string; configJson: string; now: number }): Promise<{
    strategyVersion: SavedStrategyVersionRecord; idempotent: boolean;
  }> };

const digest = async (value: string): Promise<string> => {
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const parseBody = (value: unknown): { config: BotConfig } => {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).length !== 1
    || !Object.hasOwn(value, "config")) throw new HttpProblem(400, "invalid_request");
  const config = (value as { config: unknown }).config;
  if (config === null || typeof config !== "object" || Array.isArray(config)) throw new HttpProblem(400, "invalid_request");
  if (Object.hasOwn(config, "source")) throw new HttpProblem(422, "custom_strategy_runtime_unavailable");
  let evaluator: ReturnType<typeof createVisualHistoricalEvaluator>;
  try { evaluator = createVisualHistoricalEvaluator(config as BotConfig); }
  catch { throw new HttpProblem(422, "invalid_strategy_configuration"); }
  const order = new Map(STRATEGY_BLOCKS.map((block, index) => [block.id, index]));
  return { config: { ...evaluator.config,
    blocks: [...evaluator.config.blocks].sort((left, right) => order.get(left.id)! - order.get(right.id)!),
  } as BotConfig };
};

export function createStrategySaveService(dependencies: {
  repository: Repository; now(): number; newId(prefix: "strategy" | "version" | "strategy-key"): string;
}) {
  return {
    async save(userId: string, idempotencyKey: string, config: BotConfig): Promise<{
      strategyVersion: SavedStrategyVersionRecord; idempotent: boolean;
    }> {
      if (!ID.test(userId) || !KEY.test(idempotencyKey)) throw new HttpProblem(400, "invalid_request");
      const now = dependencies.now();
      if (!Number.isSafeInteger(now) || now < 0) throw new Error("clock returned invalid time");
      const configJson = safeCanonicalJsonStringify(config, "strategy configuration", 262_144);
      const configHash = await digest(configJson);
      const generated = [dependencies.newId("strategy"), dependencies.newId("version"), dependencies.newId("strategy-key")];
      if (generated.some((id) => !ID.test(id))) throw new Error("id generator returned invalid id");
      try {
        return await dependencies.repository.createVisualIdempotent({ strategyId: generated[0]!, strategyVersionId: generated[1]!,
          idempotencyId: generated[2]!, idempotencyKey, requestHash: configHash, userId, name: config.name,
          market: config.market, symbol: config.symbol, configHash, configJson, now });
      } catch (error) {
        if (error instanceof Error && /idempotency key request conflict/i.test(error.message)) {
          throw new HttpProblem(409, "conflict");
        }
        throw error;
      }
    },
  };
}

export function createStrategySaveHandler(dependencies: { auth: ApiAuthDependencies; originPolicy: OriginPolicy;
  service: ReturnType<typeof createStrategySaveService> }) {
  return async (request: Request): Promise<Response> => {
    try {
      requireSameOrigin(request, dependencies.originPolicy);
      const authenticated = await requireApiUser(request, dependencies.auth);
      if (!authenticated.ok) return authenticated.response;
      const key = request.headers.get("idempotency-key") ?? "";
      if (!KEY.test(key)) throw new HttpProblem(400, "invalid_request");
      const { config } = await readStrictJson(request, { maximumBytes: 262_144, parse: parseBody });
      const saved = await dependencies.service.save(authenticated.user.id, key, config);
      return jsonResponse(saved, { status: saved.idempotent ? 200 : 201 });
    } catch (error) {
      if (error instanceof HttpProblem) return errorResponse(error, { status: error.status, code: error.code });
      return errorResponse(error, { status: 500, code: "internal" });
    }
  };
}
