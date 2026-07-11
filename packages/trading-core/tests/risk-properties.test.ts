import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { evaluateOrderRisk } from "../src";
import { riskFixtures } from "./fixtures/risk";

describe("risk properties", () => {
  it("only accepts quantities aligned to the instrument step and within caps", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 150_000 }), (units) => {
        const quantity = (units / 1_000_000).toFixed(6);
        const decision = evaluateOrderRisk(
          riskFixtures.policy,
          riskFixtures.context,
          { ...riskFixtures.intent, quantity },
          riskFixtures.instrument,
        );
        if (decision.allowed) {
          expect(units % 1_000).toBe(0);
          expect(Number(decision.normalized.notional)).toBeLessThanOrEqual(100);
        }
      }),
    );
  });

  it("never allows invalid decimal forms", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("", " ", "NaN", "Infinity", "-Infinity", "1e3", "+1", ".5", "01", "unlimited"),
        (quantity) => {
          expect(
            evaluateOrderRisk(
              riskFixtures.policy,
              riskFixtures.context,
              { ...riskFixtures.intent, quantity },
              riskFixtures.instrument,
            ),
          ).toMatchObject({ allowed: false });
        },
      ),
    );
  });

  it("increasing total exposure cannot turn an exposure rejection into approval", () => {
    fc.assert(
      fc.property(fc.integer({ min: 401, max: 10_000 }), fc.integer({ min: 0, max: 10_000 }), (base, increase) => {
        const first = evaluateOrderRisk(
          riskFixtures.policy,
          { ...riskFixtures.context, totalExposure: String(base) },
          riskFixtures.intent,
          riskFixtures.instrument,
        );
        const increased = evaluateOrderRisk(
          riskFixtures.policy,
          { ...riskFixtures.context, totalExposure: String(base + increase) },
          riskFixtures.intent,
          riskFixtures.instrument,
        );
        expect(first).toEqual({ allowed: false, reason: "maximum-total-exposure-exceeded" });
        expect(increased).toEqual({ allowed: false, reason: "maximum-total-exposure-exceeded" });
      }),
    );
  });
});
