import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("A2A agent card route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("publishes the message endpoint through the agent card URL", async () => {
    vi.stubEnv("APP_ORIGIN", "https://agents.example.com/");

    const response = await GET(new NextRequest("https://ignored.example/.well-known/agent-card.json"));
    const body = await response.json();
    const serviceEndpoint = "https://agents.example.com/api/a2a/message-send";

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body).toMatchObject({
      name: "Factor Research Agent",
      url: serviceEndpoint,
      preferredTransport: "JSONRPC",
      provider: {
        organization: "OOD Team Plus",
        url: "https://agents.example.com",
      },
      supportedInterfaces: [
        {
          url: serviceEndpoint,
          protocolBinding: "JSONRPC",
          protocolVersion: "1.0",
        },
      ],
      metadata: {
        agentCardUrl: "https://agents.example.com/.well-known/agent-card.json",
        serviceEndpoint,
      },
    });
    expect(body.securityRequirements).toEqual([{ bearerAuth: [] }]);
    expect(body.security).toEqual([{ bearerAuth: [] }]);
  });
});
