import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectionWizard } from "../apps/agent/src/renderer/ConnectionWizard";
import { PairingWizard } from "../apps/agent/src/renderer/PairingWizard";
import type { AgentRendererApi } from "../apps/agent/src/shared/ipc-contract";

afterEach(cleanup);

function api(overrides: Partial<AgentRendererApi> = {}): AgentRendererApi {
  const defaults: AgentRendererApi = {
    getStatus: vi.fn(async () => ({ state: "unconfigured" as const, credential: { configured: false, apiKeySuffix: "" }, paired: false, pairingState: "unpaired" as const, startAtLogin: false })),
    saveCredentials: vi.fn(async () => ({ configured: true, apiKeySuffix: "1234" })),
    verifyCredentials: vi.fn(async () => ({ provider: "WEEX" as const, apiKeySuffix: "1234", verifiedAt: "2026-07-12T00:00:00.000Z",
      permissions: { read: true, spotTrade: true, futuresTrade: false, withdrawal: false as const } })),
    eraseCredentials: vi.fn(async () => undefined),
    pair: vi.fn(async () => ({ paired: true, deviceId: "device-1" })),
    setStartAtLogin: vi.fn(async () => undefined),
    emergencyStop: vi.fn(async () => undefined),
    getUpdateStatus: vi.fn(async () => ({ state: "idle" as const, version: null, reason: null })),
    checkForUpdates: vi.fn(async () => ({ state: "checking" as const, version: null, reason: null })),
    installUpdate: vi.fn(async () => undefined),
    onPairingSuggestion: vi.fn(() => () => undefined),
  };
  return { ...defaults, ...overrides };
}

describe("agent setup wizards", () => {
  it("pairs with a one-time code without collecting any WEEX credential", async () => {
    const user = userEvent.setup();
    const agentApi = api();
    const onChanged = vi.fn(async () => undefined);
    const onMessage = vi.fn();
    render(<PairingWizard api={agentApi} paired={false} startAtLogin={false} onChanged={onChanged} onMessage={onMessage} />);

    expect(screen.queryByLabelText(/Secret Key/i)).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("配對碼"));
    await user.type(screen.getByLabelText("配對碼"), "CBL-abcdefghijklmnopqrstuv");
    await user.clear(screen.getByLabelText("裝置名稱"));
    await user.type(screen.getByLabelText("裝置名稱"), "我的 Mac");
    await user.click(screen.getByRole("button", { name: "配對裝置" }));

    await waitFor(() => expect(agentApi.pair).toHaveBeenCalledWith({ code: "CBL-abcdefghijklmnopqrstuv", deviceName: "我的 Mac" }));
    expect(onChanged).toHaveBeenCalledOnce();
    expect(onMessage).toHaveBeenCalledWith(expect.stringContaining("配對完成"));
  });

  it("prefills a code from the website deep link and keeps a safe fallback when camera scanning is unavailable", async () => {
    const user = userEvent.setup();
    const suggestedCode = `CBL-${"Q".repeat(22)}`;
    render(<PairingWizard api={api()} paired={false} startAtLogin={false} suggestedCode={suggestedCode}
      onChanged={vi.fn(async () => undefined)} onMessage={vi.fn()} />);
    expect(screen.getByLabelText("配對碼")).toHaveValue(suggestedCode);
    await user.click(screen.getByRole("button", { name: "用相機掃描 QR Code" }));
    expect(await screen.findByText(/不支援相機掃描/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "關閉 QR 掃描" })).toBeInTheDocument();
  });

  it("keeps credential entry locked until pairing and clears every secret field after submission", async () => {
    const user = userEvent.setup();
    const agentApi = api();
    const onChanged = vi.fn(async () => undefined);
    const onMessage = vi.fn();
    const view = render(<ConnectionWizard api={agentApi} configured={false} paired={false} onChanged={onChanged} onMessage={onMessage} />);

    expect(screen.getByLabelText("API Key")).toBeDisabled();
    expect(screen.getByLabelText("Secret Key")).toBeDisabled();
    expect(screen.getByText(/請先完成網站配對/)).toBeInTheDocument();

    view.rerender(<ConnectionWizard api={agentApi} configured={false} paired onChanged={onChanged} onMessage={onMessage} />);
    await user.type(screen.getByLabelText("API Key"), "api-key-1234");
    await user.type(screen.getByLabelText("Secret Key"), "local-secret-key");
    await user.type(screen.getByLabelText("Passphrase"), "local-passphrase");
    await user.click(screen.getByRole("button", { name: "加密保存" }));

    await waitFor(() => expect(agentApi.saveCredentials).toHaveBeenCalledWith({
      apiKey: "api-key-1234", secretKey: "local-secret-key", passphrase: "local-passphrase",
    }));
    expect(screen.getByLabelText("API Key")).toHaveValue("");
    expect(screen.getByLabelText("Secret Key")).toHaveValue("");
    expect(screen.getByLabelText("Passphrase")).toHaveValue("");
    expect(document.body.textContent).not.toContain("local-secret-key");
    expect(document.body.textContent).not.toContain("local-passphrase");
  });

  it("does not misreport a successful mutation when the follow-up status refresh fails", async () => {
    const user = userEvent.setup();
    const onMessage = vi.fn();
    render(<PairingWizard api={api()} paired={false} startAtLogin={false}
      onChanged={vi.fn(async () => { throw new Error("offline"); })} onMessage={onMessage} />);
    await user.type(screen.getByLabelText("配對碼"), `CBL-${"_".repeat(22)}`);
    await user.click(screen.getByRole("button", { name: "配對裝置" }));

    await waitFor(() => expect(onMessage).toHaveBeenLastCalledWith(expect.stringMatching(/配對完成.*無法重新讀取狀態/)));
    expect(onMessage).not.toHaveBeenCalledWith(expect.stringContaining("配對失敗"));
  });
});
