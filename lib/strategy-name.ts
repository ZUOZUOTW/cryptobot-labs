export const STRATEGY_NAME_MAX_LENGTH = 100;
export const STRATEGY_NAME_REQUIRED_MESSAGE = "策略名稱不得空白";
export const STRATEGY_NAME_LENGTH_MESSAGE = `策略名稱不得超過 ${STRATEGY_NAME_MAX_LENGTH} 個字元`;
export const STRATEGY_NAME_SENSITIVE_MESSAGE = "策略名稱包含敏感詞、不雅字眼或誤導性用語，請重新命名";

export type StrategyNameValidation =
  | { valid: true; value: string }
  | { valid: false; reason: string };

const CONTROL_CHARACTERS = /\p{Cc}/u;
const CONTROL_CHARACTERS_GLOBAL = /\p{Cc}+/gu;
const UNSAFE_INVISIBLE_CHARACTERS = /[\p{Bidi_Control}\p{Default_Ignorable_Code_Point}\p{Cf}]/u;
const UNSAFE_INVISIBLE_CHARACTERS_GLOBAL = /[\p{Bidi_Control}\p{Default_Ignorable_Code_Point}\p{Cf}]/gu;

/**
 * Last-line output hardening for legacy or externally sourced display names.
 * Validation rejects these characters; render/share surfaces also remove them
 * so an old record cannot visually reorder or invisibly join trusted labels.
 */
export function sanitizeStrategyDisplayText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(UNSAFE_INVISIBLE_CHARACTERS_GLOBAL, "")
    .replace(CONTROL_CHARACTERS_GLOBAL, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

const normalizeForModeration = (value: string): string => (
  value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replaceAll("@", "a")
    .replaceAll("4", "a")
    .replaceAll("3", "e")
    .replaceAll("1", "i")
    .replaceAll("0", "o")
    .replaceAll("5", "s")
    .replaceAll("$", "s")
    .replaceAll("7", "t")
    .replace(/[\p{Z}\p{P}\p{S}_]+/gu, "")
);

/**
 * A deliberately compact, auditable deny list for names that would be shown
 * publicly. It covers profanity, sexual content, slurs, scams, guaranteed
 * return claims, and impersonation of the platform or exchange.
 */
const SENSITIVE_NAME_PATTERNS = [
  /(?:幹|干|操|草)(?:你)?(?:媽|妈|娘)/u,
  /(?:他媽的|他妈的|媽的|妈的|肏|去死|智障|白癡|白痴)/u,
  /(?:色情|情色|裸聊|約炮|约炮|援交|嫖|妓)/u,
  /(?:支那|黑鬼|納粹|纳粹)/u,
  /(?:詐騙|诈骗|洗錢|洗钱|內線交易|内幕交易)/u,
  /(?:保證獲利|保证获利|穩賺|稳赚|必賺|必赚|零風險|零风险)/u,
  /(?:weex官方|官方weex|cryptobotlabs官方|官方cryptobotlabs)/u,
  /(?:motherfucker|fuck|shit|bitch|cunt|asshole|dickhead|pussy|porn)/u,
  /(?:nigger|retard|nazi)/u,
  /(?:scam|phishing|guaranteedprofit|riskfreeprofit)/u,
  /(?:officialweex|weexofficial|officialcryptobotlabs|cryptobotlabsofficial)/u,
] as const;

export function validateStrategyName(value: unknown): StrategyNameValidation {
  if (typeof value !== "string") return { valid: false, reason: STRATEGY_NAME_REQUIRED_MESSAGE };
  const trimmed = value.trim();
  if (!trimmed) return { valid: false, reason: STRATEGY_NAME_REQUIRED_MESSAGE };
  const canonical = trimmed.normalize("NFKC");
  if (canonical.length > STRATEGY_NAME_MAX_LENGTH) {
    return { valid: false, reason: STRATEGY_NAME_LENGTH_MESSAGE };
  }
  // Persisted config identity compares the exact name. Reject non-canonical
  // input instead of silently changing it and invalidating that comparison.
  if (canonical !== trimmed || CONTROL_CHARACTERS.test(trimmed) || UNSAFE_INVISIBLE_CHARACTERS.test(trimmed)) {
    return { valid: false, reason: STRATEGY_NAME_SENSITIVE_MESSAGE };
  }
  const normalized = normalizeForModeration(canonical);
  if (SENSITIVE_NAME_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { valid: false, reason: STRATEGY_NAME_SENSITIVE_MESSAGE };
  }
  return { valid: true, value: canonical };
}
