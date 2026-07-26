import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudRunDetailPanel } from "../components/runs/CloudRunDetailPanel";

vi.mock("../components/I18nProvider", () => ({
  useI18n: () => ({ locale: "zh-TW" }),
}));

const run = {
  id: "crun_live_1",
  name: "突破獵手",
  mode: "live",
  state: "error",
  version: 2,
  lastCandleAt: 1_760_000_000_000,
  lastEvaluatedAt: 1_760_000_100_000,
  lastSignalJson: null,
  lastErrorCode: "execution_failed",
  consecutiveFailures: 4,
  updatedAt: 1_760_000_200_000,
  allowedSymbols: ["BTCUSDT"],
  accountObservedAt: 1_760_000_300_000,
  accountEquity: "5000",
  availableEquity: "5000",
  unrealizedPnl: "0",
  positionsJson: [],
  evaluationCount: 3,
  signalCount: 0,
  maxTotalExposure: "1000",
  maxDailyLoss: "100",
};

const payload = {
  runs: [run],
  account: {
    observedAt: 1_760_000_300_000,
    accountEquity: "5000",
    availableEquity: "5000",
    unrealizedPnl: "0",
    positionsJson: [],
  },
};

describe("CloudRunDetailPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }),
    ));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads a crun deployment from the cloud-runs API instead of the legacy runs API", async () => {
    render(<CloudRunDetailPanel runId="crun_live_1" />);

    expect(await screen.findByRole("heading", { name: "突破獵手" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢復策略" })).toBeEnabled();
    expect(screen.getByText("Executor 暫停原因：策略執行遇到未分類錯誤。系統已安全暫停，請重新整理；若仍發生請聯絡支援。")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/cloud-runs", expect.objectContaining({ cache: "no-store" }));
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("/api/runs/"), expect.anything());
  });

  it("resumes with the current version and explains order reconciliation", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        run: { ...run, state: "running", version: 3, lastErrorCode: null, consecutiveFailures: 0 },
      }), { status: 200 }));
    const user = userEvent.setup();
    render(<CloudRunDetailPanel runId="crun_live_1" />);

    await user.click(await screen.findByRole("button", { name: "恢復策略" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/cloud-runs/crun_live_1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ state: "running", expectedVersion: 2 }),
      })));
    expect(await screen.findByText("恢復命令已接受；Executor 將先核對未完成訂單，再評估新行情。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "暫停新增交易" })).toBeEnabled();
  });
});
