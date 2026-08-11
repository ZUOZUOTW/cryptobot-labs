export type PositionAttribution = "unique" | "ambiguous" | "unmanaged" | "not-applicable";

interface RunTarget {
  mode: "futures-demo" | "live";
  state: "running" | "paused" | "stopped" | "error";
  market: "spot" | "futures";
  symbol: string;
  lastErrorCode: string | null;
}

interface SymbolPosition {
  symbol: string;
}

/**
 * Account futures positions can only be attached to one persisted, non-stopped
 * futures target. Risk allowlists are intentionally excluded from ownership.
 */
export function attributeCloudPositions<Position extends SymbolPosition>(
  runs: readonly RunTarget[],
  run: RunTarget,
  positions: readonly Position[],
): { attribution: PositionAttribution; positions: Position[] } {
  if (run.mode !== "live" || run.state === "stopped" || run.market !== "futures") {
    return { attribution: "not-applicable", positions: [] };
  }
  if (run.lastErrorCode === "unmanaged_position_state") {
    return { attribution: "unmanaged", positions: [] };
  }

  const ownerCount = runs.filter((candidate) => candidate.state !== "stopped"
    && candidate.mode === "live" && candidate.market === "futures"
    && candidate.symbol === run.symbol).length;
  if (ownerCount !== 1) return { attribution: "ambiguous", positions: [] };

  return {
    attribution: "unique",
    positions: positions.filter((position) => position.symbol === run.symbol),
  };
}
