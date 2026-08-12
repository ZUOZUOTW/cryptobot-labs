import { spawn } from "node:child_process";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const LOOPBACK_HOST = "127.0.0.1";
const BUILD_ORIGIN = "https://e2e.cryptobot.invalid";
const START_TIMEOUT_MS = 60_000;
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const rawArguments = process.argv.slice(2).filter((argument) => argument !== "--");
const skipBuild = process.env.E2E_SKIP_BUILD === "true" || rawArguments.includes("--skip-build");
const playwrightArguments = rawArguments.filter((argument) => argument !== "--skip-build");

function availablePort() {
  return new Promise((resolve, reject) => {
    const reservation = createNetServer();
    reservation.unref();
    reservation.once("error", reject);
    reservation.listen(0, LOOPBACK_HOST, () => {
      const address = reservation.address();
      if (!address || typeof address === "string") {
        reservation.close();
        reject(new Error("Unable to reserve a loopback port for browser tests."));
        return;
      }
      reservation.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function withoutUpgradeInsecureRequests(value) {
  if (typeof value !== "string") return value;
  return value
    .split(";")
    .map((directive) => directive.trim())
    .filter((directive) => directive !== "upgrade-insecure-requests")
    .join("; ");
}

function startLoopbackProxy(backendOrigin, port) {
  const backend = new URL(backendOrigin);
  const proxy = createHttpServer((incoming, outgoing) => {
    const upstream = httpRequest({
      headers: {
        ...incoming.headers,
        "x-forwarded-host": incoming.headers.host ?? "",
        "x-forwarded-proto": "http",
      },
      hostname: backend.hostname,
      method: incoming.method,
      path: incoming.url,
      port: backend.port,
    }, (response) => {
      const headers = { ...response.headers };
      const csp = headers["content-security-policy"];
      if (Array.isArray(csp)) headers["content-security-policy"] = csp.map(withoutUpgradeInsecureRequests);
      else if (csp) headers["content-security-policy"] = withoutUpgradeInsecureRequests(csp);
      outgoing.writeHead(response.statusCode ?? 502, headers);
      response.pipe(outgoing);
    });
    upstream.once("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      outgoing.end("E2E loopback proxy unavailable");
    });
    incoming.once("aborted", () => upstream.destroy());
    incoming.pipe(upstream);
  });
  return new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(port, LOOPBACK_HOST, () => resolve(proxy));
  });
}

function child(command, arguments_, environment) {
  return spawn(command, arguments_, {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
  });
}

function completed(processHandle, label) {
  return new Promise((resolve, reject) => {
    processHandle.once("error", reject);
    processHandle.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed (${signal ?? `exit ${code ?? "unknown"}`}).`));
    });
  });
}

async function waitForServer(processHandle, origin) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Production server exited before it became ready (exit ${processHandle.exitCode}).`);
    }
    try {
      const response = await fetch(origin, { redirect: "manual", signal: AbortSignal.timeout(2_000) });
      if (response.status < 500) return;
    } catch {
      // The server is still starting.
    }
    await delay(250);
  }
  throw new Error(`Production server did not become ready within ${START_TIMEOUT_MS / 1_000} seconds.`);
}

async function stop(processHandle) {
  if (!processHandle || processHandle.exitCode !== null) return;
  processHandle.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => processHandle.once("exit", resolve)),
    delay(5_000),
  ]);
  if (processHandle.exitCode === null) processHandle.kill("SIGKILL");
}

async function closeProxy(proxy) {
  if (!proxy) return;
  await new Promise((resolve) => proxy.close(resolve));
}

function safeEnvironment(publicOrigin) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (/^(?:AWS_|EXECUTOR_|NEXT_PUBLIC_SUPABASE_|POSTGRES_|SUPABASE_|WEEX_)/u.test(key)
      || key === "AUTH_COOKIE_SECRET"
      || key === "DATABASE_URL") {
      delete environment[key];
    }
  }
  return {
    ...environment,
    DEMO_MODE: "true",
    LIVE_TRADING_ENABLED: "false",
    NEXT_TELEMETRY_DISABLED: "1",
    PUBLIC_ORIGIN: publicOrigin,
  };
}

let productionServer;
let loopbackProxy;
try {
  if (!skipBuild) {
    await completed(child(pnpmCommand, ["build"], safeEnvironment(BUILD_ORIGIN)), "Production build");
  }

  const backendPort = await availablePort();
  let publicPort = await availablePort();
  while (publicPort === backendPort) publicPort = await availablePort();
  const backendOrigin = `http://${LOOPBACK_HOST}:${backendPort}`;
  const publicOrigin = `http://${LOOPBACK_HOST}:${publicPort}`;
  const runtimeEnvironment = safeEnvironment(publicOrigin);
  productionServer = child(process.execPath, [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    LOOPBACK_HOST,
    "--port",
    String(backendPort),
  ], runtimeEnvironment);
  await waitForServer(productionServer, backendOrigin);
  loopbackProxy = await startLoopbackProxy(backendOrigin, publicPort);
  await waitForServer(productionServer, publicOrigin);

  const testEnvironment = {
    ...runtimeEnvironment,
    PLAYWRIGHT_BASE_URL: publicOrigin,
  };
  await completed(
    child(pnpmCommand, ["exec", "playwright", "test", ...playwrightArguments], testEnvironment),
    "Browser acceptance tests",
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Browser acceptance tests failed.");
  process.exitCode = 1;
} finally {
  await closeProxy(loopbackProxy);
  await stop(productionServer);
}
