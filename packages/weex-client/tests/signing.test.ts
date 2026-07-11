import { describe, expect, it } from "vitest";

import {
  buildPrivateHeaders,
  buildSignaturePayload,
  canonicalJson,
  canonicalQuery,
  signWeexRequest,
} from "../src/signing";
import signingVectors from "./fixtures/signing-vectors.json";

describe("canonicalQuery", () => {
  it("sorts encoded keys and values while preserving duplicate entries", () => {
    expect(
      canonicalQuery([
        ["tag", "a"],
        ["symbol", "BTC/USDT"],
        ["tag", "β"],
        ["note", "fast order"],
      ]),
    ).toBe("note=fast%20order&symbol=BTC%2FUSDT&tag=%CE%B2&tag=a");
  });

  it("uses RFC3986 encoding for characters encodeURIComponent leaves unescaped", () => {
    expect(canonicalQuery([["!*'() ~", "!*'() ~"]])).toBe(
      "%21%2A%27%28%29%20~=%21%2A%27%28%29%20~",
    );
  });

  it("sorts by encoded code units rather than locale collation", () => {
    expect(
      canonicalQuery([
        ["a", "1"],
        ["Z", "1"],
      ]),
    ).toBe("Z=1&a=1");
  });
});

describe("canonicalJson", () => {
  it("sorts object keys recursively and applies JSON undefined semantics", () => {
    expect(
      canonicalJson({
        z: undefined,
        b: [3, undefined, { z: 1, a: "x" }],
        a: "hi",
      }),
    ).toBe('{"a":"hi","b":[3,null,{"a":"x","z":1}]}');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite number %s",
    (value) => {
      expect(() => canonicalJson({ value })).toThrow(/finite/i);
    },
  );

  it("rejects bigint values and cyclic structures", () => {
    expect(() => canonicalJson({ value: BigInt(1) })).toThrow(/bigint/i);

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(/cyclic/i);
  });
});

describe("WEEX request signing", () => {
  it("builds and signs the independent GET golden vector", async () => {
    const vector = signingVectors.getWithoutQuery;
    const payload = buildSignaturePayload(vector);

    expect(payload).toBe(vector.payload);
    await expect(signWeexRequest(payload, vector.secret)).resolves.toBe(vector.signature);
  });

  it("builds and signs the independent POST golden vector using the exact transmitted body", async () => {
    const vector = signingVectors.postWithQueryAndJsonBody;
    const transmittedBody = canonicalJson({
      symbol: "BTCUSDT",
      size: "0.001",
      side: "buy",
      price: "30000.5",
    });
    const signedBody = transmittedBody;
    const payload = buildSignaturePayload({ ...vector, body: signedBody });

    expect(signedBody).toBe(transmittedBody);
    expect(transmittedBody).toBe(vector.body);
    expect(payload).toBe(vector.payload);
    await expect(signWeexRequest(payload, vector.secret)).resolves.toBe(vector.signature);
  });

  it("uppercases methods and omits the question mark when query is empty", () => {
    expect(
      buildSignaturePayload({
        timestamp: "123",
        method: "get",
        requestPath: "/orders",
        query: "",
        body: "",
      }),
    ).toBe("123GET/orders");
  });

  it.each([
    { method: "", requestPath: "/orders", query: "" },
    { method: "GET /evil", requestPath: "/orders", query: "" },
    { method: "GET", requestPath: "orders", query: "" },
    { method: "GET", requestPath: "/orders?existing=1", query: "" },
    { method: "GET", requestPath: "/orders", query: "?symbol=BTCUSDT" },
  ])("rejects malformed signature components: %o", (input) => {
    expect(() =>
      buildSignaturePayload({ timestamp: "123", body: "", ...input }),
    ).toThrow();
  });

  it("builds the required private request headers", () => {
    expect(
      buildPrivateHeaders({
        apiKey: "key",
        passphrase: "phrase",
        timestamp: "1690000000000",
        signature: "signed",
      }),
    ).toEqual({
      "ACCESS-KEY": "key",
      "ACCESS-SIGN": "signed",
      "ACCESS-PASSPHRASE": "phrase",
      "ACCESS-TIMESTAMP": "1690000000000",
      "Content-Type": "application/json",
    });
  });
});
