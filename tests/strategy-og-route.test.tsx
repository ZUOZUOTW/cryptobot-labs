// @vitest-environment node

import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const loadPublicStrategyPublication = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/public-strategy-loader", () => ({ loadPublicStrategyPublication }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "attacker.invalid" }),
}));

import OpenGraphImage from "../app/strategies/[slug]/opengraph-image";
import { generateMetadata } from "../app/strategies/[slug]/page";

let assetServer: Server;
let previousPublicOrigin: string | undefined;

beforeAll(async () => {
  const mascot = await readFile("public/mascots/ai-builder.png");
  assetServer = createServer((request, response) => {
    if (request.url !== "/mascots/ai-builder.png") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "image/png" });
    response.end(mascot);
  });
  await new Promise<void>((resolve, reject) => {
    assetServer.once("error", reject);
    assetServer.listen(0, "127.0.0.1", resolve);
  });
  const address = assetServer.address();
  if (!address || typeof address === "string") throw new Error("poster asset server did not bind a TCP port");
  previousPublicOrigin = process.env.PUBLIC_ORIGIN;
  process.env.PUBLIC_ORIGIN = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (previousPublicOrigin === undefined) delete process.env.PUBLIC_ORIGIN;
  else process.env.PUBLIC_ORIGIN = previousPublicOrigin;
  await new Promise<void>((resolve, reject) => assetServer.close((error) => error ? reject(error) : resolve()));
});

describe("member strategy Open Graph route", () => {
  it("versions metadata and share poster URLs with the publication update time", async () => {
    loadPublicStrategyPublication.mockResolvedValue({
      actualEndAt: Date.UTC(2024, 1, 3),
      actualStartAt: Date.UTC(2024, 0, 2),
      description: "Public strategy",
      market: "spot",
      metrics: { totalReturn: "0.12" },
      name: "Member strategy",
      publishedAt: Date.UTC(2024, 1, 4),
      publisherName: "Publisher",
      slug: "member-strategy",
      symbol: "BTCUSDT",
      timeframe: "4h",
      updatedAt: 1_707_004_800_000,
    });

    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "member-strategy" }) });
    expect(metadata.openGraph).toMatchObject({
      url: "/strategies/member-strategy?v=1707004800000",
      images: [{ url: "/strategies/member-strategy/opengraph-image?v=1707004800000" }],
    });
    expect(metadata.twitter).toMatchObject({
      images: ["/strategies/member-strategy/opengraph-image?v=1707004800000"],
    });
  });

  it("renders a real 1200 × 630 PNG with a bounded long title and historical evidence dates", async () => {
    loadPublicStrategyPublication.mockResolvedValue({
      actualEndAt: Date.UTC(2024, 1, 3),
      actualStartAt: Date.UTC(2024, 0, 2),
      blocks: [],
      description: "Public strategy",
      equityCurve: [],
      hasPrivateSource: false,
      leverage: 1,
      logicMode: "all",
      market: "spot",
      metrics: {
        annualizedReturn: "0.05",
        maxDrawdown: "0.08",
        profitFactor: "1.2",
        sharpe: "0.9",
        totalReturn: "0.12",
        trades: 42,
        winRate: "0.55",
      },
      name: "m".repeat(100),
      publishedAt: Date.UTC(2024, 1, 4),
      publisherName: "W".repeat(100),
      slug: "member-strategy",
      symbol: "BTCUSDT",
      timeframe: "4h",
      tradeDirection: "long",
      updatedAt: Date.UTC(2024, 1, 4),
      weexReferralUrl: null,
    });

    const response = await OpenGraphImage({ params: Promise.resolve({ slug: "member-strategy" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");

    const png = Buffer.from(await response.arrayBuffer());
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  }, 20_000);
});
