# A2A External Capability Gateway Design

## 1. Goal

Upgrade Money Whisperer's A2A integration from a single Chief Advisor text endpoint into a stateful external capability gateway.

External clients discovered through:

```text
https://<host>/.well-known/agent-card.json
```

must be able to use:

- Chief Advisor conversations.
- Multi-round bull/bear debate.
- Stateful branch scenario simulation.
- Independent research search.
- Standard task retrieval, listing, cancellation, and ownership isolation.

External workflows must not read or modify any real Money Whisperer user's profile, goals, holdings, recommendations, or history.

The product remains research- and simulation-only. It does not connect to brokers or place real orders.

## 2. Confirmed Product Decisions

### 2.1 External data model

External calls use caller-supplied data rather than a Money Whisperer account.

The caller may submit:

- Risk profile and constraints.
- Investment goals.
- Cash and holdings.
- Debate topic and claims.
- Research query and source preferences.

The caller does not submit current market prices for authoritative use. The server resolves instruments and retrieves current prices through existing market-data services. A client-supplied price is not used as an implicit fallback.

### 2.2 Client identity

Each external integration receives its own Bearer Token.

The token maps to an `externalClientId`, not a product `userId`. The database stores only a cryptographic token hash, a non-secret prefix, status, capability scopes, and audit metadata.

### 2.3 Workflow depth

The first release supports complete stateful workflows:

- Debate can continue across rounds, support side selection and direct questioning, produce judge summaries, and finalize through the Chief Advisor publication gate.
- Simulation can create a workspace, generate options, execute branches, inspect snapshots, switch branches, undo, and archive.
- Research can start, return results, retry failed sources, refine a query, and cancel an active task.

### 2.4 Retention

External contexts and their temporary data expire after 30 days.

Clients may delete a context before expiry. A background cleanup job removes expired workflows and their temporary execution principals without touching real product users.

### 2.5 Administration

External clients are managed through administrator APIs only. No administration page is part of this release.

## 3. Architecture

```text
External Agent
  -> Agent Card discovery
  -> A2A protocol adapters
       -> JSON-RPC compatibility adapter
       -> A2A v1 HTTP+JSON adapter
  -> External client authentication
  -> Context and task ownership
  -> Capability dispatcher
       -> Chief Advisor adapter
       -> Debate orchestrator
       -> Scenario simulation adapter
       -> Research search adapter
  -> Domain services and persistence
  -> A2A task and artifact mapper
```

The gateway is split into focused components:

1. **Protocol adapters** parse transport-specific requests and produce a common command.
2. **Authentication** resolves the external client and verifies its capability scopes.
3. **Context service** owns caller-supplied temporary data and isolation.
4. **Task service** owns lifecycle, idempotency, cancellation, events, and A2A response mapping.
5. **Capability dispatcher** routes validated commands to a capability adapter.
6. **Capability adapters** translate between the common A2A contract and existing domain services.

The existing `src/server/a2a/message.ts` must not become a large multi-capability switch. It becomes a thin compatibility route over the shared gateway.

## 4. External Execution Principal

Existing simulation, research, evidence, and agent tables require `user_id`. To reuse those services safely, every external context receives a temporary, non-login execution principal.

The execution principal:

- Has no username.
- Has no password.
- Has no API session.
- Cannot authenticate through product login endpoints.
- Is linked to exactly one external context.
- Contains only data explicitly submitted for that context.
- Is deleted with the context after expiry.

This is an internal persistence mechanism, not an external product account or identity mapping.

Every domain query remains filtered by the temporary principal's `user_id`, while every A2A operation is additionally filtered by `external_client_id` and `context_id`.

## 5. Protocol Support

### 5.1 JSON-RPC compatibility endpoint

Existing endpoint:

```text
POST /api/a2a/message-send
```

Supported method aliases:

```text
message/send
SendMessage
tasks/get
GetTask
tasks/list
ListTasks
tasks/cancel
CancelTask
```

The gateway normalizes aliases into:

```typescript
type A2ACommand =
  | { kind: "send-message"; requestId: string | number | null; payload: SendMessageInput }
  | { kind: "get-task"; requestId: string | number | null; taskId: string }
  | { kind: "list-tasks"; requestId: string | number | null; cursor?: string; limit: number }
  | { kind: "cancel-task"; requestId: string | number | null; taskId: string };
```

Requests without a JSON-RPC envelope remain supported as legacy `SendMessage` calls.

### 5.2 A2A v1 HTTP+JSON endpoints

```text
POST /api/a2a/message:send
GET  /api/a2a/tasks
GET  /api/a2a/tasks/[id]
POST /api/a2a/tasks/[id]:cancel
```

Both transports invoke the same authentication, dispatcher, task, and capability services. Responses must be behaviorally equivalent.

### 5.3 Message capability metadata

The normalized message metadata is:

```typescript
type CapabilityRequest = {
  capabilityId:
    | "chief_advisor_conversation"
    | "debate_mode"
    | "scenario_simulation"
    | "research_search";
  operation: string;
  input?: Record<string, unknown>;
};
```

Example:

```json
{
  "message": {
    "kind": "message",
    "role": "user",
    "messageId": "message-1",
    "contextId": "context-1",
    "parts": [
      { "kind": "text", "text": "围绕这个观点开始一场多空辩论" }
    ],
    "metadata": {
      "capabilityId": "debate_mode",
      "operation": "start",
      "input": {
        "profile": {
          "riskLevel": "BALANCED",
          "horizon": "MEDIUM_TERM",
          "maxDrawdown": "0.15"
        },
        "goals": [],
        "portfolio": {
          "cash": "20000",
          "holdings": [
            {
              "symbol": "AAPL",
              "quantity": "10",
              "cost": "170"
            }
          ]
        }
      }
    }
  }
}
```

If metadata is omitted, the request defaults to:

```text
capabilityId = chief_advisor_conversation
operation = send
```

## 6. Authentication And Client Management

### 6.1 Token format and storage

Tokens use high-entropy random bytes and a stable public prefix:

```text
mwa2a_<client-prefix>_<secret>
```

Only these values are persisted:

- Token hash.
- Token prefix.
- Client ID.
- Created and rotated timestamps.
- Last-used timestamp.
- Revocation timestamp.

Hash comparison uses constant-time comparison.

### 6.2 Client scopes

Supported scopes:

```text
chief_advisor_conversation
debate_mode
scenario_simulation
research_search
tasks_read
tasks_cancel
```

Calling an unapproved capability returns `403 CAPABILITY_NOT_ALLOWED`.

### 6.3 Administrator APIs

```text
POST  /api/v1/admin/a2a-clients
GET   /api/v1/admin/a2a-clients
GET   /api/v1/admin/a2a-clients/[id]
PATCH /api/v1/admin/a2a-clients/[id]
POST  /api/v1/admin/a2a-clients/[id]/rotate-token
```

Create request:

```json
{
  "name": "External Research Platform",
  "capabilities": [
    "chief_advisor_conversation",
    "debate_mode",
    "scenario_simulation",
    "research_search",
    "tasks_read",
    "tasks_cancel"
  ],
  "rateLimitPerMinute": 60
}
```

The create and rotate endpoints return the raw token once. List and detail endpoints never return it.

Disabling a client immediately rejects new calls and task operations. Existing data remains until explicit deletion or TTL cleanup.

## 7. Persistence Model

### 7.1 External clients

`a2a_external_clients`:

```text
id
name
status                 ACTIVE | DISABLED
capabilities_json
rate_limit_per_minute
created_by_user_id
created_at
updated_at
last_used_at
row_version
```

`a2a_external_client_tokens`:

```text
id
external_client_id
token_prefix
token_hash
created_at
last_used_at
revoked_at
```

### 7.2 Contexts

`a2a_contexts`:

```text
id
external_client_id
execution_user_id
primary_capability
status                 ACTIVE | COMPLETED | ARCHIVED | EXPIRED
profile_json
goals_json
portfolio_input_json
created_at
updated_at
expires_at
deleted_at
```

One context may contain related Chief Advisor and debate tasks. A simulation context may contain multiple branch operations. An incompatible capability reuse returns `409 CONTEXT_CAPABILITY_MISMATCH`.

### 7.3 Tasks and events

`a2a_tasks`:

```text
id
external_client_id
context_id
capability_id
operation
client_message_id
request_hash
status
domain_resource_type
domain_resource_id
input_json
result_json
error_json
created_at
started_at
completed_at
cancelled_at
expires_at
```

Unique idempotency key:

```text
(external_client_id, client_message_id)
```

`a2a_task_events`:

```text
id
task_id
sequence_no
event_type
payload_json
created_at
```

Events are public execution events only. Hidden model reasoning is never persisted or returned.

### 7.4 Debate persistence

`a2a_debate_sessions`:

```text
id
context_id
topic
status
current_round_no
evidence_board_json
final_task_id
created_at
updated_at
```

`a2a_debate_rounds`:

```text
id
session_id
round_no
operation
focus
user_stance
judge_result_json
created_at
completed_at
```

`a2a_debate_turns`:

```text
id
round_id
sequence_no
role                   USER | ORCHESTRATOR | EVIDENCE | BULL | BEAR | JUDGE
content
structured_output_json
created_at
```

### 7.5 Existing domain storage

The following existing tables remain authoritative:

- `simulation_workspaces`
- `simulation_branches`
- `simulation_option_batches`
- `simulation_options`
- `simulation_asset_snapshots`
- `simulation_asset_snapshot_items`
- `simulation_branch_events`
- `research_searches`
- `research_results`
- `research_search_sources`
- `agent_runs`
- `agent_run_events`
- `evidence_items`

An A2A task stores the matching domain resource type and ID rather than duplicating full domain state.

## 8. Capability Workflows

## 8.1 Chief Advisor conversation

Operations:

```text
send
answer_clarification
```

Flow:

```text
A2A gateway
  -> persist caller-supplied profile, goals, and portfolio
  -> resolve instruments and retrieve prices when portfolio data is present
  -> create isolated conversation session
  -> runConversationAgent
  -> runProfessionalAdvisor
  -> runChiefAdvisor
  -> server publication gate
  -> A2A task and artifacts
```

No product user data is loaded. The temporary execution principal owns the context-specific profile, goals, portfolio snapshot, conversation, agent runs, recommendations, and evidence.

## 8.2 Debate mode

Operations:

```text
start
continue
question_bull
question_bear
join_bull
join_bear
summarize
finalize
```

The service-side debate agents are:

- Debate Orchestrator.
- Evidence Agent.
- Bull Advocate.
- Bear Advocate.
- Debate Judge.

Each round:

1. Validates the requested operation and session state.
2. Updates the shared Evidence Board from caller data and server market data.
3. Uses the Orchestrator to select focus and turn order.
4. Generates structured Bull and Bear positions.
5. Generates a Judge result.
6. Persists public turns and evidence references.
7. Returns an A2A task artifact containing the complete round.

The Judge result includes:

```text
roundFocus
userClaim
bullSummary
bearSummary
evidenceBalance
unansweredQuestions
missingInformation
recommendedNextQuestions
dataAsOf
```

`finalize` sends the debate evidence, unresolved disputes, profile, goals, and portfolio constraints into the existing Chief Advisor publication gate. Bull, Bear, and Judge cannot directly create an `ACTIVE` recommendation.

## 8.3 Scenario simulation

Required `start` input:

```typescript
type ExternalSimulationInput = {
  profile?: {
    riskLevel?: string;
    horizon?: string;
    maxDrawdown?: string;
  };
  goals?: Array<Record<string, unknown>>;
  portfolio: {
    cash: string;
    holdings: Array<{
      symbol: string;
      quantity: string;
      cost: string;
    }>;
  };
  objective: string;
  label?: string;
};
```

Operations:

```text
start
generate_options
get_options
execute_option
get_tree
get_snapshot
switch_branch
undo
archive
```

`start`:

1. Resolves every symbol against the instrument catalog.
2. Retrieves server-side current prices.
3. Records source, timestamp, and data quality.
4. Creates a context-owned portfolio snapshot.
5. Creates the existing simulation workspace and root branch.

If a required price cannot be retrieved, the task becomes `input-required` when the caller can correct the symbol, otherwise `failed`.

`generate_options` reuses the Branch Scenario Agent and deterministic validation engine.

`execute_option`, `switch_branch`, and `undo` reuse the existing transaction-safe simulation service.

All results are simulations. Real holdings are never created or modified.

## 8.4 Independent research search

Operations:

```text
start
get_results
retry
refine
cancel
```

Input:

```typescript
type ExternalResearchInput = {
  query: string;
  adapters: Array<"WEB" | "MCP" | "KNOWLEDGE_BASE" | "RSS">;
  maximumResults: number;
};
```

`start` reuses `runResearchSearch`.

`get_results` returns:

- Source status.
- Result title.
- Summary.
- URL.
- Citation.
- Evidence ID when available.
- Data retrieval time.
- Retryable source failures.

`refine` creates a child task and a new research search linked to the same context. It does not overwrite previous results.

`retry` reruns failed adapters only.

`cancel` marks the A2A task cancelled. Adapters that support abort signals must stop promptly; non-cancellable adapters may finish, but their late results must not change the cancelled task back to completed.

## 9. Task Lifecycle

Normalized task states:

```text
submitted
working
input-required
completed
canceled
failed
```

Domain mapping:

```text
queued                -> submitted
running               -> working
waiting_for_input     -> input-required
completed/succeeded   -> completed
cancelled             -> canceled
failed                -> failed
```

Every capability operation creates an A2A task.

`GetTask` returns:

- Current status.
- Context and capability IDs.
- Public status message.
- Domain artifacts.
- Missing inputs.
- Error details safe for external clients.
- Public history when requested.

`ListTasks` returns only tasks owned by the authenticated external client.

`CancelTask` returns 404 for unknown or foreign tasks and 409 for terminal tasks.

## 10. A2A Artifacts

Artifact names:

```text
advisor_result
debate_round
debate_summary
simulation_workspace
simulation_options
simulation_branch
simulation_snapshot
research_results
```

Artifacts include text parts for broad client compatibility and structured data parts for capable clients.

Sensitive internal fields are excluded:

- Internal database paths.
- Raw model prompts.
- Hidden reasoning.
- Authentication hashes.
- Other clients' identifiers.
- Internal user IDs.

## 11. Error Contract

```text
401 UNAUTHENTICATED
403 CAPABILITY_NOT_ALLOWED
404 CONTEXT_NOT_FOUND
404 TASK_NOT_FOUND
409 CONTEXT_CAPABILITY_MISMATCH
409 IDEMPOTENCY_CONFLICT
409 TASK_NOT_CANCELLABLE
422 INPUT_REQUIRED
422 INVALID_PORTFOLIO_INPUT
422 INSTRUMENT_NOT_RESOLVED
429 RATE_LIMITED
503 DATA_SOURCE_UNAVAILABLE
500 AGENT_RUN_FAILED
```

A resource owned by another external client is always reported as not found.

JSON-RPC responses include a stable application code in `error.data.code`. HTTP+JSON responses use the same application code and an appropriate HTTP status.

## 12. Retention And Cleanup

A scheduler runs hourly.

Cleanup eligibility:

```text
expires_at <= now
or deleted_at is not null
```

Cleanup order:

1. Cancel active external tasks.
2. Remove debate turns, rounds, and sessions.
3. Remove A2A task events and tasks.
4. Delete linked simulation and research domain resources through existing ownership boundaries.
5. Delete context-owned recommendations, evidence, messages, sessions, snapshots, profiles, goals, and holdings.
6. Delete the context.
7. Delete the temporary execution principal.

Cleanup queries must require both the context ID and execution principal ID. A real user row can never be selected by the external-context cleanup path.

## 13. Rate Limiting And Audit

Rate limiting is per external client.

The initial implementation uses a process-local rolling window backed by persisted client configuration. The response includes `Retry-After` when limited.

Audit events record:

- Client creation, update, disable, and token rotation.
- Capability call accepted or rejected.
- Task cancellation.
- Context deletion and TTL cleanup.

Audit metadata contains IDs and status only. It does not store full prompts, portfolios, research bodies, or tokens.

## 14. Agent Card Changes

The Agent Card must advertise only capabilities available through the A2A gateway as top-level `skills`:

```text
chief_advisor_conversation
debate_mode
scenario_simulation
research_search
```

It must declare:

- JSON-RPC and HTTP+JSON interfaces.
- Bearer authentication.
- Task lifecycle support.
- Stateful contexts.
- Capability metadata extension URI.
- Streaming as unsupported until an A2A-native streaming endpoint is implemented.
- Push notifications as unsupported.

Workbench-only product features may remain in metadata but must not be represented as directly callable A2A skills.

## 15. Testing Strategy

### 15.1 Authentication

- Raw tokens are returned only on create and rotate.
- Stored values cannot authenticate as raw tokens.
- Disabled clients are rejected.
- Revoked tokens are rejected.
- New tokens work after rotation.
- Capability scopes are enforced.
- Rate limiting is isolated by client.

### 15.2 Ownership and idempotency

- A client can access only its contexts and tasks.
- Foreign task and context IDs return 404.
- Reusing a `messageId` with the same request returns the prior task.
- Reusing it with different content returns `IDEMPOTENCY_CONFLICT`.

### 15.3 Protocol parity

- Legacy body, `message/send`, and `SendMessage` produce equivalent tasks.
- `tasks/get` and `GetTask` are equivalent.
- `tasks/list` and `ListTasks` are equivalent.
- `tasks/cancel` and `CancelTask` are equivalent.
- HTTP+JSON endpoints return the same normalized resources.

### 15.4 Debate

- Start creates a session and first round.
- Continue increments the round.
- Bull and Bear questioning changes turn order.
- Joining a side persists user stance.
- Summarize returns current evidence balance.
- Finalize invokes the Chief Advisor publication gate.
- Invalid session ownership is rejected.

### 15.5 Simulation

- Caller-supplied profile, goals, cash, quantity, and cost are persisted only in the external context.
- Server-side prices and timestamps are used.
- Unresolved symbols produce `input-required`.
- Options are generated and returned.
- Option execution creates a child branch.
- Switch and undo update only the temporary workspace.
- Asset conservation checks remain active.
- No real user's holdings change.

### 15.6 Research

- Each adapter reports independent success or failure.
- Results and citations are returned.
- Refine creates a child task.
- Retry runs failed adapters only.
- Cancellation is terminal even when a late adapter resolves.

### 15.7 Cleanup

- Expired contexts and temporary principals are deleted.
- Domain resources owned by the context are deleted.
- Active tasks are cancelled first.
- Real users and their data remain unchanged.

### 15.8 Agent Card

- Every advertised top-level skill has an executable dispatcher adapter.
- Every interface URL is derived from `APP_ORIGIN` or trusted forwarding headers.
- Security schemes and task capabilities match runtime behavior.

## 16. Rollout

1. Add migrations and services behind the new client-token authentication.
2. Preserve `A2A_BEARER_TOKEN` as a temporary legacy client bootstrap path.
3. Add administrator APIs and create at least one database-backed external client.
4. Enable Chief Advisor and research search.
5. Enable scenario simulation after server-price tests pass.
6. Enable debate after service-side agent and persistence tests pass.
7. Update the Agent Card only when all four dispatcher adapters are executable.
8. Remove the shared legacy token after external clients have migrated.

## 17. Completion Criteria

The feature is complete when:

- An administrator can create, disable, and rotate an external client token.
- Two clients cannot access each other's contexts or tasks.
- External data never reads or modifies a real user's profile, holdings, goals, or history.
- All four Agent Card skills execute through the A2A gateway.
- Debate, simulation, and research support their confirmed stateful operations.
- JSON-RPC legacy aliases and A2A v1 HTTP+JSON endpoints are behaviorally equivalent.
- Context data expires and is removed after 30 days.
- Focused unit, integration, migration, and protocol tests pass.
