import { describe, expect, it } from "vitest";

import {
  deriveClientOrderId,
  isWeexBrokerClientOrderId,
  isWeexBrokerId,
} from "../src";

const input = {
  deploymentId: "deployment-alpha",
  configurationVersion: "config-v7",
  signalId: "signal-42",
  sequence: 0,
};
const brokerId = "WEEX111162";

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

  it("creates the stricter WEEX broker order format deterministically", async () => {
    const first = await deriveClientOrderId({ ...input, brokerId });
    expect(await deriveClientOrderId({ ...input, brokerId })).toBe(first);
    expect(first).toMatch(/^b-WEEX111162-[A-Za-z0-9_-]{22}$/u);
    expect(first).toHaveLength(35);
    expect(isWeexBrokerClientOrderId(first, brokerId)).toBe(true);
    expect(isWeexBrokerClientOrderId(first, "WEEX111163")).toBe(false);
    expect(await deriveClientOrderId({ ...input, brokerId: "WEEX111163" })).not.toBe(first);
  });

  it("validates broker identifiers without accepting lookalikes", () => {
    expect(isWeexBrokerId(brokerId)).toBe(true);
    expect(isWeexBrokerId("weex111162")).toBe(false);
    expect(isWeexBrokerId("WEEX1111620")).toBe(false);
    expect(isWeexBrokerId("WEEX-111162")).toBe(false);
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
    { ...input, brokerId: "WEEX11116" },
    { ...input, brokerId: "weex111162" },
  ])("rejects malformed input %#", async (candidate) => {
    await expect(deriveClientOrderId(candidate)).rejects.toThrow();
  });

  it.each([42, {}, null])("rejects non-string canonical inputs %#", async (value) => {
    await expect(deriveClientOrderId({
      ...input,
      deploymentId: value as string,
    })).rejects.toThrow(/string|input/i);
  });
});
