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
    { nested: { pass_phrase: "secret" } },
    { nested: [{ "ACCESS-SIGN": "signature" }] },
    { AUTHORIZATION: "Bearer credential" },
    { raw_account: { balance: "1" } },
  ])("rejects sensitive names recursively: $sensitive", (sensitive) => {
    expect(() => parseCommandCreateDto({
      deploymentId: "dep_01",
      type: "deploy",
      payload: { safe: true, ...sensitive },
    })).toThrow(/敏感欄位/);
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
