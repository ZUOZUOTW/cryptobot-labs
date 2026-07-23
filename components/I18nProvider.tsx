"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  localeDirection,
  openGraphLocale,
  resolveInitialLocale,
  type Locale,
} from "@/lib/i18n/locales";

type MessageModule = typeof import("@/lib/i18n/messages");

let messageModuleRequest: Promise<MessageModule> | null = null;

function loadMessageModule(): Promise<MessageModule> {
  messageModuleRequest ??= import("@/lib/i18n/messages");
  return messageModuleRequest;
}

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (source: string) => string;
};

const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => undefined,
  t: (source) => source,
});

const TRANSLATABLE_ATTRIBUTES = ["alt", "aria-description", "aria-label", "placeholder", "title"] as const;
const SKIPPED_ELEMENTS = new Set(["CODE", "PRE", "SCRIPT", "STYLE", "TEXTAREA"]);

function shouldSkip(node: Node): boolean {
  const parent = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return Boolean(parent?.closest("[data-i18n-ignore], code, pre, script, style, textarea"))
    || Boolean(parent && SKIPPED_ELEMENTS.has(parent.tagName));
}

function translateTrimmedText(
  source: string,
  locale: Locale,
  translateMessage: MessageModule["translateMessage"],
): string {
  if (!source.trim()) return source;

  const leading = source.match(/^\s*/)?.[0] ?? "";
  const trailing = source.match(/\s*$/)?.[0] ?? "";
  const trimmed = source.trim();
  const normalized = trimmed.replace(/\s+/gu, " ");
  const translated = translateMessage(locale, normalized);

  return `${leading}${translated === normalized && normalized !== trimmed ? trimmed : translated}${trailing}`;
}

export function I18nProvider({ children, initialLocale = DEFAULT_LOCALE }: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, updateLocale] = useState<Locale>(initialLocale);
  const [messageModule, setMessageModule] = useState<MessageModule | null>(null);
  const originals = useRef(new WeakMap<Node, string>());
  const renderedValues = useRef(new WeakMap<Node, string>());
  const attributeOriginals = useRef(new WeakMap<Element, Map<string, string>>());
  const attributeRendered = useRef(new WeakMap<Element, Map<string, string>>());
  const metadataOriginals = useRef(new Map<Element, string>());
  const metadataRendered = useRef(new Map<Element, string>());
  const originalTitle = useRef<string | null>(null);
  const renderedTitle = useRef<string | null>(null);

  const applyDocumentLocale = useCallback((nextLocale: Locale) => {
    document.documentElement.lang = nextLocale;
    document.documentElement.dir = localeDirection(nextLocale);
    document.documentElement.dataset.locale = nextLocale;
  }, []);

  const translateMetadata = useCallback((nextLocale: Locale) => {
    if (!messageModule) return;
    const { canonicalMessageSource, translateMessage } = messageModule;
    const currentTitle = document.title;
    if (originalTitle.current === null || (renderedTitle.current !== null && currentTitle !== renderedTitle.current && currentTitle !== originalTitle.current)) {
      originalTitle.current = canonicalMessageSource(currentTitle);
    }
    const nextTitle = translateMessage(nextLocale, originalTitle.current);
    if (currentTitle !== nextTitle) document.title = nextTitle;
    renderedTitle.current = nextTitle;

    const metadata = document.querySelectorAll<HTMLMetaElement>([
      'meta[name="description"]',
      'meta[property="og:title"]',
      'meta[property="og:description"]',
      'meta[name="twitter:title"]',
      'meta[name="twitter:description"]',
    ].join(","));
    for (const element of metadata) {
      const savedSource = metadataOriginals.current.get(element);
      const savedRendered = metadataRendered.current.get(element);
      const source = savedSource === undefined || (savedRendered !== undefined && element.content !== savedRendered && element.content !== savedSource)
        ? canonicalMessageSource(element.content)
        : savedSource;
      metadataOriginals.current.set(element, source);
      const translated = translateMessage(nextLocale, source);
      if (element.content !== translated) element.content = translated;
      metadataRendered.current.set(element, translated);
    }
    const ogLocale = document.querySelector<HTMLMetaElement>('meta[property="og:locale"]');
    if (ogLocale) ogLocale.content = openGraphLocale(nextLocale);
  }, [messageModule]);

  const translateNode = useCallback((root: Node, nextLocale: Locale) => {
    if (!messageModule) return;
    const { translateMessage } = messageModule;
    function visit(node: Node) {
      if (shouldSkip(node)) return;

      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? "";
        const previousSource = originals.current.get(node);
        const previousRendered = renderedValues.current.get(node);
        const source = previousSource === undefined || (previousRendered !== undefined && text !== previousRendered && text !== previousSource)
          ? text
          : previousSource;
        originals.current.set(node, source);
        const nextText = translateTrimmedText(source, nextLocale, translateMessage);
        if (text !== nextText) node.textContent = nextText;
        renderedValues.current.set(node, nextText);
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const element = node as Element;
      const savedAttributes = attributeOriginals.current.get(element) ?? new Map<string, string>();
      const renderedAttributes = attributeRendered.current.get(element) ?? new Map<string, string>();
      for (const attribute of TRANSLATABLE_ATTRIBUTES) {
        const current = element.getAttribute(attribute);
        if (current === null) continue;
        const previousSource = savedAttributes.get(attribute);
        const previousRendered = renderedAttributes.get(attribute);
        const source = previousSource === undefined || (previousRendered !== undefined && current !== previousRendered && current !== previousSource)
          ? current
          : previousSource;
        savedAttributes.set(attribute, source);
        const translated = translateTrimmedText(source, nextLocale, translateMessage);
        if (translated !== current) element.setAttribute(attribute, translated);
        renderedAttributes.set(attribute, translated);
      }
      if (savedAttributes.size > 0) attributeOriginals.current.set(element, savedAttributes);
      if (renderedAttributes.size > 0) attributeRendered.current.set(element, renderedAttributes);

      for (const child of element.childNodes) visit(child);
    }

    visit(root);
  }, [messageModule]);

  useEffect(() => {
    let storedLocale: string | null = null;
    try {
      storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch {
      // Storage can be unavailable in hardened/private browsing contexts.
    }
    const bootstrappedLocale = document.documentElement.dataset.locale ?? null;
    const detected = resolveInitialLocale(storedLocale ?? bootstrappedLocale, navigator.languages?.length ? navigator.languages : [navigator.language]);
    applyDocumentLocale(detected);
    const timer = window.setTimeout(() => updateLocale(detected), 0);
    let idleTimer: number | undefined;
    let idleCallback: number | undefined;
    const requestMessages = () => {
      void loadMessageModule().then(setMessageModule);
    };
    const requestIdle = (window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    }).requestIdleCallback;
    const cancelIdle = (window as Window & {
      cancelIdleCallback?: (handle: number) => void;
    }).cancelIdleCallback;
    if (detected !== DEFAULT_LOCALE) {
      requestMessages();
    } else if (typeof requestIdle === "function") {
      idleCallback = requestIdle(requestMessages, { timeout: 1_200 });
    } else {
      idleTimer = window.setTimeout(requestMessages, 300);
    }
    return () => {
      window.clearTimeout(timer);
      if (idleTimer !== undefined) window.clearTimeout(idleTimer);
      if (idleCallback !== undefined) cancelIdle?.(idleCallback);
    };
  }, [applyDocumentLocale]);

  useEffect(() => {
    applyDocumentLocale(locale);
    if (!messageModule) return;
    translateMetadata(locale);
    translateNode(document.body, locale);

    const observer = new MutationObserver((records) => {
      if (typeof document === "undefined" || !document.body) return;
      observer.disconnect();
      for (const record of records) {
        if (record.type === "characterData" || record.type === "attributes") translateNode(record.target, locale);
        for (const node of record.addedNodes) translateNode(node, locale);
      }
      observer.observe(document.body, { attributes: true, attributeFilter: [...TRANSLATABLE_ATTRIBUTES], childList: true, characterData: true, subtree: true });
    });
    observer.observe(document.body, { attributes: true, attributeFilter: [...TRANSLATABLE_ATTRIBUTES], childList: true, characterData: true, subtree: true });
    const headObserver = new MutationObserver(() => {
      headObserver.disconnect();
      translateMetadata(locale);
      headObserver.observe(document.head, { attributes: true, attributeFilter: ["content"], childList: true, characterData: true, subtree: true });
    });
    headObserver.observe(document.head, { attributes: true, attributeFilter: ["content"], childList: true, characterData: true, subtree: true });
    return () => {
      observer.disconnect();
      headObserver.disconnect();
    };
  }, [applyDocumentLocale, locale, messageModule, translateMetadata, translateNode]);

  const setLocale = useCallback((nextLocale: Locale) => {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    } catch {
      // Storage can be unavailable while cookies are still permitted.
    }
    try {
      document.cookie = `cryptobot-locale=${encodeURIComponent(nextLocale)}; Path=/; Max-Age=31536000; SameSite=Lax`;
    } catch {
      // The in-memory preference still works for this page view.
    }
    updateLocale(nextLocale);
    applyDocumentLocale(nextLocale);
    if (!messageModule) void loadMessageModule().then(setMessageModule);
  }, [applyDocumentLocale, messageModule]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t: (source) => messageModule?.translateMessage(locale, source) ?? source,
  }), [locale, messageModule, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
