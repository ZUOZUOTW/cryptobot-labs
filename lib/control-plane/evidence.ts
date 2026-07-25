import type { EvidenceLevel } from "./types";

/** Evidence labels are immutable; a stronger label requires a distinct run and proof record. */
export function assertEvidenceRelabel(
  current: EvidenceLevel,
  requested: EvidenceLevel,
): EvidenceLevel {
  if (current !== requested) {
    throw new Error(`證據等級不可變更：${current} → ${requested}`);
  }
  return current;
}
