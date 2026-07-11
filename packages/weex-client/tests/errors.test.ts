import { describe, expect, it } from "vitest";

import { WeexApiError, mapWeexError } from "../src/errors";

describe("mapWeexError", () => {
  it.each([
    [401, { code: -1040 }, "authentication", false],
    [403, { code: -1058 }, "permission", false],
    [429, { code: "429" }, "rate-limit", true],
    [400, { code: "40017" }, "validation", false],
    [404, { code: "404" }, "not-found", false],
    [503, { code: "50000" }, "server", true],
  ] as const)("maps status %s and body", (status, body, category, retryable) => {
    expect(mapWeexError(status, body)).toMatchObject({ category, retryable, status });
  });

  it("treats malformed beta error bodies as schema failures", () => {
    const error = mapWeexError(400, ["unexpected"]);
    expect(error).toBeInstanceOf(WeexApiError);
    expect(error).toMatchObject({ category: "schema", retryable: false });
  });
});
