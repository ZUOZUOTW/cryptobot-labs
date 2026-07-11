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

export function evaluateLiveUnlock(input: unknown): LiveUnlockResult {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    !("targetMarket" in input)
  ) return reject("invalid-input");
  const candidateInput = input as LiveUnlockInput;
  if (candidateInput.targetMarket !== "spot" && candidateInput.targetMarket !== "futures") return reject("invalid-target-market");
  if (candidateInput.credentialVerified !== true) return reject("credential-not-verified");
  if (candidateInput.permissions?.read !== true) return reject("missing-read-permission");
  if (candidateInput.targetMarket === "spot" && candidateInput.permissions.spot !== true) return reject("missing-spot-permission");
  if (candidateInput.targetMarket === "futures" && candidateInput.permissions.futures !== true) return reject("missing-futures-permission");
  if (candidateInput.permissions.unknownExtraScope !== false) return reject("unknown-extra-scope");
  if (candidateInput.withdrawalPermission === "present") return reject("withdrawal-permission-present");
  if (candidateInput.withdrawalPermission !== "absent") return reject("withdrawal-permission-unknown");

  const candidate = candidateInput.policy as unknown as Record<string, unknown> | null | undefined;
  for (const field of policyFields) {
    if (candidate == null || candidate[field] === null || candidate[field] === undefined) {
      return reject(`missing-${kebabCase(field)}` as LiveUnlockRejectionReason);
    }
  }
  if (validateRiskPolicy(candidateInput.policy) !== null) return reject("invalid-risk-policy");

  if (typeof candidateInput.expectedBotName !== "string" || candidateInput.expectedBotName.length === 0 ||
      typeof candidateInput.typedBotName !== "string" || candidateInput.typedBotName.length === 0) {
    return reject("missing-bot-name");
  }
  if (candidateInput.typedBotName !== candidateInput.expectedBotName) return reject("bot-name-mismatch");
  if (candidateInput.acceptedRisk !== true) return reject("risk-not-accepted");
  return { allowed: true };
}
