import { describe, expect, it } from "vitest";
import { canonicalDisplayName } from "../lib/display-name";
import {
  validatePublicPublicationDescription,
  validatePublicPublisherName,
  validatePublicStrategyName,
} from "../lib/publication-moderation";

describe("public strategy trust moderation", () => {
  it("canonicalizes display text with NFKC and rejects control, bidi, and default-ignorable characters", () => {
    expect(canonicalDisplayName("  Ａｌｉｃｅ　Trader  ")).toBe("Alice Trader");
    expect(canonicalDisplayName("Alice\nTrader")).toBeNull();
    expect(canonicalDisplayName("Alice\u202eTrader")).toBeNull();
    expect(canonicalDisplayName("Alice\u200bTrader")).toBeNull();
    expect(canonicalDisplayName("Alice\u00adTrader")).toBeNull();
    expect(canonicalDisplayName("Alice ❤️")).toBe("Alice ❤️");
    expect(canonicalDisplayName("Trader 👨‍💻")).toBe("Trader 👨‍💻");
  });

  it.each([
    "WEEX Official",
    "CryptoBot Labs 官方團隊",
    "WEEX 公式アカウント",
    "официальный WEEX",
    "حساب WEEX الرسمي",
    "ＷＥＥＸ Support",
    "WΕΕX Official",
    "WЕЕX Official",
    "WEEΧ Official",
    "CryptоBot Labs Support",
    "CryptoBοt Labs Official",
    "ᏔЕЕХ Official",
  ])("blocks reserved or official-looking publisher identity %s", (publisher) => {
    expect(validatePublicPublisherName(publisher).valid).toBe(false);
  });

  it.each([
    "Alice Quant",
    "王小明的量化研究",
    "山田太郎トレード研究",
    "Алексей Квант",
    "ليلى للأبحاث الكمية",
    "研究會員 42",
    "Stafford Quant Research",
    "Supportive Trading Research",
  ])("keeps legitimate multilingual publisher identity %s", (publisher) => {
    expect(validatePublicPublisherName(publisher)).toEqual({ valid: true, value: publisher });
  });

  it.each([
    "WΕΕX Official",
    "WЕЕX Official",
    "WEEX 公式",
    "WEEX официальный",
    "ᏔЕЕХ Official",
  ])("blocks confusable or multilingual official claims in public strategy names: %s", (name) => {
    expect(validatePublicStrategyName(name).valid).toBe(false);
  });

  it.each([
    "BTC 多空趨勢 v2",
    "WEEX BTCUSDT Volatility Research",
    "Алексей Quant Research",
  ])("keeps legitimate professional public strategy names: %s", (name) => {
    expect(validatePublicStrategyName(name)).toEqual({ valid: true, value: name });
  });

  it.each([
    "這套策略保證獲利、完全零風險，加入後即可每天穩賺不賠。",
    "这套策略保证盈利且稳赚不赔，加入后每天都能获得固定收益。",
    "This strategy delivers guaranteed profits and risk-free returns to every member.",
    "This strategy guarantees profits for every user regardless of market conditions.",
    "Guaranteed gains are provided to every member regardless of market conditions.",
    "This strategy promises 100% certain profits and no chance of loss for every member.",
    "This is the official WΕΕX strategy with guaranteed gains for every member.",
    "この戦略は利益を保証し、絶対に儲かる安全な仕組みです。",
    "Эта стратегия дает гарантированная прибыль без риска каждому участнику.",
    "هذه الاستراتيجية تمنح أرباح مضمونة بدون مخاطر لجميع المستخدمين.",
  ])("blocks fraudulent performance claims in supported locales", (description) => {
    expect(validatePublicPublicationDescription(description).valid).toBe(false);
  });

  it.each([
    "本策略不保證獲利，任何交易都可能產生損失，請自行評估風險。",
    "本策略不保证盈利，任何交易都可能产生损失，请自行评估风险。",
    "本策略不提供保證獲利，所有交易均可能造成全部本金損失。",
    "本策略並非 WEEX 官方產品，所有規則均為會員獨立研究並自行承擔風險。",
    "Returns are not guaranteed, and this strategy is not risk-free; losses remain possible.",
    "No guaranteed returns are offered; this research strategy can lose capital.",
    "This is not a guaranteed profit system; all invested capital remains at risk.",
    "This independent strategy is not an official WEEX product and is not endorsed by WEEX.",
    "この戦略は利益を保証するものではなく、損失のリスクがあります。",
    "Доходность не гарантирована; стратегия связана с риском потерь капитала.",
    "الأرباح غير مضمونة والاستراتيجية تنطوي على مخاطر خسارة رأس المال.",
  ])("keeps legitimate risk disclosures in supported locales", (description) => {
    expect(validatePublicPublicationDescription(description)).toEqual({
      valid: true,
      value: description.normalize("NFKC"),
    });
  });

  it("canonicalizes descriptions and rejects invisible spoofing before publication", () => {
    expect(validatePublicPublicationDescription(
      "Ｔｈｉｓ strategy uses historical evidence and clearly bounded risk controls.",
    )).toEqual({
      valid: true,
      value: "This strategy uses historical evidence and clearly bounded risk controls.",
    });
    expect(validatePublicPublicationDescription(
      "This strategy uses historical evidence\u202e and clearly bounded risk controls.",
    ).valid).toBe(false);
    expect(validatePublicPublicationDescription(
      "This strategy uses historical evidence\u200b and clearly bounded risk controls.",
    ).valid).toBe(false);
    expect(validatePublicPublisherName("Alice ❤️").valid).toBe(false);
    expect(validatePublicPublisherName("Trader 👨‍💻").valid).toBe(false);
  });

  it.each([
    "This is the official WEEX strategy, authorized for guaranteed member access.",
    "這是 WEEX 官方授權策略，所有會員都可以直接跟單使用。",
    "CryptoBot Labs 公式認定の戦略として公開されています。",
    "Официальная стратегия WEEX опубликована для всех участников сообщества.",
    "هذه استراتيجية WEEX الرسمية والمعتمدة لجميع المستخدمين في المنصة.",
    "This is the official ᏔЕЕХ strategy authorized for all community members.",
  ])("blocks platform or exchange impersonation in public descriptions", (description) => {
    expect(validatePublicPublicationDescription(description).valid).toBe(false);
  });
});
