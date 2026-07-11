import { describe, expect, it } from "vitest";

import { PRIVATE_REQUEST_WINDOW_MS, WeexClock } from "../src/clock";

describe("WeexClock", () => {
  it("uses the request midpoint to calculate adjusted time", () => {
    let localNow = 1_200;
    const clock = new WeexClock(() => localNow);
    clock.recordServerTime(1_500, 1_000, 1_200);
    expect(clock.now()).toBe(1_600);
    localNow = 1_300;
    expect(clock.now()).toBe(1_700);
  });

  it("fails closed before sync and after sync becomes stale", () => {
    let localNow = 10_000;
    const clock = new WeexClock(() => localNow);
    expect(() => clock.assertPrivateRequestWindow(10_000)).toThrow(/clock/i);
    clock.recordServerTime(10_000, 9_900, 10_100);
    localNow = 10_100 + PRIVATE_REQUEST_WINDOW_MS + 1;
    expect(() => clock.assertPrivateRequestWindow(clock.now())).toThrow(/stale/i);
  });

  it.each([
    [Number.NaN, 0, 1],
    [1, Number.POSITIVE_INFINITY, 2],
    [1, 2, 1],
    [1, -1, 1],
  ])("rejects invalid synchronization samples", (server, sent, received) => {
    const clock = new WeexClock(() => 1);
    expect(() => clock.recordServerTime(server, sent, received)).toThrow(/clock/i);
  });

  it("enforces the documented thirty-second request window", () => {
    const clock = new WeexClock(() => 100_000);
    clock.recordServerTime(100_000, 99_900, 100_100);
    expect(() => clock.assertPrivateRequestWindow(70_000)).toThrow(/30-second/i);
    expect(() => clock.assertPrivateRequestWindow(Number.NaN)).toThrow(/clock/i);
  });
});
