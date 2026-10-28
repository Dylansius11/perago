import {
  BaseError,
  HttpRequestError,
  RpcRequestError,
  TimeoutError,
} from "viem";
import { describe, expect, it } from "vitest";

import { isTransportError } from "./user-operation.js";

const rpcError = (code: number, message: string, data?: string) =>
  new RpcRequestError({
    body: { method: "eth_call" },
    error: { code, message, ...(data === undefined ? {} : { data }) },
    url: "https://rpc.example.test",
  });

describe("RPC transport error classification", () => {
  it.each([
    [429, "Too many requests"],
    [-32000, "exceeded its compute units per second capacity"],
    [-32005, "request limit exceeded"],
    [-32603, "Internal error"],
    [-32000, "request timed out"],
    [-32000, "service unavailable"],
  ])(
    "recognizes provider failure %s %s, including wrapped errors",
    (code, message) => {
      expect(isTransportError(rpcError(code, message))).toBe(true);
      expect(
        isTransportError(
          new BaseError("read failed", { cause: rpcError(code, message) }),
        ),
      ).toBe(true);
    },
  );

  it("preserves HTTP throttling and timeouts", () => {
    expect(
      isTransportError(
        new HttpRequestError({ url: "https://rpc.example.test", status: 429 }),
      ),
    ).toBe(true);
    expect(
      isTransportError(
        new TimeoutError({
          url: "https://rpc.example.test",
          body: { method: "eth_call" },
        }),
      ),
    ).toBe(true);
  });

  it("does not hide contract reverts, invalid RPC parameters, or commitment bugs", () => {
    expect(
      isTransportError(rpcError(3, "execution reverted", "0x12345678")),
    ).toBe(false);
    expect(
      isTransportError(
        rpcError(-32000, "execution reverted: capacity", "0x12345678"),
      ),
    ).toBe(false);
    expect(
      isTransportError(rpcError(-32000, "execution reverted: capacity")),
    ).toBe(false);
    expect(isTransportError(rpcError(-32602, "Invalid params"))).toBe(false);
    expect(
      isTransportError(
        new Error(
          "public receipt commitment disagrees with finalized MandateExecutor",
        ),
      ),
    ).toBe(false);
  });
});
