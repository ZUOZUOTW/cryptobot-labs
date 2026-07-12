import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmergencyStopDialog } from "../components/runs/EmergencyStopDialog";
import { LiveUnlockDialog } from "../components/runs/LiveUnlockDialog";
import { RunCard } from "../components/runs/RunCard";
import { permissionsForDevice, RunDetailPanel } from "../components/runs/RunDetailPanel";
import { parseRunList, parseRunView } from "../components/runs/run-parser";
import type { RiskPolicy, RunView } from "../components/runs/types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const policy: RiskPolicy = {
  id: "risk_1", allowedSymbols: ["BTCUSDT"], maxOrderNotional: "100", maxPositionNotional: "500",
  maxTotalExposure: "1000", maxSimultaneousPositions: 2, maxDailyLoss: "50", maxLeverage: "3",
  maxSlippageBps: 30, minSignalCooldownMs: 60000, maxConsecutiveFailures: 3, operationMode: "approval-required",
};

const run: RunView = {
  id: "run_1", botName: "Orbit", market: "futures", mode: "paper", state: "running", health: null, pnl: null,
  positions: [], openOrders: [], lastSignal: null, riskBlocks: [], device: { id: "dev_1" },
  evidence: { heartbeatOccurredAt: null, heartbeatExpectedDeploymentVersion: null, pnlSource: null },
  strategyVersion: { id: "version_1" }, version: 2, updatedAt: 1_700_000_000_000, riskPolicy: policy,
};

const permissions = { verified: true, hasLocalCredential: true, read: true, trade: true, withdrawal: false as const };

describe("run control UI", () => {
  it("defaults to paper and requires typed confirmation plus loss acknowledgement for live", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<LiveUnlockDialog botName="Orbit" onConfirm={onConfirm} permissions={permissions} policy={policy} />);
    expect(screen.getByText("模擬運行（預設）")).toBeInTheDocument();
    expect(screen.getAllByText(/本機代理.*重新驗證/)).toHaveLength(2);
    const confirm = screen.getByRole("button", { name: "確認並啟用實盤" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText("輸入機器人名稱"), "Orbit");
    expect(confirm).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /了解所有交易均可能產生損失/ }));
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ typedBotName: "Orbit", riskAcknowledged: true, riskPolicy: expect.objectContaining({ maxDailyLoss: "50", maxLeverage: "3" }) }));
  });

  it("keeps live locked without verified local trade evidence", async () => {
    const user = userEvent.setup();
    render(<LiveUnlockDialog botName="Orbit" permissions={{ ...permissions, verified: false }} policy={policy} />);
    await user.type(screen.getByLabelText("輸入機器人名稱"), "Orbit");
    await user.click(screen.getByRole("checkbox", { name: /了解所有交易均可能產生損失/ }));
    expect(screen.getByRole("button", { name: "確認並啟用實盤" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("不能申請實盤");
  });

  it("shows every persisted risk limit as review-only evidence", () => {
    render(<LiveUnlockDialog botName="Orbit" permissions={permissions} policy={policy} />);
    const fieldset = screen.getByRole("group", { name: "實盤風險上限" });
    expect(within(fieldset).getByLabelText("允許交易對")).toHaveValue("BTCUSDT");
    expect(within(fieldset).getByText("單筆訂單上限 USDT")).toBeInTheDocument();
    expect(within(fieldset).getByText("單一部位上限 USDT")).toBeInTheDocument();
    expect(within(fieldset).getByText("總曝險上限 USDT")).toBeInTheDocument();
    expect(within(fieldset).getByText("單日最大虧損 USDT")).toBeInTheDocument();
    expect(within(fieldset).getByText("最大槓桿")).toBeInTheDocument();
    expect(fieldset).toBeDisabled();
  });

  it("keeps stop, cancel, and close as three independent commands", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn(async () => undefined);
    render(<EmergencyStopDialog onCommand={onCommand} />);
    await user.click(screen.getByRole("button", { name: "立即停止新訂單" }));
    expect(onCommand).toHaveBeenLastCalledWith({ type: "stop-new-orders", reason: "user-emergency-stop" });
    expect(onCommand).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "取消所有未成交訂單" }));
    const cancelDialog = screen.getByRole("dialog", { name: "確認取消所有未成交訂單" });
    expect(cancelDialog).toHaveTextContent("不會關閉任何既有部位");
    await user.click(within(cancelDialog).getByRole("button", { name: "確認取消掛單" }));
    expect(onCommand).toHaveBeenLastCalledWith({ type: "cancel-open-orders", scope: "deployment", reason: "user-emergency-cancel" });
    expect(onCommand).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: "關閉所有部位" }));
    const closeDialog = screen.getByRole("dialog", { name: "高風險：確認關閉所有部位" });
    const close = within(closeDialog).getByRole("button", { name: "高風險確認：關閉部位" });
    expect(close).toBeDisabled();
    await user.type(within(closeDialog).getByLabelText("輸入 CLOSE POSITIONS"), "CLOSE POSITIONS");
    await user.click(within(closeDialog).getByRole("checkbox", { name: /嘗試關閉所有現有部位/ }));
    expect(close).toBeEnabled();
    await user.click(close);
    expect(onCommand).toHaveBeenLastCalledWith(expect.objectContaining({ type: "close-positions", confirmationPhrase: "CLOSE POSITIONS", riskAcknowledged: true }));
    expect(onCommand).toHaveBeenCalledTimes(3);
  });

  it("labels absent telemetry as absent evidence instead of inventing values", () => {
    render(<RunCard run={run} />);
    expect(screen.getByRole("heading", { name: "Orbit" })).toBeInTheDocument();
    expect(screen.getByText(/合約 · 模擬運行（預設）/)).toBeInTheDocument();
    expect(screen.getByText("尚無代理證據")).toBeInTheDocument();
    expect(screen.getByText("尚無可信證據")).toBeInTheDocument();
    expect(screen.getByText("尚未收到訊號")).toBeInTheDocument();
    expect(screen.getByText("尚未收到目前版本心跳")).toBeInTheDocument();
  });

  it("selects only the permission required by the run market", () => {
    const response = { connections: [{ id: "dev_1", connection: { status: "verified", hasLocalCredential: true,
      permissions: { read: true, spotTrade: true, futuresTrade: false, withdrawal: false } } }] };
    expect(permissionsForDevice(response, "dev_1", "spot")?.trade).toBe(true);
    expect(permissionsForDevice(response, "dev_1", "futures")?.trade).toBe(false);
  });

  it("keeps the live entry disabled when the device lacks the run market permission", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ run }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ connections: [{ id: "dev_1", connection: {
        status: "verified", hasLocalCredential: true,
        permissions: { read: true, spotTrade: true, futuresTrade: false, withdrawal: false },
      } }], nextCursor: null }), { status: 200 }));
    render(<RunDetailPanel runId="run_1" />);
    expect(await screen.findByRole("button", { name: "實盤權限未就緒" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "申請啟用實盤" })).not.toBeInTheDocument();
  });
});

describe("run response parser", () => {
  it("accepts the exact safe contract and object cursor", () => {
    expect(parseRunView(run)).toEqual(run);
    expect(parseRunList({ runs: [run], nextCursor: { createdAt: 1_700_000_000_000, id: "run_1" } })).toEqual({ runs: [run], nextCursor: { createdAt: 1_700_000_000_000, id: "run_1" } });
  });

  it("rejects unknown fields, malformed telemetry, and partial cursors", () => {
    expect(parseRunView({ ...run, apiSecret: "must-not-render" })).toBeNull();
    expect(parseRunView({ ...run, positions: [{ symbol: "BTCUSDT" }] })).toBeNull();
    expect(parseRunList({ runs: [run], nextCursor: { id: "run_1" } })).toBeNull();
    expect(parseRunView({ ...run, evidence: { heartbeatOccurredAt: 100, heartbeatExpectedDeploymentVersion: 1, pnlSource: "heartbeat-positions" }, pnl: "1" })).toBeNull();
  });
});
