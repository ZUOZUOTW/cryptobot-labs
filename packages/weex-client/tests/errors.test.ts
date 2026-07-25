import { describe, expect, it } from "vitest";

import { WeexApiError, mapWeexError } from "../src/errors";

describe("mapWeexError", () => {
  it.each([
    [400, { code: "40005" }, "clock", false],
    [400, { code: "40006" }, "authentication", false],
    [400, { code: "40009" }, "authentication", false],
    [400, { code: "40012" }, "authentication", false],
    [400, { code: "40014" }, "permission", false],
    [400, { code: "40018" }, "permission", false],
    [401, { code: -1040 }, "authentication", false],
    [403, { code: -1058 }, "permission", false],
    [429, { code: "429" }, "rate-limit", true],
    [400, { code: "40017" }, "validation", false],
    [404, { code: "404" }, "not-found", false],
    [503, { code: "50000" }, "server", true],
  ] as const)("maps status %s and body", (status, body, category, retryable) => {
    expect(mapWeexError(status, body)).toMatchObject({ category, retryable, status });
  });

  it.each([
    [-1054, "server", true],
    [-1043, "clock", false],
    [-1046, "clock", false],
    [-1045, "validation", false],
    [-1044, "authentication", false],
    [-1047, "authentication", false],
    [-1051, "permission", false],
    [-1058, "permission", false],
    [-1115, "validation", false],
    [-1135, "validation", false],
    [-1140, "validation", false],
    [-1171, "validation", false],
  ] as const)("maps official code %s explicitly", (code, category, retryable) => {
    expect(mapWeexError(400, { code, msg: "official" })).toMatchObject({ category, retryable });
  });

  it("treats malformed beta error bodies as schema failures", () => {
    const error = mapWeexError(400, ["unexpected"]);
    expect(error).toBeInstanceOf(WeexApiError);
    expect(error).toMatchObject({ category: "schema", retryable: false });
  });
});
