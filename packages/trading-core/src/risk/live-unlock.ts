import {
  compareDecimalStrings,
  isNormalizedSymbol,
  isPositiveDecimalString,
  isSafeNonnegativeInteger,
  isValidInstrumentRules,
  validateRiskPolicy,
} from "./evaluate";
import type {
  LiveUnlockInput,
  LiveUnlockRejectionReason,
  LiveUnlockResult,
  RiskPolicy,
} from "./types";

export const MAX_INSTRUMENT_AGE_MS = 300_000;

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
  if ("maximumInstrumentAgeMs" in input) return reject("unexpected-input-property");
  if (candidateInput.targetMarket !== "spot" && candidateInput.targetMarket !== "futures") return reject("invalid-target-market");
  if (!isSafeNonnegativeInteger(candidateInput.now)) return reject("invalid-now");
  if (candidateInput.credentialVerified !== true) return reject("credential-not-verified");
  const permissions = candidateInput.permissions as unknown;
  if (typeof permissions !== "object" || permissions === null || Array.isArray(permissions)) {
    return reject("invalid-permissions");
  }
  const permissionRecord = permissions as Record<string, unknown>;
  const permissionKeys = ["read", "spot", "futures", "unknownExtraScope"];
  if (Object.keys(permissionRecord).some((key) => !permissionKeys.includes(key))) {
    return reject("unexpected-permission-property");
  }
  if (permissionKeys.some((key) => typeof permissionRecord[key] !== "boolean")) {
    return reject("invalid-permissions");
  }
  if (candidateInput.permissions.read !== true) return reject("missing-read-permission");
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

  if (!isNormalizedSymbol(candidateInput.selectedSymbol)) return reject("invalid-selected-symbol");
  if (!candidateInput.policy.allowedSymbols.includes(candidateInput.selectedSymbol)) {
    return reject("selected-symbol-not-allowed");
  }
  if (!isPositiveDecimalString(candidateInput.requestedLeverage)) {
    return reject("invalid-requested-leverage");
  }
  if (!isValidInstrumentRules(candidateInput.instrumentRules)) {
    return reject("invalid-instrument-rules");
  }
  if (candidateInput.instrumentRules.market !== candidateInput.targetMarket) {
    return reject("instrument-market-mismatch");
  }
  if (candidateInput.instrumentRules.symbol !== candidateInput.selectedSymbol) {
    return reject("instrument-symbol-mismatch");
  }
  if (!isSafeNonnegativeInteger(candidateInput.instrumentVerifiedAt)) {
    return reject("invalid-instrument-verified-at");
  }
  if (candidateInput.instrumentVerifiedAt > candidateInput.now) {
    return reject("instrument-verified-at-in-future");
  }
  if (candidateInput.now - candidateInput.instrumentVerifiedAt > MAX_INSTRUMENT_AGE_MS) {
    return reject("stale-instrument-rules");
  }
  if (candidateInput.targetMarket === "spot" && compareDecimalStrings(candidateInput.requestedLeverage, "1") !== 0) {
    return reject("spot-leverage-must-be-one");
  }
  if (compareDecimalStrings(candidateInput.requestedLeverage, candidateInput.policy.maximumLeverage) > 0) {
    return reject("requested-leverage-exceeds-policy");
  }
  if (
    candidateInput.targetMarket === "futures" &&
    (candidateInput.instrumentRules.maximumLeverage === undefined ||
    compareDecimalStrings(candidateInput.requestedLeverage, candidateInput.instrumentRules.maximumLeverage) > 0
    )
  ) return reject("requested-leverage-exceeds-instrument");

  if (typeof candidateInput.expectedBotName !== "string" || candidateInput.expectedBotName.length === 0 ||
      typeof candidateInput.typedBotName !== "string" || candidateInput.typedBotName.length === 0) {
    return reject("missing-bot-name");
  }
  if (candidateInput.typedBotName !== candidateInput.expectedBotName) return reject("bot-name-mismatch");
  if (candidateInput.acceptedRisk !== true) return reject("risk-not-accepted");
  return { allowed: true };
}
