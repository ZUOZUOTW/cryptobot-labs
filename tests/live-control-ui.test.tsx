import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentDownloadCard } from "../components/connections/AgentDownloadCard";
import { ConnectionsPanel } from "../components/connections/ConnectionsPanel";
import { DeviceCard } from "../components/connections/DeviceCard";
import { PairingCodeCard } from "../components/connections/PairingCodeCard";

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
};

describe("connections control surface", () => {
  it("makes unavailable agent builds explicit and never offers a fake download", () => {
    const { container } = render(<AgentDownloadCard />);
    expect(screen.getByText("macOS")).toBeInTheDocument();
    expect(screen.getByText("Windows")).toBeInTheDocument();
    expect(screen.getAllByText(/Task 16.*尚未提供/)).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /尚未提供下載/ })).toHaveLength(2);
    expect(container.querySelector("a[download]")).toBeNull();
  });

  it("issues a five-minute pairing code without collecting any API credential", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      code: "CBL-AAAAAAAAAAAAAAAAAAAAAA", expiresAt: Date.now() + 300_000,
    }), { status: 201 }));
    const user = userEvent.setup();
    const { container } = render(<PairingCodeCard />);
    expect(container.querySelector('input[name*="secret" i], input[name*="key" i]')).toBeNull();
    await user.click(screen.getByRole("button", { name: "產生五分鐘配對碼" }));
    expect(await screen.findByText("CBL-AAAAAAAAAAAAAAAAAAAAAA")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/pairing-codes", expect.objectContaining({ method: "POST", body: "{}" }));
    expect(screen.getByText(/API Secret.*本機代理/)).toBeInTheDocument();
  });

  it("shows only masked connection evidence, permissions, and safe device controls", async () => {
    const onRevoke = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<DeviceCard device={device} observedAt={1_700_000_010_000} onRevoke={onRevoke} />);
    expect(screen.getByRole("heading", { name: "交易工作站" })).toBeInTheDocument();
    expect(screen.getByText("****7X9K")).toBeInTheDocument();
    expect(screen.getByText("現貨交易：允許")).toBeInTheDocument();
    expect(screen.getByText("提領：未允許")).toBeInTheDocument();
    expect(screen.getByText(/網站不保存.*API Secret/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重新驗證/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /清除本機憑證/ })).toBeDisabled();
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
      lastSeenAt: null, connection: null,
    }], nextCursor: null }), { status: 200 }));
    render(<ConnectionsPanel />);
    expect(await screen.findByText("尚未設定的 Mac")).toBeInTheDocument();
    expect(screen.getByText("已授權")).toBeInTheDocument();
    expect(screen.getByText("代理健康").nextElementSibling).toHaveTextContent("尚未回報");
    expect(screen.queryByText("在線")).not.toBeInTheDocument();
    expect(screen.getByText("交易連線").nextElementSibling).toHaveTextContent("尚未設定");
  });

  it("separates authorization from stale agent health", () => {
    render(<DeviceCard device={{ ...device, lastSeenAt: 1_700_000_000_000 }} observedAt={1_700_000_120_001} onRevoke={vi.fn(async () => undefined)} />);
    expect(screen.getByText("已授權")).toBeInTheDocument();
    expect(screen.getByText("代理健康").nextElementSibling).toHaveTextContent("已超過 2 分鐘未回報");
    expect(screen.queryByText("在線")).not.toBeInTheDocument();
  });
});
