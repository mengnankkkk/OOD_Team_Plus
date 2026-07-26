# A2A External Capability Gateway

Money Whisperer exposes its primary multi-agent research and simulation workflows through:

```text
GET  https://<host>/.well-known/agent-card.json
POST https://<host>/api/a2a/message-send
POST https://<host>/api/a2a/message:send
GET  https://<host>/api/a2a/tasks
GET  https://<host>/api/a2a/tasks/{id}
POST https://<host>/api/a2a/tasks/{id}:cancel
DELETE https://<host>/api/a2a/contexts/{id}
```

Use `Authorization: Bearer <client-specific-token>`. Administrators create tokens with
`POST /api/v1/admin/a2a-clients`; the raw token is returned once and only its SHA-256 hash is stored.

## Capability Metadata

Set these fields on `message.metadata`:

```json
{
  "capabilityId": "debate_mode",
  "operation": "start",
  "input": {
    "targetSymbol": "AAPL",
    "profile": {
      "riskLevel": "BALANCED",
      "horizon": "MEDIUM_TERM",
      "maxDrawdown": "0.15"
    },
    "goals": [],
    "portfolio": {
      "cash": "20000",
      "holdings": [
        { "symbol": "AAPL", "quantity": "10", "cost": "170" }
      ]
    }
  }
}
```

The caller never supplies an authoritative current price. The server resolves instruments and retrieves
market prices before persisting the isolated context snapshot.

## Executable Skills

- `chief_advisor_conversation`: `send`, `answer_clarification`
- `debate_mode`: `start`, `continue`, `join_bull`, `join_bear`, `summarize`, `finalize`
- `scenario_simulation`: `start`, `generate_options`, `get_options`, `execute_option`, `get_tree`, `get_snapshot`, `switch_branch`, `undo`, `archive`
- `research_search`: `start`, `get_results`, `refine`, `retry`, `cancel`

Task reads require `tasks_read`; cancellation and early context deletion require `tasks_cancel`.

## Execution Time

The send endpoint waits briefly for fast capabilities, then returns the persisted task instead of
holding the HTTP connection open for the full agent run. When `status.state` is
`TASK_STATE_SUBMITTED` or `TASK_STATE_WORKING`, poll `GET /api/a2a/tasks/{id}` until the task reaches
`TASK_STATE_COMPLETED`, `TASK_STATE_INPUT_REQUIRED`, `TASK_STATE_FAILED`, or `TASK_STATE_CANCELED`.
`A2A_INITIAL_RESPONSE_TIMEOUT_MS` controls the initial wait budget and defaults to 750 milliseconds.

## JSON-RPC Example

```json
{
  "jsonrpc": "2.0",
    "id": "demo-1",
    "method": "message/send",
    "params": {
      "message": {
        "role": "ROLE_USER",
        "messageId": "demo-message-1",
        "parts": [
        { "text": "Search independent sources for current AAPL supply-chain risks." }
        ],
      "metadata": {
        "capabilityId": "research_search",
        "operation": "start",
        "input": {
          "query": "AAPL supply-chain risks",
          "adapters": ["WEB", "MCP", "KNOWLEDGE_BASE", "RSS"],
          "maximumResults": 10
        }
      }
    }
  }
}
```

Aliases are supported for `message/send`/`SendMessage`, `tasks/get`/`GetTask`,
`tasks/list`/`ListTasks`, and `tasks/cancel`/`CancelTask`.

## Isolation And Retention

Each external context receives a temporary non-login execution principal. All profile, goals, portfolio
snapshots, conversations, debates, simulations, research searches, and artifacts are scoped to that
principal plus the external client ID. Contexts expire after 30 days and may be deleted earlier by the owner.

## Internal Chain

```text
Agent Card
  -> JSON-RPC or HTTP+JSON adapter
  -> client token, scope, rate limit
  -> context and task ownership
  -> capability adapter
       -> Chief Advisor and specialist agents
       -> Evidence/Bull/Bear/Judge debate agents
       -> deterministic branch simulation services
       -> independent research adapters
  -> persisted A2A task and artifacts
```

The product is research- and simulation-only. It does not connect to brokers, place orders, guarantee
returns, or provide individualized investment advice.
