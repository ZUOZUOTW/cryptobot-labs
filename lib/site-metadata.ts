import type { Metadata } from "next";

export const SITE_TITLE = "CryptoBot Labs｜自動交易策略實驗室";
export const SITE_DESCRIPTION = "探索、組裝與分享自動交易策略；先用公開歷史資料回測與模擬運行，再安全準備雲端執行。";
export const SOCIAL_IMAGE_ALT = "CryptoBot Labs：簡單點選，實現自動化策略";

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
type SiteMetadataCopy = {
  title: string;
  description: string;
  locale?: string;
  imageAlt?: string;
};

const isLoopbackHostname = (hostname: string) => (
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
);

export function configuredSiteOrigin(value: unknown): URL | null {
  if (typeof value !== "string" || value.length === 0) return null;

  try {
    const parsed = new URL(value);
    const loopbackHttp = parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname);
    if ((parsed.protocol !== "https:" && !loopbackHttp)
      || parsed.username || parsed.password
      || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return new URL(parsed.origin);
  } catch {
    return null;
  }
}

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
      apple: "/icons/cryptobot-192.png",
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "CryptoBot",
    },
    openGraph: {
      type: "website",
      locale: copy.locale ?? "zh_TW",
      siteName: "CryptoBot Labs",
      title: copy.title,
      description: copy.description,
      ...(origin ? { url: origin } : {}),
      ...(imageUrl ? { images: [{ url: imageUrl, ...SOCIAL_IMAGE, alt: copy.imageAlt ?? SOCIAL_IMAGE.alt }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: copy.title,
      description: copy.description,
      ...(imageUrl ? { images: [{ url: imageUrl, ...SOCIAL_IMAGE, alt: copy.imageAlt ?? SOCIAL_IMAGE.alt }] } : {}),
    },
  };
}
