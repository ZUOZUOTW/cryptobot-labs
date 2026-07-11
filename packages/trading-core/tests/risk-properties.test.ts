import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { evaluateOrderRisk } from "../src";
import { riskFixtures } from "./fixtures/risk";

describe("risk properties", () => {
  it("allows exact decimal equality at all order, position, exposure, minimum, leverage, and slippage boundaries", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 100_000 }),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 0, max: 10_000 }),
        (notional, leverage, slippage) => {
          const value = String(notional);
          const decision = evaluateOrderRisk(
            {
              ...riskFixtures.policy,
              maximumOrderNotional: value,
              maximumPositionNotional: value,
              maximumTotalExposure: value,
              maximumLeverage: String(leverage),
              maximumSlippageBps: String(slippage),
            },
            {
              ...riskFixtures.context,
              currentPositionNotional: "0",
              totalExposure: "0",
              leverage: String(leverage),
            },
            {
              ...riskFixtures.intent,
              quantity: "1",
              price: value,
              expectedSlippageBps: String(slippage),
            },
            {
              ...riskFixtures.instrument,
              tickSize: "1",
              stepSize: "1",
              minimumQuantity: "1",
              minimumNotional: value,
              maximumLeverage: String(leverage),
            },
          );

          expect(decision).toMatchObject({
            allowed: true,
            normalized: {
              notional: value,
              projectedPositionNotional: value,
              projectedTotalExposure: value,
            },
          });
        },
      ),
    );
  });

  it("allows exact cooldown boundaries and blocks exact daily-loss, position-count, and failure thresholds", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 100_000 }),
        (cooldown, threshold, loss) => {
          expect(
            evaluateOrderRisk(
              { ...riskFixtures.policy, minimumSignalCooldownMs: cooldown },
              { ...riskFixtures.context, now: 20_000, priceTimestamp: 20_000, lastSignalAt: 20_000 - cooldown },
              riskFixtures.intent,
              riskFixtures.instrument,
            ),
          ).toMatchObject({ allowed: true });

          expect(
            evaluateOrderRisk(
              { ...riskFixtures.policy, maximumDailyLoss: String(loss) },
              { ...riskFixtures.context, realizedDailyPnl: `-${loss}`, unrealizedDailyPnl: "0" },
              riskFixtures.intent,
              riskFixtures.instrument,
            ),
          ).toEqual({ allowed: false, reason: "maximum-daily-loss-reached" });

          expect(
            evaluateOrderRisk(
              { ...riskFixtures.policy, maximumSimultaneousPositions: threshold },
              { ...riskFixtures.context, openPositions: threshold, opensNewPosition: true },
              riskFixtures.intent,
              riskFixtures.instrument,
            ),
          ).toEqual({ allowed: false, reason: "maximum-simultaneous-positions-reached" });

          expect(
            evaluateOrderRisk(
              { ...riskFixtures.policy, maximumConsecutiveFailures: threshold },
              { ...riskFixtures.context, consecutiveFailures: threshold },
              riskFixtures.intent,
              riskFixtures.instrument,
            ),
          ).toEqual({ allowed: false, reason: "maximum-consecutive-failures-reached" });
        },
      ),
    );
  });

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

  it("never allows invalid decimal forms in any decimal-string input", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("", " ", "NaN", "Infinity", "-Infinity", "1e3", "+1", ".5", "01", "unlimited"),
        fc.constantFrom(
          "maximumOrderNotional",
          "maximumPositionNotional",
          "maximumTotalExposure",
          "maximumDailyLoss",
          "maximumLeverage",
          "maximumSlippageBps",
          "currentPositionNotional",
          "totalExposure",
          "realizedDailyPnl",
          "unrealizedDailyPnl",
          "leverage",
          "quantity",
          "price",
          "expectedSlippageBps",
        ),
        (invalid, field) => {
          const policy = { ...riskFixtures.policy };
          const context = { ...riskFixtures.context };
          const intent = { ...riskFixtures.intent };
          if (field in policy) Object.assign(policy, { [field]: invalid });
          else if (field in context) Object.assign(context, { [field]: invalid });
          else Object.assign(intent, { [field]: invalid });
          expect(
            evaluateOrderRisk(
              policy,
              context,
              intent,
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
