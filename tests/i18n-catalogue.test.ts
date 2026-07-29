import { readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import ar from "@/lib/i18n/generated/ar.json";
import en from "@/lib/i18n/generated/en.json";
import ja from "@/lib/i18n/generated/ja.json";
import ru from "@/lib/i18n/generated/ru.json";
import zhHans from "@/lib/i18n/generated/zh-Hans.json";
import zhHant from "@/lib/i18n/generated/zh-Hant.json";
import { translateMessage } from "@/lib/i18n/messages";

const root = process.cwd();
const englishCatalogue: Record<string, string> = en;
const chinesePattern = /[\u3400-\u9fff]/u;
const placeholderPattern = /__\d+__/gu;
const invariantPattern = /\d+(?:[.,／/%×-]\d+)*%?|WEEX|CryptoBot Labs|API Key|JSON|JavaScript|OAuth|QR Code|USDT|RSI|MACD|ATR|EMA|SMA|CCI|MFI|OBV|ROC|VWAP|ADX|SAR/gu;

function projectFiles(
  directories: readonly string[],
  extensions: ReadonlySet<string>,
  exclude: (normalizedPath: string) => boolean = () => false,
): string[] {
  const files: string[] = [];

  const visit = (directory: string) => {
    for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
      const relativePath = join(directory, entry.name);
      const normalizedPath = relativePath.split(sep).join("/");

      if (entry.isDirectory()) {
        visit(relativePath);
      } else if (extensions.has(extname(entry.name)) && !exclude(normalizedPath)) {
        files.push(normalizedPath);
      }
    }
  };

  directories.forEach(visit);
  return files.sort();
}

function sourceStrings(): string[] {
  const files = projectFiles(
    ["app", "components", "data", "lib", "packages/trading-core/src", "packages/weex-client/src"],
    new Set([".ts", ".tsx"]),
    (file) => file.startsWith("lib/i18n/") || file.endsWith(".d.ts"),
  );
  const found = new Set<string>();

  for (const file of files) {
    const sourceFile = ts.createSourceFile(
      file,
      readFileSync(resolve(root, file), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node) => {
      let value: string | null = null;
      if (ts.isTemplateExpression(node)) {
        value = node.head.text;
        node.templateSpans.forEach((span, index) => { value += `__${index}__${span.literal.text}`; });
        if (chinesePattern.test(value)) found.add(value.trim().replace(/\s+/gu, " "));
        node.templateSpans.forEach((span) => visit(span.expression));
        return;
      }
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) value = node.text;
      if (value && chinesePattern.test(value)) {
        const normalized = value.trim().replace(/\s+/gu, " ");
        if (normalized) found.add(normalized);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return [...found].sort((left, right) => left.localeCompare(right, "zh-Hant"));
}

function englishEyebrowStrings(): string[] {
  const files = projectFiles(["app", "components"], new Set([".tsx"]));
  const found = new Set<string>();

  for (const file of files) {
    const sourceFile = ts.createSourceFile(file, readFileSync(resolve(root, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node)) {
        const className = node.openingElement.attributes.properties.find((property) => (
          ts.isJsxAttribute(property) && property.name.getText(sourceFile) === "className"
        ));
        if (className && ts.isJsxAttribute(className) && className.initializer && ts.isStringLiteral(className.initializer)
          && className.initializer.text.split(/\s+/u).includes("eyebrow")) {
          for (const child of node.children) {
            if (!ts.isJsxText(child)) continue;
            const value = child.text.trim().replace(/\s+/gu, " ").replaceAll("&amp;", "&");
            if (/[A-Z]/u.test(value) && !chinesePattern.test(value)) found.add(value);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return [...found];
}

function englishUiTextStrings(): string[] {
  const files = projectFiles(["app", "components"], new Set([".tsx"]));
  const found = new Set<string>();

  for (const file of files) {
    const sourceFile = ts.createSourceFile(file, readFileSync(resolve(root, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node)) {
        const value = node.text.trim().replace(/\s+/gu, " ").replaceAll("&amp;", "&");
        if (/[A-Za-z]/u.test(value) && !chinesePattern.test(value)) found.add(value);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return [...found];
}

describe("generated translation catalogues", () => {
  it("localizes intentionally English visual labels instead of leaving decorative copy behind", () => {
    const missing = englishEyebrowStrings().flatMap((source) => (
      (["zh-Hant", "zh-Hans", "ar", "ru", "ja"] as const)
        .filter((locale) => translateMessage(locale, source) === source)
        .map((locale) => `${locale}: ${source}`)
    ));
    expect(missing).toEqual([]);
  });

  it("localizes all user-facing English JSX copy except brands and technical identifiers", () => {
    const intentionallyUniversal = new Set([
      "AI", "API Key", "BTC", "CryptoBot", "CryptoBot Labs", "Facebook", "Labs", "LINE",
      "OAuth", "SBOM", "Telegram", "USDT", "UTC", "v", "WEEX", "WEEX / USDT", "X", "imported-strategy.js",
    ]);
    const missing = englishUiTextStrings()
      .filter((source) => !intentionallyUniversal.has(source))
      .flatMap((source) => (
        (["zh-Hant", "zh-Hans", "ar", "ru", "ja"] as const)
          .filter((locale) => translateMessage(locale, source) === source)
          .map((locale) => `${locale}: ${source}`)
      ));
    expect(missing).toEqual([]);
  });

  it("covers every current Chinese source string in all six locales", () => {
    const expected = sourceStrings();
    expect(Object.keys(zhHant).sort((a, b) => a.localeCompare(b, "zh-Hant"))).toEqual(expected);
    for (const catalogue of [zhHans, en, ar, ru, ja]) {
      expect(Object.keys(catalogue).sort((a, b) => a.localeCompare(b, "zh-Hant"))).toEqual(expected);
      expect(Object.values(catalogue).every((value) => value.trim().length > 0)).toBe(true);
    }
  });

  it("preserves dynamic placeholders and rejects generation contamination", () => {
    const contamination = /\n(?:Human|User|Assistant|System)\s*:|Translate Traditional Chinese|Translation:\s*$/iu;
    for (const catalogue of [zhHans, en, ar, ru, ja]) {
      for (const [source, translation] of Object.entries(catalogue)) {
        expect((translation.match(placeholderPattern) ?? []).toSorted(), source).toEqual((source.match(placeholderPattern) ?? []).toSorted());
        const expectedInvariants = (source.match(invariantPattern) ?? [])
          .filter((invariant) => !(/^\d+$/u.test(invariant) && /^\d+月$/u.test(source)));
        const translatedInvariants = translation.match(invariantPattern) ?? [];
        for (const invariant of expectedInvariants) {
          if (invariant === "QR Code" && /QR/u.test(translation)) continue;
          if (/^\d/u.test(invariant)) {
            const escaped = invariant.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
            if (new RegExp(`(?:^|\\D)${escaped}(?:\\D|$)`, "u").test(translation)) continue;
          }
          expect(translatedInvariants, `${source} must preserve ${invariant}`).toContain(invariant);
        }
        expect(translation, source).not.toMatch(contamination);
        expect(translation, source).not.toMatch(/ZXQKEEP|DYNAMICVALUE|\bTOKEN\b/u);
        expect(translation, source).not.toMatch(/[!.]{8,}/u);
      }
    }
  });

  it("does not leave Chinese source copy in the English, Arabic, or Russian catalogues", () => {
    for (const catalogue of [en, ar, ru]) {
      const unchanged = Object.entries(catalogue).filter(([source, translation]) => chinesePattern.test(source) && source === translation);
      expect(unchanged).toEqual([]);
    }
  });

  it("does not mix Arabic and Cyrillic scripts into the wrong catalogues", () => {
    expect(Object.values(ar).filter((translation) => /[\u0400-\u04ff\u3400-\u9fff]/u.test(translation))).toEqual([]);
    expect(Object.values(ru).filter((translation) => /[\u0600-\u06ff\u3400-\u9fff]/u.test(translation))).toEqual([]);
    expect(Object.values(ja).filter((translation) => /[\u0400-\u04ff\u0600-\u06ff]/u.test(translation))).toEqual([]);
  });

  it("does not silently drop sentences from multi-sentence copy", () => {
    for (const catalogue of [en, ar, ru, ja]) {
      for (const [source, translation] of Object.entries(catalogue)) {
        const sourceSentences = source.match(/[。！？]/gu)?.length ?? 0;
        if (sourceSentences < 2) continue;
        const translatedSentences = translation.match(/[.!?。！？]/gu)?.length ?? 0;
        expect(translatedSentences, source).toBeGreaterThanOrEqual(sourceSentences);
      }
    }
  });

  it("preserves explicit negation through the English pivot", () => {
    const englishNegation = /\b(?:no|not|never|without|cannot|can't|won't|must not|does not|do not|is not|are not|unable|unavailable)\b/iu;
    const targetNegation = {
      ar: /لا|لن|لم|ليس|ليست|غير|بدون|دون|خال|يتعذر|تعذر|ممنوع|حظر|مستحيل/u,
      ru: /не|нет|без|нельзя|невозможно|недоступ|отсутств|запрещ|невозмож/iu,
      ja: /ない|ません|ず|不要|できません|不可|未|なし|なく|禁止|無/u,
    } as const;
    for (const [locale, catalogue] of Object.entries({ ar, ru, ja }) as [keyof typeof targetNegation, Record<string, string>][]) {
      for (const [source, translation] of Object.entries(catalogue)) {
        if (!englishNegation.test(englishCatalogue[source] ?? "")) continue;
        expect(translation, source).toMatch(targetNegation[locale]);
      }
    }
  });
});
