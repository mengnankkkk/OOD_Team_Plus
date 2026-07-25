# A2A Remote Agent Submission

## Agent

- Name: Money Whisperer Chief Advisor
- Team: OOD Team Plus
- Summary: Money Whisperer's primary multi-agent financial research and advisory agent. It coordinates user profiling, evidence-backed research, portfolio risk diagnosis, scenario reasoning, recommendation drafting, and compliance-gated explanations.

The product is research- and simulation-only. It does not connect to brokers or place real orders.

## Endpoints

- Agent Card URL: `https://<your-host>/.well-known/agent-card.json`
- Service endpoint: `POST https://<your-host>/api/a2a/message-send`
- Auth: `Authorization: Bearer <A2A_BEARER_TOKEN>`

## Example Request

```json
{
  "jsonrpc": "2.0",
  "id": "demo-1",
  "method": "message/send",
  "params": {
    "message": {
      "kind": "message",
      "role": "user",
      "messageId": "demo-message-1",
      "contextId": "demo-context-1",
      "parts": [
        { "kind": "text", "text": "分析 AAPL 当前是否适合加仓，并说明主要风险。" }
      ]
    }
  }
}
```

## Expected Output

The service returns an A2A task object with `status.state`, an explainable markdown answer in `status.message.parts`, and a final artifact when the task is completed. Outputs include assumptions, missing-data questions when needed, and a risk notice; they do not constitute investment advice.

## Skills

- `chief_advisor_conversation`: natural-language orchestration through the Chief Advisor and professional specialist agents.
- `profile_and_goal_planning`: risk profile, investment goals, constraints, liquidity needs, and missing information.
- `evidence_backed_research`: instrument, market, event, and data-freshness research.
- `portfolio_risk_diagnosis`: holdings, concentration, drawdown, exposure, and stress-case analysis.
- `recommendation_and_compliance`: research-only recommendations with supporting/counter evidence and publication gating.

## Product Capability Surface

The A2A endpoint is the conversational gateway. The following product workflows are also represented in the Agent Card; some are exposed through the workbench and dedicated `/api/v1` endpoints:

- `advisor_chat`: main Chief Advisor conversation experience.
- `debate_mode`: bull-versus-bear discussion comparing evidence, assumptions, counterarguments, and open questions.
- `scenario_simulation`: frozen-snapshot branch simulation with hold, rebalance, and defensive alternatives.
- `evidence_lab`: evidence packs, data snapshots, research metrics, counter evidence, and provenance.
- `research_search`: web, MCP, knowledge-base, and RSS-backed research with citations.
- `semantic_query_and_artifacts`: read-only semantic queries and Markdown/chart artifacts.
- `portfolio_and_goal_management`: profiles, goals, holdings, snapshots, and recommendation decisions.
- `monitoring_and_alerts`: watch conditions, portfolio alerts, notifications, and preferences.

## Internal Agent Architecture

```text
A2A Agent Card
  -> POST /api/a2a/message-send
  -> handleSendMessage
  -> runConversationAgent
  -> runProfessionalAdvisor
  -> Chief Advisor
       -> Profile Context
       -> Data Research
       -> Portfolio Risk
       -> Recommendation
       -> Compliance Reviewer
       -> Explanation Report
       -> Scenario Planner
  -> server-side publication gate
  -> A2A task: completed / input-required / failed
```

The publication gate can produce `ACTIVE`, `DEGRADED`, or `BLOCKED` outcomes. Product-specific workflows may persist their own analysis and SSE state behind the dedicated APIs.
