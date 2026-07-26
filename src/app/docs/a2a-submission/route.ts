const DOCUMENT = `# A2A External Capability Gateway

## Endpoints

- Agent Card: GET https://<host>/.well-known/agent-card.json
- JSON-RPC: POST https://<host>/api/a2a/message-send
- HTTP+JSON: POST https://<host>/api/a2a/message:send
- HTTP+JSON streaming: POST https://<host>/api/a2a/message:stream
- Tasks: GET https://<host>/api/a2a/tasks and GET https://<host>/api/a2a/tasks/{id}
- Cancel: POST https://<host>/api/a2a/tasks/{id}:cancel
- Delete context: DELETE https://<host>/api/a2a/contexts/{id}
- Auth: Authorization: Bearer <client-specific-token>

## Capability Metadata

Put capabilityId, operation, and input in message.metadata.

- chief_advisor_conversation: send, answer_clarification
- debate_mode: start, continue, join_bull, join_bear, summarize, finalize
- scenario_simulation: start, generate_options, get_options, execute_option, get_tree, get_snapshot, switch_branch, undo, archive
- research_search: start, get_results, refine, retry, cancel

\`\`\`json
{
  "jsonrpc": "2.0",
  "id": "demo-1",
    "method": "message/send",
    "params": {
      "message": {
      "role": "ROLE_USER",
      "messageId": "demo-message-1",
      "parts": [
        { "text": "Start a bull/bear debate on AAPL valuation." }
      ],
      "metadata": {
        "capabilityId": "debate_mode",
        "operation": "start",
        "input": {
          "targetSymbol": "AAPL",
          "portfolio": {
            "cash": "20000",
            "holdings": [
              { "symbol": "AAPL", "quantity": "10", "cost": "170" }
            ]
          }
        }
      }
    }
  }
}
\`\`\`

The server resolves authoritative market prices. Every context receives a temporary non-login execution
principal, remains isolated from product users and other clients, and expires after 30 days. The service is
research- and simulation-only; it never connects to brokers or places orders.

Streaming responses use \`text/event-stream\`; each \`data:\` payload contains exactly one \`task\`,
\`statusUpdate\`, or \`artifactUpdate\` member.
`;

export const runtime = "nodejs";

export function GET() {
  return new Response(DOCUMENT, {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}
