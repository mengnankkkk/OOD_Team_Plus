import { describe, expect, it } from "vitest";

import { buildProofCalldata, canonicalizeReport, INJECTIVE_PROOF_PREFIX_HEX, sha256Hex } from "./injective-proof";

describe("Injective report proof", () => {
  it("canonicalizes line endings and outer whitespace", () => {
    expect(canonicalizeReport("  第一行\r\n第二行\r  ")).toBe("第一行\n第二行");
  });

  it("calculates a stable SHA-256 digest", async () => {
    await expect(sha256Hex("Money Whisperer")).resolves.toBe(
      "0xb4cf008ee51e794fa1950ab0aa9c6c2bc757bd525f1d375e1964cda076b204e7",
    );
  });

  it("builds an MWP1-prefixed 36-byte payload", () => {
    const hash = `0x${"ab".repeat(32)}`;
    const calldata = buildProofCalldata(hash);
    expect(calldata).toBe(`0x${INJECTIVE_PROOF_PREFIX_HEX}${"ab".repeat(32)}`);
    expect((calldata.length - 2) / 2).toBe(36);
  });

  it("rejects malformed hashes", () => {
    expect(() => buildProofCalldata("0x1234")).toThrow("报告哈希格式无效");
  });
});
