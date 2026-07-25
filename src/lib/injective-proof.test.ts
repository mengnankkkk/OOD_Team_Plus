import { describe, expect, it } from "vitest";

import { buildProofCalldata, buildProofDeploymentData, canonicalizeReport, INJECTIVE_PROOF_PREFIX_HEX, sha256Hex } from "./injective-proof";

describe("Injective report proof", () => {
  it("canonicalizes line endings and outer whitespace", () => {
    expect(canonicalizeReport("  第一行\r\n第二行\r  ")).toBe("第一行\n第二行");
  });

  it("calculates a stable SHA-256 digest", async () => {
    await expect(sha256Hex("Money Whisperer")).resolves.toBe(
      "0x728e8975b01f4ed4f9b4b236fb2021e0105954c3bd1d8c2fad68329153fcc929",
    );
  });

  it("builds an MWP1-prefixed 36-byte payload", () => {
    const hash = `0x${"ab".repeat(32)}`;
    const calldata = buildProofCalldata(hash);
    expect(calldata).toBe(`0x${INJECTIVE_PROOF_PREFIX_HEX}${"ab".repeat(32)}`);
    expect((calldata.length - 2) / 2).toBe(36);
  });

  it("builds valid init code for an inert proof capsule contract", () => {
    const hash = `0x${"ab".repeat(32)}`;
    const deploymentData = buildProofDeploymentData(hash);
    expect(deploymentData).toBe(`0x6025600c60003960256000f300${INJECTIVE_PROOF_PREFIX_HEX}${"ab".repeat(32)}`);
    expect((deploymentData.length - 2) / 2).toBe(49);
  });

  it("rejects malformed hashes", () => {
    expect(() => buildProofCalldata("0x1234")).toThrow("报告哈希格式无效");
    expect(() => buildProofDeploymentData("0x1234")).toThrow("报告哈希格式无效");
  });
});
