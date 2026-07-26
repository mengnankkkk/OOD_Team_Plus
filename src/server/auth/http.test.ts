import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { requestIp, setSessionCookies } from "./http";

describe("requestIp", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("ignores spoofable proxy headers unless the proxy boundary is trusted", () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "false");
    const request = new NextRequest("http://localhost/login", {
      headers: {
        "x-forwarded-for": "203.0.113.10",
        "x-real-ip": "203.0.113.11",
      },
    });

    expect(requestIp(request)).toBeNull();
  });

  it("uses the first forwarded address behind an explicitly trusted proxy", () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "true");
    const request = new NextRequest("http://localhost/login", {
      headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.2" },
    });

    expect(requestIp(request)).toBe("203.0.113.10");
  });

  it("ignores forwarded protocol when the proxy boundary is not trusted", () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "false");
    const request = new NextRequest("https://money.example/login", {
      headers: { "x-forwarded-proto": "http" },
    });
    const response = NextResponse.json({});

    setSessionCookies(response, {
      token: "session-token",
      csrfToken: "csrf-token",
      maxAge: 60,
    }, request);

    expect(response.headers.get("set-cookie")).toContain("Secure");
  });
});
