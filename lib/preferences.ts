export interface DiscoveryPreferences {
  market: "all" | "spot" | "futures";
  risk: "all" | "低" | "中" | "高";
  tag: string;
  timeframe: string;
  sort: "return-desc" | "drawdown-asc" | "win-rate-desc" | "stability-desc";
  favorites: string[];
}

const STORAGE_KEY = "cryptobot-labs:discovery:v1";
const MARKETS = new Set(["all", "spot", "futures"]);
const RISKS = new Set(["all", "低", "中", "高"]);
const SORTS = new Set(["return-desc", "drawdown-asc", "win-rate-desc", "stability-desc"]);

export type SavePreferencesResult = { ok: true } | { ok: false; reason: string };

const isPreferences = (value: unknown): value is DiscoveryPreferences => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.market === "string" && MARKETS.has(item.market)
    && typeof item.risk === "string" && RISKS.has(item.risk)
    && typeof item.tag === "string"
    && typeof item.timeframe === "string"
    && typeof item.sort === "string" && SORTS.has(item.sort)
    && Array.isArray(item.favorites)
    && item.favorites.every((favorite) => typeof favorite === "string");
};

export const loadDiscoveryPreferences = (): DiscoveryPreferences | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isPreferences(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const saveDiscoveryPreferences = (preferences: DiscoveryPreferences): SavePreferencesResult => {
  try {
    if (!isPreferences(preferences)) return { ok: false, reason: "探索偏好格式不正確" };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    return { ok: true };
  } catch {
    return { ok: false, reason: "無法儲存探索偏好" };
  }
};
