import type {
  CancelOpenOrdersResult,
  ExecutionCoordinator,
} from "@cryptobot-labs/trading-core";

export interface EmergencyRunControl {
  latchEmergency(at: number): void | Promise<void>;
}

export interface PositionClosePort {
  closePositions(deploymentId: string, at: number): Promise<unknown>;
}

export interface EmergencyAuditEvent {
  readonly type: "emergency-stop" | "cancel-open-orders" | "close-positions";
  readonly deploymentId: string;
  readonly at: number;
  readonly status: "requested" | "completed" | "failed";
}

export interface LocalEmergencyStopDependencies {
  readonly coordinator: Pick<ExecutionCoordinator, "emergencyStop" | "cancelOpenOrders">;
  readonly runControl: EmergencyRunControl;
  readonly closer: PositionClosePort;
  readonly audit: (event: Readonly<EmergencyAuditEvent>) => void | Promise<void>;
}

function assertInput(deploymentId: string, at: number): void {
  if (!deploymentId || deploymentId.length > 128) throw new TypeError("invalid deployment id");
  if (!Number.isSafeInteger(at) || at < 0) throw new TypeError("invalid timestamp");
}

/** Local controls remain available without the website or control plane. */
export class LocalEmergencyStop {
  readonly #dependencies: LocalEmergencyStopDependencies;
  #latched = false;

  constructor(dependencies: LocalEmergencyStopDependencies) {
    this.#dependencies = dependencies;
  }

  get latched(): boolean {
    return this.#latched;
  }

  async stopNewOrders(deploymentId: string, at: number): Promise<void> {
    assertInput(deploymentId, at);
    // Latch synchronously first so a failed audit/runtime shutdown can never
    // leave the order coordinator accepting new proposals.
    this.#dependencies.coordinator.emergencyStop();
    this.#latched = true;
    await this.#audit("emergency-stop", deploymentId, at, "requested");
    try {
      await this.#dependencies.runControl.latchEmergency(at);
      await this.#audit("emergency-stop", deploymentId, at, "completed");
    } catch (failure) {
      await this.#audit("emergency-stop", deploymentId, at, "failed");
      throw failure;
    }
  }

  async cancelOpenOrders(
    deploymentId: string,
    at: number,
    confirmation: string,
  ): Promise<CancelOpenOrdersResult> {
    assertInput(deploymentId, at);
    if (confirmation !== "CANCEL OPEN ORDERS") {
      throw new Error("cancel-open-orders confirmation is required");
    }
    await this.#audit("cancel-open-orders", deploymentId, at, "requested");
    try {
      const result = await this.#dependencies.coordinator.cancelOpenOrders(deploymentId, at);
      await this.#audit("cancel-open-orders", deploymentId, at, "completed");
      return result;
    } catch (failure) {
      await this.#audit("cancel-open-orders", deploymentId, at, "failed");
      throw failure;
    }
  }

  async closePositions(
    deploymentId: string,
    at: number,
    confirmation: string,
  ): Promise<unknown> {
    assertInput(deploymentId, at);
    if (confirmation !== "CLOSE POSITIONS") {
      throw new Error("close-positions confirmation is required");
    }
    await this.#audit("close-positions", deploymentId, at, "requested");
    try {
      const result = await this.#dependencies.closer.closePositions(deploymentId, at);
      await this.#audit("close-positions", deploymentId, at, "completed");
      return result;
    } catch (failure) {
      await this.#audit("close-positions", deploymentId, at, "failed");
      throw failure;
    }
  }

  async #audit(
    type: EmergencyAuditEvent["type"],
    deploymentId: string,
    at: number,
    status: EmergencyAuditEvent["status"],
  ): Promise<void> {
    try {
      await this.#dependencies.audit(Object.freeze({ type, deploymentId, at, status }));
    } catch {
      // Local safety controls never depend on telemetry availability.
    }
  }
}
