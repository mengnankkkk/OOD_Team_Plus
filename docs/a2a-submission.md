# A2A Remote Agent Submission

## Agent

- Name: Factor Research Agent
- Team: OOD Team Plus
- Summary: Handles natural-language investment research through an A2A Remote Agent endpoint, reusing the local advisor workflow for profiling, evidence-backed research, portfolio risk analysis, factor research, deterministic strategy backtests, recommendation drafting, and compliance-gated explanations. The product is research- and simulation-only. It does not connect to brokers or place real orders.

## Endpoints

- Agent Card URL: `https://<your-host>/.well-known/agent-card.json`
- Service endpoint: `POST https://<your-host>/api/a2a/message-send`
- Trace endpoint: `GET https://<your-host>/api/a2a/analyses/<analysis-id>/events` (SSE)
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

When `status.state` is `input-required`, send the answer as another `message/send` request with the same `contextId` and `taskId`. The gateway consumes the pending clarification, persists the profile fields, and reruns the original advisor task. The response metadata contains a Bearer-authenticated `streamUrl` for the same A2A caller.

## Skills

- `advisor_chat`: main Chief Advisor conversation experience.
- `factor_analysis`: analyze factor, signal, and market context using authorized data and research skills.
- `portfolio_risk_review`: review holdings, risk exposure, missing information, and scenario-sensitive recommendations.
- `factor_research`: calls PandaData `get_factor` through the Chief Advisor and returns sample statistics plus data limitations.
- `strategy_backtest`: calls historical market data through the Chief Advisor and runs a deterministic 20-day moving-average backtest with explicit cost assumptions.

- Data Skills: `semantic_catalog`, `pandadata_research`, `portfolio_snapshot`, `market_observability`
- Research Skills: `factor_analysis`, `strategy_backtest`, `portfolio_risk_review`, `compliance_review`

## Product Capability Surface

Only the following capabilities are declared as A2A skills. Workbench-only APIs are intentionally not advertised as A2A skills:

- `advisor_chat`: main Chief Advisor conversation experience.
- `factor_research`: single-symbol factor sample retrieval and descriptive statistics; cross-sectional IC requires an explicit universe and is not fabricated.
- `strategy_backtest`: historical close-based deterministic backtest with sample, fee, drawdown, and limitation disclosure.

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
  -> server-side publication gate
  -> A2A task: completed / input-required / failed
  -> Bearer-authenticated SSE trace URL
```

The publication gate can produce `ACTIVE`, `DEGRADED`, or `BLOCKED` outcomes. The A2A gateway exposes only the conversational advisor, factor research, and strategy backtest capabilities; other product workflows remain workbench-only.
