import { describe, expect, it } from "vitest";

import { cloudRunFailureMessage } from "../components/runs/CloudRunsPanel";

describe("cloud run failure guidance", () => {
  it("explains how to recover a strategy with no WEEX demo funds", () => {
    expect(cloudRunFailureMessage("demo_funds_required")).toContain("SUSDT");
    expect(cloudRunFailureMessage("demo_funds_required")).toContain("領取模擬金");
    expect(cloudRunFailureMessage("demo_funds_required")).toContain("恢復");
  });

  it("keeps an unknown safe executor code visible for support", () => {
    expect(cloudRunFailureMessage("unexpected_safe_code")).toContain("unexpected_safe_code");
  });
});
