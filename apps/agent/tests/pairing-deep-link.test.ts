import { describe, expect, it } from "vitest";
import { pairingCodeFromArguments, pairingCodeFromDeepLink } from "../src/shared/pairing-deep-link";

const code = `CBL-${"A".repeat(22)}`;

describe("Agent pairing deep links", () => {
  it("accepts only the exact local pairing scheme and bounded code", () => {
    expect(pairingCodeFromDeepLink(`cryptobot-labs://pair?code=${code}`)).toBe(code);
    expect(pairingCodeFromDeepLink(`https://labs.example/pair?code=${code}`)).toBeNull();
    expect(pairingCodeFromDeepLink(`cryptobot-labs://pair?code=${code}&next=live`)).toBeNull();
    expect(pairingCodeFromDeepLink("cryptobot-labs://pair?code=unsafe")).toBeNull();
  });

  it("finds the protocol argument without trusting unrelated process arguments", () => {
    expect(pairingCodeFromArguments(["agent", "--flag", `cryptobot-labs://pair?code=${code}`])).toBe(code);
    expect(pairingCodeFromArguments(["agent", "--flag"])).toBeNull();
  });
});
