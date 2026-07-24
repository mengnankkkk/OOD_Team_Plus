import { describe, expect, it } from "vitest";

import { isSSRFBlocked } from "./web-adapter";

describe("isSSRFBlocked", () => {
  it("blocks localhost and private IPs", () => {
    expect(isSSRFBlocked("http://localhost:3000")).toBe(true);
    expect(isSSRFBlocked("http://127.0.0.1")).toBe(true);
    expect(isSSRFBlocked("http://10.0.0.1")).toBe(true);
    expect(isSSRFBlocked("http://192.168.1.1")).toBe(true);
    expect(isSSRFBlocked("http://172.16.0.1")).toBe(true);
    expect(isSSRFBlocked("http://169.254.169.254")).toBe(true);
  });

  it("blocks invalid URLs", () => {
    expect(isSSRFBlocked("not-a-url")).toBe(true);
  });

  it("allows public URLs", () => {
    expect(isSSRFBlocked("https://example.com")).toBe(false);
  });
});
