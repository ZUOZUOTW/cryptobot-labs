import { describe, expect, it } from "vitest";

import { redactSensitive } from "../src/redaction";

describe("redactSensitive", () => {
  it("recursively redacts every sensitive key without mutating input", () => {
    const input = {
      apiKey: "api",
      nested: {
        SECRETKEY: "secret",
        Passphrase: "phrase",
        safe: "visible",
      },
      headers: [
        {
          "access-key": "key",
          "ACCESS-SIGN": "sign",
          "Access-Passphrase": "pass",
          Authorization: "Bearer token",
          signature: "signature",
        },
      ],
    };

    const result = redactSensitive(input);

    expect(result).toEqual({
      apiKey: "[REDACTED]",
      nested: {
        SECRETKEY: "[REDACTED]",
        Passphrase: "[REDACTED]",
        safe: "visible",
      },
      headers: [
        {
          "access-key": "[REDACTED]",
          "ACCESS-SIGN": "[REDACTED]",
          "Access-Passphrase": "[REDACTED]",
          Authorization: "[REDACTED]",
          signature: "[REDACTED]",
        },
      ],
    });
    expect(input.apiKey).toBe("api");
    expect(input.nested.SECRETKEY).toBe("secret");
    expect(input.headers[0].Authorization).toBe("Bearer token");
  });

  it("clones arrays and preserves cyclic references safely", () => {
    const input: { items: unknown[]; self?: unknown } = {
      items: [{ apiKey: "api" }],
    };
    input.self = input;

    const result = redactSensitive(input);

    expect(result).not.toBe(input);
    expect(result.items).not.toBe(input.items);
    expect(result.items).toEqual([{ apiKey: "[REDACTED]" }]);
    expect(result.self).toBe(result);
  });
});
