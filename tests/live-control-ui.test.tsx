import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentDownloadCard } from "../components/connections/AgentDownloadCard";
import { ConnectionSetupFlow } from "../components/connections/ConnectionSetupFlow";
import { ConnectionsPanel } from "../components/connections/ConnectionsPanel";
import { DeviceCard } from "../components/connections/DeviceCard";
import { PairingCodeCard } from "../components/connections/PairingCodeCard";

vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => "data:image/png;base64,AA==") } }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const device = {
  id: "dev_mac", name: "交易工作站", platform: "macos" as const, deviceStatus: "active" as const,
  lastSeenAt: 1_700_000_000_000,
  connection: {
    provider: "WEEX" as const, maskedApiKeySuffix: "****7X9K",
    permissions: { read: true, spotTrade: true, futuresTrade: false, withdrawal: false },
    verifiedAt: 1_700_000_000_000, status: "verified" as const,
    hasLocalCredential: true,
  },
  commandTarget: { deploymentId: "run_1", expectedVersion: 3 },
};

describe("connections control surface", () => {
  it("makes unavailable agent builds explicit and never offers a fake download", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "unavailable" }), { status: 200 }));
    const { container } = render(<AgentDownloadCard />);
    expect(screen.getAllByText("macOS")).toHaveLength(2);
    expect(screen.getByText("Windows")).toBeInTheDocument();
    expect(await screen.findByText("尚無正式版本")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /尚未提供下載/ })).toHaveLength(3);
    expect(container.querySelector("a[download]")).toBeNull();
  });

  it("offers only verified official release assets with checksum and SBOM evidence", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "available", version: "1.2.3",
      publishedAt: "2026-07-13T00:00:00.000Z", downloads: [
        { platform: "macos-arm64", name: "mac-arm.zip", url: "https://github.com/ZUOZUOTW/cryptobot-labs/releases/download/agent-v1.2.3/mac-arm.zip", sha256: "a".repeat(64), bytes: 100 },
        { platform: "macos-x64", name: "mac-intel.zip", url: "https://github.com/ZUOZUOTW/cryptobot-labs/releases/download/agent-v1.2.3/mac-intel.zip", sha256: "b".repeat(64), bytes: 100 },
        { platform: "windows-x64", name: "agent.exe", url: "https://github.com/ZUOZUOTW/cryptobot-labs/releases/download/agent-v1.2.3/agent.exe", sha256: "c".repeat(64), bytes: 100 }],
      checksumsUrl: "https://github.com/ZUOZUOTW/cryptobot-labs/releases/download/agent-v1.2.3/SHA256SUMS",
      sbomUrl: "https://github.com/ZUOZUOTW/cryptobot-labs/releases/download/agent-v1.2.3/agent-sbom.cdx.json" }), { status: 200 }));
    render(<AgentDownloadCard />);
    expect(await screen.findByText("正式版 v1.2.3")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /下載.*正式版/ })).toHaveLength(3);
    expect(screen.getByRole("link", { name: "校驗碼" })).toHaveAttribute("href", expect.stringContaining("SHA256SUMS"));
    expect(screen.getByRole("link", { name: "SBOM" })).toHaveAttribute("href", expect.stringContaining("agent-sbom"));
  });

  it("issues a five-minute pairing code without collecting any API credential", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      code: "CBL-AAAAAAAAAAAAAAAAAAAAAA", expiresAt: Date.now() + 300_000,
    }), { status: 201 }));
    const user = userEvent.setup();
    const { container } = render(<PairingCodeCard />);
    expect(container.querySelector('input[name*="secret" i], input[name*="key" i]')).toBeNull();
    await user.click(screen.getByRole("button", { name: "產生五分鐘配對 QR Code" }));
    expect(await screen.findByText("CBL-AAAAAAAAAAAAAAAAAAAAAA")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/pairing-codes", expect.objectContaining({ method: "POST", body: "{}" }));
    expect(await screen.findByRole("img", { name: /五分鐘配對 QR Code/ })).toHaveAttribute("src", expect.stringContaining("data:image/png"));
    expect(screen.getByRole("link", { name: "在這台電腦開啟 Agent" })).toHaveAttribute("href",
      "cryptobot-labs://pair?code=CBL-AAAAAAAAAAAAAAAAAAAAAA");
    expect(screen.getByText(/不會送到第三方服務/)).toBeInTheDocument();
  });

  it("presents the setup as four gated steps and unlocks Paper onboarding only after WEEX verification", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/agent-downloads") return new Response(JSON.stringify({ status: "unavailable" }), { status: 200 });
      if (url === "/api/connections") return new Response(JSON.stringify({ connections: [device], nextCursor: null }), { status: 200 });
      return new Response(null, { status: 404 });
    });
    render(<ConnectionSetupFlow />);
    const progress = screen.getByRole("navigation", { name: "Agent 設定進度" });
    expect(within(progress).getAllByRole("listitem")).toHaveLength(4);
    expect(await screen.findByRole("link", { name: "選擇穩健策略並開始模擬" })).toHaveAttribute("href",
      "/workshop?bot=orbit-dca&onboarding=paper");
    expect(screen.getByText("預設 Paper 模式")).toBeInTheDocument();
    expect(screen.getByText("實盤需再次同意風險")).toBeInTheDocument();
  });

  it("shows only masked connection evidence, permissions, and safe device controls", async () => {
    const onRevoke = vi.fn(async () => undefined);
    const user = userEvent.setup();
    const onCommand = vi.fn(async () => undefined);
    render(<DeviceCard device={device} observedAt={1_700_000_010_000} onCommand={onCommand} onRevoke={onRevoke} />);
    expect(screen.getByRole("heading", { name: "交易工作站" })).toBeInTheDocument();
    expect(screen.getByText("****7X9K")).toBeInTheDocument();
    expect(screen.getByText("現貨交易：允許")).toBeInTheDocument();
    expect(screen.getByText("提領：未允許")).toBeInTheDocument();
    expect(screen.getByText(/網站不保存.*API Secret/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重新驗證 WEEX" }));
    expect(onCommand).toHaveBeenCalledWith(device, "revalidate-connection");
    await user.click(screen.getByRole("button", { name: "清除本機憑證" }));
    await user.click(screen.getByRole("button", { name: "確認清除" }));
    expect(onCommand).toHaveBeenCalledWith(device, "erase-local-credentials");
    await user.click(screen.getByRole("button", { name: "撤銷此裝置" }));
    await user.click(screen.getByRole("button", { name: "確認撤銷" }));
    expect(onRevoke).toHaveBeenCalledWith("dev_mac");
  });

  it("loads an ownership-scoped connection list and revokes through the existing device route", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ connections: [device], nextCursor: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ device: { id: "dev_mac", status: "revoked", revokedAt: Date.now() } }), { status: 200 }));
    const user = userEvent.setup();
    render(<ConnectionsPanel />);
    const list = await screen.findByRole("list", { name: "我的代理裝置" });
    expect(within(list).getByText("交易工作站")).toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: "撤銷此裝置" }));
    await user.click(within(list).getByRole("button", { name: "確認撤銷" }));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith("/api/devices/dev_mac", expect.objectContaining({ method: "DELETE" })));
    expect(await screen.findByText("尚無已配對裝置。請先安裝本機代理，再使用上方配對碼。")).toBeInTheDocument();
  });

  it("renders a paired but not-yet-configured device from the exact safe API contract", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ connections: [{
      id: "dev_minimal", name: "尚未設定的 Mac", platform: "macos", deviceStatus: "active",
      lastSeenAt: null, connection: null, commandTarget: null,
    }], nextCursor: null }), { status: 200 }));
    render(<ConnectionsPanel />);
    expect(await screen.findByText("尚未設定的 Mac")).toBeInTheDocument();
    expect(screen.getByText("已授權")).toBeInTheDocument();
    expect(screen.getByText("代理健康").nextElementSibling).toHaveTextContent("尚未回報");
    expect(screen.queryByText("在線")).not.toBeInTheDocument();
    expect(screen.getByText("交易連線").nextElementSibling).toHaveTextContent("尚未設定");
  });

  it("separates authorization from stale agent health", () => {
    render(<DeviceCard device={{ ...device, lastSeenAt: 1_700_000_000_000 }} observedAt={1_700_000_120_001}
      onCommand={vi.fn(async () => undefined)} onRevoke={vi.fn(async () => undefined)} />);
    expect(screen.getByText("已授權")).toBeInTheDocument();
    expect(screen.getByText("代理健康").nextElementSibling).toHaveTextContent("已超過 2 分鐘未回報");
    expect(screen.queryByText("在線")).not.toBeInTheDocument();
  });

  it("queues version-fenced revalidation and credential erasure commands", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ connections: [device], nextCursor: null }), { status: 200 }))
      .mockResolvedValue(new Response(JSON.stringify({ command: { status: "pending" }, idempotent: false }), { status: 202 }));
    const user = userEvent.setup(); render(<ConnectionsPanel />);
    await user.click(await screen.findByRole("button", { name: "重新驗證 WEEX" }));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/runs/run_1/commands", expect.objectContaining({ method: "POST",
      body: JSON.stringify({ type: "revalidate-connection", expectedVersion: 3 }) }));
    expect(await screen.findByText(/重新驗證命令已排隊/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "清除本機憑證" }));
    await user.click(screen.getByRole("button", { name: "確認清除" }));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/runs/run_1/commands", expect.objectContaining({
      body: JSON.stringify({ type: "erase-local-credentials", expectedVersion: 3,
        reason: "user-requested-from-connections" }) }));
    expect(await screen.findByText(/代理會先暫停交易/)).toBeInTheDocument();
  });
});
