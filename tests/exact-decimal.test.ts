// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  exactDecimalSign,
  exactPercent,
  formatExactDecimal,
  sumExactDecimals,
} from "../components/runs/exactDecimal";

describe("exact dashboard decimals", () => {
  it("sums values beyond Number.MAX_SAFE_INTEGER without losing fractional precision", () => {
    const total = sumExactDecimals(["9007199254740992.1", "0.9"]);

    expect(total).toBe("9007199254740993");
    expect(formatExactDecimal(total!, "zh-TW")).toBe("9,007,199,254,740,993.00");
    expect(exactDecimalSign(total)).toBe(1);
  });

  it("fails closed for malformed or out-of-contract decimal evidence", () => {
    expect(sumExactDecimals(["12.5", "not-a-number"])).toBeNull();
    expect(formatExactDecimal("1e6", "zh-TW")).toBeNull();
    expect(exactPercent("invalid", "100")).toBeNull();
  });

  it("computes a bounded percentage with integer arithmetic", () => {
    expect(exactPercent("9007199254740992.1", "18014398509481984.2")).toBe(50);
    expect(exactPercent("101", "100")).toBe(100);
    expect(exactPercent("1", "0")).toBeNull();
  });
});
