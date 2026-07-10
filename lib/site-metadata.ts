import type { Metadata } from "next";

const DEFAULT_SITE_METADATA = {
  title: "CryptoBot Labs｜WEEX 自動交易策略實驗室",
  description: "探索、比較並組裝 WEEX 專屬自動交易策略，透過可重現的模擬回測安全驗證交易想法。",
} as const;

const SOCIAL_IMAGE = {
  width: 1672,
  height: 941,
  alt: "CryptoBot Labs：把交易想法，組裝成你的機器人。WEEX ONLY",
} as const;

type HeaderReader = Pick<Headers, "get">;
type SiteMetadataCopy = typeof DEFAULT_SITE_METADATA;

const firstHeaderValue = (value: string | null) => value?.split(",", 1)[0]?.trim() ?? "";

export function requestOrigin(requestHeaders: HeaderReader): URL | null {
  const forwardedHost = firstHeaderValue(requestHeaders.get("x-forwarded-host"));
  const host = forwardedHost || firstHeaderValue(requestHeaders.get("host"));
  if (!host || /[\\/?#@\s]/.test(host)) return null;

  const forwardedProtocol = firstHeaderValue(requestHeaders.get("x-forwarded-proto")).toLowerCase();
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : "https";

  try {
    const origin = new URL(`${protocol}://${host}`);
    return origin.hostname && origin.pathname === "/" ? new URL(origin.origin) : null;
  } catch {
    return null;
  }
}

export function buildSiteMetadata(
  origin: URL | null,
  copy: SiteMetadataCopy = DEFAULT_SITE_METADATA,
): Metadata {
  const imageUrl = origin ? new URL("/og.png", origin) : null;

  return {
    title: copy.title,
    description: copy.description,
    ...(origin ? { metadataBase: origin } : {}),
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      type: "website",
      locale: "zh_TW",
      siteName: "CryptoBot Labs",
      title: copy.title,
      description: copy.description,
      ...(origin ? { url: origin } : {}),
      ...(imageUrl ? { images: [{ url: imageUrl, ...SOCIAL_IMAGE }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: copy.title,
      description: copy.description,
      ...(imageUrl ? { images: [imageUrl] } : {}),
    },
  };
}
