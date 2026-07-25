# A2A Remote Agent Submission

## Agent

- Name: Factor Research Agent
- Team: OOD Team Plus
- Summary: Handles natural-language investment research tasks through an A2A Remote Agent endpoint, reusing the local advisor workflow, semantic catalog, portfolio snapshots, and research/backtest tooling.

## Endpoints

- Agent Card URL: `https://<your-host>/.well-known/agent-card.json`
- Service endpoint: `POST https://<your-host>/message:send`
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

- Data Skills: `semantic_catalog`, `pandadata_research`, `portfolio_snapshot`, `market_observability`
- Research Skills: `factor_analysis`, `strategy_backtest`, `portfolio_risk_review`, `compliance_review`
