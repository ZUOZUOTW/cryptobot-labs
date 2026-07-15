import type { Metadata } from "next";

export const SITE_TITLE = "CryptoBot Labs｜WEEX 自動交易策略實驗室";
export const SITE_DESCRIPTION = "探索、組裝與分享 WEEX 自動交易策略；先用公開歷史資料回測與 Paper 模擬，再透過 WEEX OAuth 安全準備雲端執行。";
export const SOCIAL_IMAGE_ALT = "CryptoBot Labs：把交易想法，組成能先模擬的 WEEX 自動策略。";

const DEFAULT_SITE_METADATA = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
} as const;

const SOCIAL_IMAGE = {
  width: 1672,
  height: 941,
  alt: SOCIAL_IMAGE_ALT,
} as const;

type HeaderReader = Pick<Headers, "get">;
type SiteMetadataCopy = typeof DEFAULT_SITE_METADATA;

const validPort = (port: string | undefined) => {
  if (port === undefined) return true;
  if (!/^[0-9]+$/.test(port)) return false;
  const value = Number(port);
  return value >= 1 && value <= 65_535;
};

const validIPv4 = (hostname: string) => {
  const octets = hostname.split(".");
  return octets.length === 4 && octets.every((octet) => (
    /^(?:0|[1-9][0-9]{0,2})$/.test(octet) && Number(octet) <= 255
  ));
};

const validDomain = (hostname: string) => hostname.length <= 253 && hostname
  .split(".")
  .every((label) => (
    label.length >= 1
    && label.length <= 63
    && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
  ));

export function requestOrigin(requestHeaders: HeaderReader): URL | null {
  const host = requestHeaders.get("host");
  if (!host || /[\u0000-\u0020\u007f,\\/?#@%]/.test(host)) return null;

  let hostname: string;
  if (host.startsWith("[") || host.includes("]")) {
    const ipv6 = host.match(/^\[([0-9A-Fa-f:.]+)\](?::([0-9]+))?$/);
    if (!ipv6 || !validPort(ipv6[2])) return null;
    try {
      hostname = new URL(`https://${host}`).hostname.toLowerCase();
    } catch {
      return null;
    }
  } else {
    const authority = host.match(/^([^:]+)(?::([^:]*))?$/);
    if (!authority || !validPort(authority[2])) return null;
    hostname = authority[1].toLowerCase();
    const numericHostname = /^[0-9.]+$/.test(hostname);
    if (numericHostname ? !validIPv4(hostname) : !validDomain(hostname)) return null;
  }

  const loopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  const protocol = loopback ? "http" : "https";

  try {
    const origin = new URL(`${protocol}://${host}`);
    return new URL(origin.origin);
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
      ...(imageUrl ? { images: [{ url: imageUrl, ...SOCIAL_IMAGE }] } : {}),
    },
  };
}
