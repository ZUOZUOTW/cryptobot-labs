import { validateDraftConfig } from "./strategy-validation";
import type { BotConfig } from "./types";

const DRAFT_STORAGE_KEY = "cryptobot-labs:draft:v1";

export type SaveDraftResult = { ok: true } | { ok: false; reason: string };

export const saveDraft = (config: BotConfig): SaveDraftResult => {
  try {
    const validation = validateDraftConfig(config);
    if (!validation.valid) return { ok: false, reason: `策略設定無效：${validation.errors.join("；")}` };
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(config));
    return { ok: true };
  } catch {
    return { ok: false, reason: "無法儲存策略草稿" };
  }
};

export const loadDraft = (): BotConfig | null => {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (raw === null) return null;
    const config = JSON.parse(raw) as unknown;
    if (!validateDraftConfig(config).valid) return null;
    return config as BotConfig;
  } catch {
    return null;
  }
};
