import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("A2A agent card route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("describes the Chief Advisor and the product capability surface", async () => {
    vi.stubEnv("APP_ORIGIN", "https://agents.example.com/");

    const response = await GET(new NextRequest("https://ignored.example/.well-known/agent-card.json"));
    const body = await response.json();
    const serviceEndpoint = "https://agents.example.com/api/a2a/message-send";

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      name: "Money Whisperer Chief Advisor",
      url: serviceEndpoint,
      preferredTransport: "JSONRPC",
      supportedInterfaces: [
        {
          url: serviceEndpoint,
          protocolBinding: "JSONRPC",
          protocolVersion: "1.0",
        },
      ],
      metadata: {
        agentArchitecture: {
          rootAgent: "professional-chief-advisor",
          conversationEntrypoint: "runConversationAgent",
        },
        productCapabilities: expect.arrayContaining([
          expect.objectContaining({ id: "debate_mode", access: "workbench" }),
          expect.objectContaining({ id: "scenario_simulation", access: "workbench_api" }),
          expect.objectContaining({ id: "evidence_lab", access: "workbench_api" }),
        ]),
      },
    });

    expect(body.skills.map((skill: { id: string }) => skill.id)).toEqual([
      "chief_advisor_conversation",
      "profile_and_goal_planning",
      "evidence_backed_research",
      "portfolio_risk_diagnosis",
      "recommendation_and_compliance",
    ]);
    expect(body.securityRequirements).toEqual([{ bearerAuth: [] }]);
    expect(body.security).toEqual([{ bearerAuth: [] }]);
  });
});
