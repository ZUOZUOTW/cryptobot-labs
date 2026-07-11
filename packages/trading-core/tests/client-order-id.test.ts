import { describe, expect, it } from "vitest";

import { deriveClientOrderId } from "../src";

const input = {
  deploymentId: "deployment-alpha",
  configurationVersion: "config-v7",
  signalId: "signal-42",
  sequence: 0,
};

describe("deriveClientOrderId", () => {
  it("is stable, bounded and exchange-safe", async () => {
    const first = await deriveClientOrderId(input);
    expect(await deriveClientOrderId(input)).toBe(first);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first.length).toBeLessThanOrEqual(36);
  });

  it("changes for every scoped input and sequence", async () => {
    const base = await deriveClientOrderId(input);
    for (const changed of [
      { ...input, deploymentId: "deployment-beta" },
      { ...input, configurationVersion: "config-v8" },
      { ...input, signalId: "signal-43" },
      { ...input, sequence: 1 },
    ]) {
      expect(await deriveClientOrderId(changed)).not.toBe(base);
    }
  });

  it("uses an unambiguous canonical representation", async () => {
    expect(
      await deriveClientOrderId({ ...input, deploymentId: "a:b", signalId: "c" }),
    ).not.toBe(
      await deriveClientOrderId({ ...input, deploymentId: "a", signalId: "b:c" }),
    );
  });

  it.each([
    { ...input, deploymentId: "" },
    { ...input, signalId: "x".repeat(257) },
    { ...input, sequence: -1 },
    { ...input, sequence: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects malformed input %#", async (candidate) => {
    await expect(deriveClientOrderId(candidate)).rejects.toThrow();
  });
});
