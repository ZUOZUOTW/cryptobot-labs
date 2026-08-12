import { describe, expect, it } from "vitest";

import { canonicalizeWeexSymbol } from "../src/symbol";

describe("WEEX symbol identity", () => {
  it.each([
    ["BTCUSDT", "BTCUSDT"],
    [" btcusdt ", "BTCUSDT"],
    ["BTC_USDT", "BTCUSDT"],
    ["BTC/USDT", "BTCUSDT"],
    ["CMT_BTCUSDT", "BTCUSDT"],
    ["cmt_btc_usdt", "BTCUSDT"],
  ])("canonicalizes %s to %s", (input, expected) => {
    expect(canonicalizeWeexSymbol(input)).toBe(expected);
  });

  it.each([null, 1, "", "ALL", "CMT_", "BTC$USDT", "A".repeat(33)])(
    "rejects invalid product identity %j",
    (input) => {
      expect(canonicalizeWeexSymbol(input)).toBeNull();
    },
  );
});
