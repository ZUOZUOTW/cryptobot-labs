const PAIRING_CODE = /^CBL-[A-Za-z0-9_-]{22}$/;

export function pairingCodeFromDeepLink(value: string): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "cryptobot-labs:" || url.hostname !== "pair" || url.pathname !== ""
    || url.username || url.password || url.port || url.hash || [...url.searchParams.keys()].join(",") !== "code") return null;
  const code = url.searchParams.get("code");
  return code && PAIRING_CODE.test(code) ? code : null;
}

export function pairingCodeFromArguments(argumentsList: readonly string[]): string | null {
  for (const value of argumentsList) {
    const code = pairingCodeFromDeepLink(value);
    if (code) return code;
  }
  return null;
}
