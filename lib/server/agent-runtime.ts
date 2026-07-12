import { env } from "cloudflare:workers";
import { createControlPlaneDatabase } from "../../db";
import { createActivityRepository, createCommandRepository, createConnectionRepository, createDeploymentRepository } from "../../db/repositories";
import { createAgentHandlers } from "./agent-routes";
import { createAgentDeploymentBundleHandler, createAgentDeploymentBundleService } from "./agent-deployment-bundle";
import { createCommandService } from "./commands";
import { createDeviceEventService } from "./device-events";
import { createDeviceRequestVerifier } from "./device-signature";
import { errorResponse } from "./http";

interface AgentEnvironment { DB?: unknown }

export function productionAgentFailure(error: unknown): Response {
  return errorResponse(error, { status: 500, code: "internal" });
}

export function createProductionAgentHandlers(environment: AgentEnvironment = env as unknown as AgentEnvironment) {
  const database = createControlPlaneDatabase(environment.DB);
  const activity = createActivityRepository(database);
  const deployments = createDeploymentRepository(database);
  const commands = createCommandRepository(database);
  const verify = createDeviceRequestVerifier({ database, capabilities: [
    "agent.heartbeat", "agent.events", "agent.commands.read", "agent.commands.ack", "agent.deployments.read",
  ] as const });
  return { ...createAgentHandlers({
    verify,
    eventService: createDeviceEventService(activity, { deployments, connections: createConnectionRepository(database) }),
    commandService: createCommandService(commands),
  }), deployments: createAgentDeploymentBundleHandler({ verify, service: createAgentDeploymentBundleService(database) }) };
}
