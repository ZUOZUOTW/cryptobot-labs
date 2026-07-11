import { describe, expect, it } from "vitest";
import {
  COMMAND_TYPES,
  EVIDENCE_LEVELS,
  RUN_MODES,
  type CommandType,
  type EvidenceLevel,
  type RunMode,
} from "../lib/control-plane/types";
import {
  parseBacktestJobCreateDto,
  parseCommandCreateDto,
  parseHeartbeatDto,
} from "../lib/control-plane/schemas";
import { assertEvidenceRelabel } from "../lib/control-plane/evidence";

describe("control-plane vocabulary", () => {
  it("exports one exact vocabulary shared by storage and routes", () => {
    const evidence: readonly EvidenceLevel[] = EVIDENCE_LEVELS;
    const modes: readonly RunMode[] = RUN_MODES;
    const commands: readonly CommandType[] = COMMAND_TYPES;

    expect(evidence).toEqual(["preview", "historical", "paper", "futures-demo", "live"]);
    expect(modes).toEqual(["paper", "futures-demo", "live"]);
    expect(commands).toEqual([
      "deploy",
      "pause",
      "resume-paper",
      "request-live-unlock",
      "stop-new-orders",
      "cancel-open-orders",
      "close-positions",
      "revalidate-connection",
      "erase-local-credentials",
    ]);
  });

  it("does not allow preview evidence to be promoted", () => {
    expect(() => assertEvidenceRelabel("preview", "historical")).toThrow(/不可變更/);
    expect(() => assertEvidenceRelabel("preview", "live")).toThrow(/不可變更/);
    expect(assertEvidenceRelabel("preview", "preview")).toBe("preview");
  });
});

describe("strict control-plane DTO parsers", () => {
  const backtest = {
    strategyVersionId: "sv_01",
    market: "spot",
    symbol: "BTCUSDT",
    interval: "1h",
    startTime: 1_700_000_000_000,
    endTime: 1_700_086_400_000,
    initialCapital: "10000.00",
    feeRate: "0.001",
    slippageRate: "0.0005",
  } as const;

  it("accepts bounded backtest, command, and heartbeat DTOs", () => {
    expect(parseBacktestJobCreateDto(backtest)).toEqual(backtest);
    expect(parseCommandCreateDto({
      deploymentId: "dep_01",
      type: "stop-new-orders",
      payload: { reason: "user" },
    })).toEqual({ deploymentId: "dep_01", type: "stop-new-orders", payload: { reason: "user" } });
    expect(parseHeartbeatDto({
      deploymentId: "dep_01",
      sequence: 7,
      occurredAt: 1_700_000_000_000,
      mode: "paper",
      health: "healthy",
      positions: [{ symbol: "BTCUSDT", quantity: "0.01", markPrice: "65000" }],
    })).toMatchObject({ sequence: 7, health: "healthy" });
  });

  it("rejects unknown fields instead of silently stripping them", () => {
    expect(() => parseBacktestJobCreateDto({ ...backtest, exchange: "other" })).toThrow(/未知欄位/);
    expect(() => parseCommandCreateDto({
      deploymentId: "dep_01",
      type: "pause",
      payload: {},
      adminOverride: true,
    })).toThrow(/未知欄位/);
  });

  it.each([
    { secretKey: "secret" },
    { apiKey: "secret" },
    { "ACCESS-KEY": "secret" },
    { "ACCESS_PASSPHRASE": "secret" },
    { nested: { pass_phrase: "secret" } },
    { nested: [{ "ACCESS-SIGN": "signature" }] },
    { nested: { request_signature: "signature" } },
    { nested: { deviceCredential: "credential" } },
    { nested: { auth_token: "token" } },
    { nested: { refreshToken: "token" } },
    { nested: { access_token: "token" } },
    { nested: { sessionToken: "token" } },
    { nested: { bearerToken: "token" } },
    { nested: { privateToken: "token" } },
    { nested: { keySuffix: "AB12" } },
    { nested: { secretKeySuffix: "AB12" } },
    { nested: { credentialKeySuffix: "AB12" } },
    { nested: { signatureKeySuffix: "AB12" } },
    { nested: { authKeySuffix: "AB12" } },
    { nested: { rawAccountKeySuffix: "AB12" } },
    { nested: { fullSecretSuffix: "AB12" } },
    { AUTHORIZATION: "Bearer credential" },
    { raw_account: { balance: "1" } },
  ])("rejects sensitive names recursively: $sensitive", (sensitive) => {
    expect(() => parseCommandCreateDto({
      deploymentId: "dep_01",
      type: "deploy",
      payload: { safe: true, ...sensitive },
    })).toThrow(/敏感欄位/);
  });

  it("allows masked API key suffix metadata", () => {
    expect(parseCommandCreateDto({
      deploymentId: "dep_01",
      type: "revalidate-connection",
      payload: { apiKeySuffix: "AB12", masked_api_key_suffix: "AB12" },
    }).payload).toEqual({ apiKeySuffix: "AB12", masked_api_key_suffix: "AB12" });
  });

  it.each([
    ["undefined", { value: undefined }],
    ["function", { value: () => true }],
    ["symbol", { value: Symbol("bad") }],
    ["bigint", { value: 1n }],
    ["NaN", { value: Number.NaN }],
    ["Infinity", { value: Number.POSITIVE_INFINITY }],
    ["Date", { value: new Date(0) }],
  ])("rejects non-JSON payload values: %s", (_label, payload) => {
    expect(() => parseCommandCreateDto({ deploymentId: "dep_01", type: "deploy", payload }))
      .toThrow(/JSON/);
  });

  it("rejects cycles, sparse arrays, excessive depth, and excessive nodes", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => parseCommandCreateDto({ deploymentId: "dep_01", type: "deploy", payload: cyclic }))
      .toThrow(/循環/);

    const sparse = Array(2) as unknown[];
    sparse[1] = "value";
    expect(() => parseCommandCreateDto({ deploymentId: "dep_01", type: "deploy", payload: { sparse } }))
      .toThrow(/稀疏/);

    let deep: Record<string, unknown> = {};
    for (let index = 0; index < 40; index += 1) deep = { nested: deep };
    expect(() => parseCommandCreateDto({ deploymentId: "dep_01", type: "deploy", payload: deep }))
      .toThrow(/深度/);

    expect(() => parseCommandCreateDto({
      deploymentId: "dep_01",
      type: "deploy",
      payload: { nodes: Array.from({ length: 2_100 }, () => null) },
    })).toThrow(/節點/);
  });

  it("rejects arrays with custom prototypes before inherited hooks can execute", () => {
    let hookCalls = 0;
    const values = ["safe"];
    Object.setPrototypeOf(values, {
      toJSON() {
        hookCalls += 1;
        return { apiKey: "injected" };
      },
    });

    expect(() => parseCommandCreateDto({
      deploymentId: "dep_01",
      type: "deploy",
      payload: { values },
    })).toThrow(/JSON/);
    expect(hookCalls).toBe(0);
  });

  it("returns a detached safe payload clone and never invokes inherited toJSON", () => {
    let hookCalls = 0;
    Object.defineProperty(Object.prototype, "toJSON", {
      configurable: true,
      value: () => {
        hookCalls += 1;
        return { apiKey: "injected" };
      },
    });
    const payload = {
      nested: { value: "before" },
    };

    try {
      const parsed = parseCommandCreateDto({ deploymentId: "dep_01", type: "deploy", payload });
      payload.nested.value = "after";

      expect(parsed.payload).toEqual({ nested: { value: "before" } });
      expect(parsed.payload).not.toBe(payload);
      expect(parsed.payload.nested).not.toBe(payload.nested);
      expect(hookCalls).toBe(0);
    } finally {
      delete (Object.prototype as { toJSON?: () => unknown }).toJSON;
    }
  });

  it("bounds strings, arrays, JSON payloads, integer timestamps, and decimal strings", () => {
    expect(() => parseBacktestJobCreateDto({ ...backtest, symbol: "X".repeat(65) })).toThrow(/長度/);
    expect(() => parseBacktestJobCreateDto({ ...backtest, initialCapital: "1e9" })).toThrow(/十進位/);
    expect(() => parseBacktestJobCreateDto({ ...backtest, startTime: 1.5 })).toThrow(/整數/);
    expect(() => parseCommandCreateDto({
      deploymentId: "dep_01",
      type: "deploy",
      payload: { text: "x".repeat(16_385) },
    })).toThrow(/JSON/);
    expect(() => parseHeartbeatDto({
      deploymentId: "dep_01",
      sequence: 1,
      occurredAt: 1_700_000_000_000,
      mode: "paper",
      health: "healthy",
      positions: Array.from({ length: 101 }, () => ({ symbol: "BTCUSDT", quantity: "1", markPrice: "1" })),
    })).toThrow(/陣列/);
  });
});
