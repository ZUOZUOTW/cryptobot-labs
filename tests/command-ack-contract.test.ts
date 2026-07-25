import { describe, expect, it } from "vitest";

import { CONTROL_CLIENT_LATE_ACK_WINDOW_MS } from "../apps/agent/src/main/control-client";
import { COMMAND_ACK_GRACE_MS } from "../db/repositories";

describe("durable command acknowledgement contract", () => {
  it("keeps the agent drain window identical to the server late-ack grace", () => {
    expect(CONTROL_CLIENT_LATE_ACK_WINDOW_MS).toBe(COMMAND_ACK_GRACE_MS);
  });
});
