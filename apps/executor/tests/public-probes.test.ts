import { describe, expect, it } from "vitest";

import { publicHealthProbe, publicReadinessProbe } from "../src/public-probes";

describe("public executor probes", () => {
  it("exposes only a liveness status", () => {
    expect(publicHealthProbe()).toEqual({ status: "ok" });
  });

  it("exposes only the aggregate readiness result", () => {
    expect(publicReadinessProbe(true)).toEqual({ status: "ready" });
    expect(publicReadinessProbe(false)).toEqual({ status: "not-ready" });
  });
});
