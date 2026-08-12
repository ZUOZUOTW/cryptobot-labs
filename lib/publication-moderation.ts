import { canonicalPublicDisplayName } from "./display-name";

export type PublicTextValidation =
  | { valid: true; value: string }
  | { valid: false };

const CONTROL_CHARACTERS = /\p{Cc}/u;
const UNSAFE_INVISIBLE_CHARACTERS = /[\p{Bidi_Control}\p{Default_Ignorable_Code_Point}\p{Cf}]/u;

const canonicalPublicText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  if (CONTROL_CHARACTERS.test(value) || UNSAFE_INVISIBLE_CHARACTERS.test(value)) return null;
  const normalized = value.normalize("NFKC");
  if (CONTROL_CHARACTERS.test(normalized) || UNSAFE_INVISIBLE_CHARACTERS.test(normalized)) return null;
  return normalized.replace(/\p{Z}+/gu, " ").trim();
};

// Bounded UTS #39-style folding for glyphs commonly used to spoof the two
// reserved brands and English trust/performance claims. This is intentionally
// not a general transliterator for supported non-Latin languages.
const CONFUSABLE_ASCII: Readonly<Record<string, string>> = Object.freeze({
  "α": "a", "а": "a",
  "β": "b", "в": "b",
  "ϲ": "c", "с": "c",
  "ε": "e", "ϵ": "e", "е": "e",
  "ι": "i", "і": "i", "ӏ": "l", "ı": "i",
  "ј": "j", "κ": "k", "к": "k",
  "ο": "o", "о": "o",
  "ρ": "p", "р": "p",
  "ѕ": "s", "τ": "t", "т": "t",
  "υ": "y", "у": "y", "χ": "x", "х": "x",
  "ԝ": "w",
});

const foldConfusableAscii = (value: string): string => [...value]
  .map((character) => CONFUSABLE_ASCII[character] ?? character)
  .join("");

const nativeModerationSkeleton = (value: string): string => value
  .toLocaleLowerCase("en-US")
  .normalize("NFKD")
  .replace(/\p{M}+/gu, "")
  .replaceAll("@", "a")
  .replaceAll("4", "a")
  .replaceAll("3", "e")
  .replaceAll("1", "i")
  .replaceAll("0", "o")
  .replaceAll("5", "s")
  .replaceAll("$", "s")
  .replaceAll("7", "t")
  .replace(/[\p{Z}\p{P}\p{S}_]+/gu, "");

const moderationSkeleton = (value: string): string => foldConfusableAscii(
  nativeModerationSkeleton(value),
);

const hasPatternMatch = (
  patterns: readonly RegExp[],
  nativeSkeleton: string,
  confusableSkeleton: string,
): boolean => patterns.some((pattern) => (
  pattern.test(nativeSkeleton) || pattern.test(confusableSkeleton)
));

const RESERVED_PUBLISHER_PATTERNS = [
  /weex/u,
  /cryptobot(?:labs?)?/u,
  /^(?:official|admin|support|staff)(?:account|team|desk|service|user|member|\d*)?$/u,
  /^(?:官方|客服|管理員|管理员)(?:帳號|账号|團隊|团队|會員|会员|\d*)?$/u,
  /^(?:公式|サポート|運営)(?:アカウント|チーム|ユーザー|\d*)?$/u,
  /^(?:официальн(?:ый|ая|ое)?|поддержка|администратор)(?:аккаунт|команда|\d*)?$/u,
  /^(?:رسمي|الرسمية|الدعم|المشرف)(?:الحساب|الفريق|\d*)?$/u,
] as const;

const stripCanonicalDisclaimers = (value: string): string => value
  // English performance and affiliation disclaimers.
  .replace(/\b(?:does?|do|is|are|will|can)\s+(?:not|never)\s+(?:offer|offers|provide|provides|promise|promises|represent|represents|constitute|constitutes)?\s*(?:an?\s+)?(?:guarantee(?:d)?|assured|certain|risk[-\s]?free)\s*(?:of\s+)?(?:profit|profits|gain|gains|return|returns|income|earnings|win|wins)?\b/giu, "")
  .replace(/\b(?:cannot|can't)\s+guarantee\s+(?:profit|profits|gain|gains|return|returns|income|earnings)\b/giu, "")
  .replace(/\b(?:profit|profits|gain|gains|return|returns|income|earnings)\s+(?:is|are)\s+not\s+guaranteed\b/giu, "")
  .replace(/\bno\s+(?:(?:guaranteed|assured|certain|risk[-\s]?free)\s+(?:profit|profits|gain|gains|return|returns|income|earnings)|guarantee\s+of\s+(?:profit|profits|gain|gains|return|returns|income|earnings))\b/giu, "")
  .replace(/\b(?:is|are)?\s*(?:not|never)\s+(?:an?\s+)?(?:official|authorized|certified|approved|endorsed|verified|affiliated)(?:\s+(?:by|with|product|strategy|account|team))?\b/giu, "")
  // Traditional and Simplified Chinese performance/affiliation disclaimers.
  .replace(/(?:不|並不|并不|絕不|绝不|不能|無法|无法|非)(?:會|会)?(?:提供|承諾|承诺|代表|構成|构成)?(?:任何)?(?:保證|保证)(?:獲利|获利|盈利|收益|回報|回报|賺錢|赚钱)?/gu, "")
  .replace(/(?:不是|並非|并非|不屬於|不属于|非)(?:任何)?\s*(?:WEEX|CryptoBot(?:\s+Labs)?)?\s*(?:的)?(?:官方|正式授權|正式授权|認證|认证)(?:產品|产品|策略|帳號|账号|團隊|团队)?/giu, "")
  .replace(/(?:不是|並非|并非|非)\s*(?:官方|正式授權|正式授权|認證|认证)(?:的)?\s*(?:WEEX|CryptoBot(?:\s+Labs)?)/giu, "")
  .replace(/(?:不是|並非|并非|不屬於|不属于)(?:完全)?(?:零風險|零风险)/gu, "")
  // Japanese, Russian, and Arabic negated claims.
  .replace(/(?:利益|収益|儲け)(?:を)?保証(?:する)?ものでは(?:ありません|ない|なく)/gu, "")
  .replace(/(?:WEEX|CryptoBot(?:\s+Labs)?)?(?:の)?(?:公式|公認|認定)(?:ではありません|ではない)/giu, "")
  .replace(/(?:неофициальн\p{L}*|не\s+(?:является\s+)?(?:официальн|авторизован|сертифицирован)\p{L}*)/giu, "")
  .replace(/(?:غير|ليس(?:ت)?)\s+(?:رسمي|رسمية|معتمد|موثق)/gu, "");

const FRAUDULENT_CLAIM_PATTERNS = [
  /(?:保證|保证)(?:獲利|获利|盈利|收益|回報|回报|賺錢|赚钱)/u,
  /(?:穩賺不賠|稳赚不赔|穩賺|稳赚|必賺|必赚|保本保收益)/u,
  /(?:零風險|零风险)(?:獲利|获利|盈利|收益|交易)/u,
  /guarantee(?:d|s|ing)?(?:a)?(?:profit|profits|gain|gains|return|returns|income|earnings|win|wins)/u,
  /(?:profit|profits|gain|gains|return|returns|income|earnings)(?:is|are)?guarantee(?:d|s)?/u,
  /(?:assured|certain|sure)(?:profit|profits|gain|gains|return|returns|income|earnings|win|wins)/u,
  /(?:profit|profits|gain|gains|return|returns|income|earnings)(?:is|are)?(?:assured|certain)/u,
  /riskfree(?:profit|profits|return|returns|income|earnings|trading)/u,
  /(?:cannotlose|neverlose|cannotincuranyloss|nochanceofloss|zerorisk|zeroloss|riskless|sureprofit|surewin)/u,
  /ioo(?:percent)?(?:winrate|profit|profits|return|returns|gains)/u,
  /(?:利益|収益|儲け)(?:を)?保証/u,
  /(?:絶対に?|必ず)(?:儲かる|利益|勝てる)/u,
  /ノーリスク(?:で)?(?:利益|収益|取引)/u,
  /гарантированн(?:ая|ую|ые|ый|ого)?(?:прибыл|доход|доходност)/u,
  /(?:прибыл|доход)(?:безриска|гарантирован)/u,
  /(?:ارباح|ربح|عوائد?|دخل)(?:مضمون(?:ة)?|بدونمخاطر)/u,
  /(?:بدونمخاطر)(?:ارباح|ربح|عوائد?|دخل|تداول)/u,
] as const;

const BRAND_PATTERNS = [/(?:weex|cryptobot(?:labs?)?)/u] as const;
const OFFICIAL_CLAIM_PATTERNS = [
  /(?:official|authorized|certified|approved|endorsed|verified|affiliated)(?:by|with|team|account|strategy|weex|cryptobot)/u,
  /(?:weex|cryptobot(?:labs?)?)(?:official|authorized|certified|approved|endorsed|verified|affiliated|partner|team|support)/u,
  /(?:官方|正式授權|正式授权|認證|认证)/u,
  /(?:公式|公認|認定)/u,
  /(?:официальн|авторизован|сертифицирован)/u,
  /(?:رسمي(?:ة)?|معتمد(?:ة)?|موثق(?:ة)?)/u,
] as const;

export function validatePublicPublisherName(value: unknown): PublicTextValidation {
  const canonical = canonicalPublicDisplayName(value);
  if (!canonical) return { valid: false };
  const nativeSkeleton = nativeModerationSkeleton(canonical);
  const skeleton = moderationSkeleton(canonical);
  return hasPatternMatch(RESERVED_PUBLISHER_PATTERNS, nativeSkeleton, skeleton)
    ? { valid: false }
    : { valid: true, value: canonical };
}

export function validatePublicPublicationDescription(value: unknown): PublicTextValidation {
  const canonical = canonicalPublicText(value);
  if (!canonical || canonical.length < 20 || canonical.length > 400) return { valid: false };
  const claimText = stripCanonicalDisclaimers(canonical);
  const nativeSkeleton = nativeModerationSkeleton(claimText);
  const skeleton = moderationSkeleton(claimText);
  if (hasPatternMatch(FRAUDULENT_CLAIM_PATTERNS, nativeSkeleton, skeleton)) return { valid: false };
  const mentionsBrand = hasPatternMatch(BRAND_PATTERNS, nativeSkeleton, skeleton);
  if (mentionsBrand && hasPatternMatch(OFFICIAL_CLAIM_PATTERNS, nativeSkeleton, skeleton)) {
    return { valid: false };
  }
  return { valid: true, value: canonical };
}
