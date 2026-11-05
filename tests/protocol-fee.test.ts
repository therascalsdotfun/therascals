import { expect, it } from "vitest";
import { protocolFeeSplit } from "../packages/shared/src/protocol-fee.ts";
it("takes exactly 0.5% from the USDC input, including the $5 example", () => {
  expect(protocolFeeSplit("5000000")).toMatchObject({
    feeBps: 50,
    feeAtomic: "25000",
    principalAtomic: "4975000",
  });
  for (const amount of [
    "1",
    "199",
    "200",
    "1000000",
    "7500000",
    "100000000",
    "18446744073709551615",
  ]) {
    const s = protocolFeeSplit(amount);
    expect(BigInt(s.feeAtomic) + BigInt(s.principalAtomic)).toBe(
      BigInt(amount),
    );
    expect(BigInt(s.feeAtomic)).toBe((BigInt(amount) * 50n) / 10000n);
  }
});
it("rejects malformed, signed, floating point and overflow amounts", () => {
  for (const value of [
    "",
    "0",
    "-1",
    "+5",
    "01",
    "1.5",
    "1e6",
    "NaN",
    "18446744073709551616",
  ])
    expect(() => protocolFeeSplit(value)).toThrow();
});
