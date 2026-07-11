import { validateRiskPolicy } from "./evaluate";
import type {
  LiveUnlockInput,
  LiveUnlockRejectionReason,
  LiveUnlockResult,
  RiskPolicy,
} from "./types";

const policyFields: readonly (keyof RiskPolicy)[] = [
  "allowedSymbols",
  "maximumOrderNotional",
  "maximumPositionNotional",
  "maximumTotalExposure",
  "maximumSimultaneousPositions",
  "maximumDailyLoss",
  "maximumLeverage",
  "maximumSlippageBps",
  "minimumSignalCooldownMs",
  "maximumConsecutiveFailures",
  "maximumPriceAgeMs",
];

function kebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function reject(reason: LiveUnlockRejectionReason): LiveUnlockResult {
  return { allowed: false, reason };
}

export function evaluateLiveUnlock(input: LiveUnlockInput): LiveUnlockResult {
  if (input.targetMarket !== "spot" && input.targetMarket !== "futures") return reject("invalid-target-market");
  if (input.credentialVerified !== true) return reject("credential-not-verified");
  if (input.permissions?.read !== true) return reject("missing-read-permission");
  if (input.targetMarket === "spot" && input.permissions.spot !== true) return reject("missing-spot-permission");
  if (input.targetMarket === "futures" && input.permissions.futures !== true) return reject("missing-futures-permission");
  if (input.permissions.unknownExtraScope !== false) return reject("unknown-extra-scope");
  if (input.withdrawalPermission === "present") return reject("withdrawal-permission-present");
  if (input.withdrawalPermission !== "absent") return reject("withdrawal-permission-unknown");

  const candidate = input.policy as unknown as Record<string, unknown> | null | undefined;
  for (const field of policyFields) {
    if (candidate == null || candidate[field] === null || candidate[field] === undefined) {
      return reject(`missing-${kebabCase(field)}` as LiveUnlockRejectionReason);
    }
  }
  if (validateRiskPolicy(input.policy) !== null) return reject("invalid-risk-policy");

  if (typeof input.expectedBotName !== "string" || input.expectedBotName.length === 0 ||
      typeof input.typedBotName !== "string" || input.typedBotName.length === 0) {
    return reject("missing-bot-name");
  }
  if (input.typedBotName !== input.expectedBotName) return reject("bot-name-mismatch");
  if (input.acceptedRisk !== true) return reject("risk-not-accepted");
  return { allowed: true };
}
