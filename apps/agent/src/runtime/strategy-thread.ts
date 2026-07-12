import { parentPort } from "node:worker_threads";

import {
  LIVE_SANDBOX_BUDGET,
  SandboxExecutionError,
  createQuickJsStrategySandbox,
  type StrategySandbox,
} from "@cryptobot-labs/trading-core";

import type { StrategyWorkerRequest, StrategyWorkerResult } from "./strategy-worker";

type ThreadRequest = Readonly<{ id: number; request: StrategyWorkerRequest }>;
type ThreadResponse =
  | Readonly<{ id: number; ok: true; result: StrategyWorkerResult }>
  | Readonly<{ id: number; ok: false; code: string }>;

const port = parentPort;
if (!port) throw new Error("Strategy thread requires a parent port");

let sandbox: StrategySandbox | null = null;

void createQuickJsStrategySandbox(LIVE_SANDBOX_BUDGET).then(
  (created) => {
    sandbox = created;
    port.postMessage({ type: "ready" });
  },
  () => port.postMessage({ type: "startup-error" }),
);

port.on("message", async (message: ThreadRequest) => {
  if (!Number.isSafeInteger(message?.id) || !message?.request) return;
  const response = await evaluate(message).catch((error: unknown): ThreadResponse => ({
    id: message.id,
    ok: false,
    code: error instanceof SandboxExecutionError ? error.code : "sandbox-fault",
  }));
  port.postMessage(response);
});

async function evaluate(message: ThreadRequest): Promise<ThreadResponse> {
  if (!sandbox) throw new Error("Strategy sandbox is not ready");
  try {
    return { id: message.id, ok: true, result: await sandbox.evaluate(message.request) };
  } catch (error) {
    await sandbox.dispose().catch(() => undefined);
    sandbox = null;
    throw error;
  }
}
