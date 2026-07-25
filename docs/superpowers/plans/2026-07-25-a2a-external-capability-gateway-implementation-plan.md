# A2A External Capability Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every top-level skill advertised by the Money Whisperer Agent Card executable by external clients, including Chief Advisor conversations, multi-round debate, stateful branch simulation, and independent research search.

**Architecture:** Add a database-backed A2A control plane for external clients, contexts, tasks, and events. Keep protocol parsing, authentication, ownership, task lifecycle, and capability execution in separate modules. Reuse the existing advisor, simulation, research, evidence, and market-data services through focused adapters, while storing caller-supplied data under a temporary non-login execution principal that expires after 30 days.

**Tech Stack:** Next.js 16 App Router, TypeScript 5.9, Vitest, Zod 4, SQLite/better-sqlite3, Drizzle schema declarations, Mastra Agents, PandaData adapter, existing simulation and research services.

---

## File Structure

Create these focused modules:

```text
src/server/a2a/
├─ auth.ts                       # Bearer token lookup, scopes, rate limiting
├─ client-service.ts             # Admin CRUD and token rotation
├─ contracts.ts                  # Protocol and capability Zod schemas
├─ context-service.ts            # Context ownership and temporary execution data
├─ external-market-data.ts       # Instrument resolution and server-side prices
├─ gateway.ts                    # Common command dispatcher
├─ protocol.ts                   # JSON-RPC and HTTP+JSON normalization/mapping
├─ task-service.ts               # Task lifecycle, events, idempotency, ownership
├─ cleanup.ts                    # 30-day retention cleanup
├─ cleanup-scheduler.ts          # Hourly scheduler registration
└─ capabilities/
   ├─ advisor.ts                 # Existing Chief Advisor adapter
   ├─ debate-contracts.ts        # Debate structured contracts
   ├─ debate-agents.ts           # Orchestrator, Evidence, Bull, Bear, Judge
   ├─ debate-service.ts          # Multi-round stateful debate workflow
   ├─ debate.ts                  # A2A debate adapter
   ├─ simulation.ts              # Existing branch simulation adapter
   └─ research.ts                # Existing research search adapter
```

Add protocol routes:

```text
src/app/api/a2a/message-send/route.ts
src/app/api/a2a/message:send/route.ts
src/app/api/a2a/tasks/route.ts
src/app/api/a2a/tasks/[...path]/route.ts
src/app/api/a2a/contexts/[id]/route.ts
```

Add administrator routes:

```text
src/app/api/v1/admin/a2a-clients/route.ts
src/app/api/v1/admin/a2a-clients/[id]/route.ts
src/app/api/v1/admin/a2a-clients/[id]/rotate-token/route.ts
```

Add persistence:

```text
src/server/db/migrations/0016_add_a2a_external_gateway.sql
src/server/db/schema/a2a.ts
```

---

### Task 1: Add External A2A Persistence

**Files:**
- Create: `src/server/db/migrations/0016_add_a2a_external_gateway.sql`
- Create: `src/server/db/schema/a2a.ts`
- Modify: `src/server/db/schema/index.ts`
- Modify: `src/server/db/migration-runner.test.ts`
- Test: `src/server/db/schema/a2a.test.ts`

- [ ] **Step 1: Write the failing migration test**

Update `src/server/db/migration-runner.test.ts`:

```typescript
it("creates the external A2A gateway tables", () => {
  const db = new Database(":memory:");
  prepareDatabase(db as never, ":memory:");

  expect(db.pragma("user_version", { simple: true })).toBe(16);
  expect((db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count).toBe(18);

  for (const table of [
    "a2a_external_clients",
    "a2a_external_client_tokens",
    "a2a_contexts",
    "a2a_tasks",
    "a2a_task_events",
    "a2a_debate_sessions",
    "a2a_debate_rounds",
    "a2a_debate_turns",
  ]) {
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)).toEqual({ name: table });
  }

  db.close();
});
```

- [ ] **Step 2: Run the migration test and verify RED**

Run:

```bash
pnpm vitest run src/server/db/migration-runner.test.ts
```

Expected: FAIL because `user_version` is still `15` and the A2A tables do not exist.

- [ ] **Step 3: Add migration `0016_add_a2a_external_gateway.sql`**

Create the migration with these complete table contracts:

```sql
CREATE TABLE a2a_external_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','DISABLED')),
  capabilities_json TEXT NOT NULL,
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 60 CHECK(rate_limit_per_minute BETWEEN 1 AND 10000),
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1)
);

CREATE TABLE a2a_external_client_tokens (
  id TEXT PRIMARY KEY,
  external_client_id TEXT NOT NULL REFERENCES a2a_external_clients(id) ON DELETE CASCADE,
  token_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE a2a_contexts (
  id TEXT PRIMARY KEY,
  external_client_id TEXT NOT NULL REFERENCES a2a_external_clients(id) ON DELETE CASCADE,
  execution_user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  primary_capability TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','COMPLETED','ARCHIVED','EXPIRED')),
  profile_json TEXT NOT NULL DEFAULT '{}',
  goals_json TEXT NOT NULL DEFAULT '[]',
  portfolio_input_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE a2a_tasks (
  id TEXT PRIMARY KEY,
  external_client_id TEXT NOT NULL REFERENCES a2a_external_clients(id) ON DELETE CASCADE,
  context_id TEXT NOT NULL REFERENCES a2a_contexts(id) ON DELETE CASCADE,
  capability_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  client_message_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('submitted','working','input-required','completed','canceled','failed')),
  domain_resource_type TEXT,
  domain_resource_id TEXT,
  input_json TEXT NOT NULL,
  result_json TEXT,
  error_json TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  expires_at TEXT NOT NULL,
  UNIQUE(external_client_id, client_message_id)
);

CREATE TABLE a2a_task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES a2a_tasks(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL CHECK(sequence_no >= 1),
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(task_id, sequence_no)
);

CREATE TABLE a2a_debate_sessions (
  id TEXT PRIMARY KEY,
  context_id TEXT NOT NULL UNIQUE REFERENCES a2a_contexts(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','FINALIZED','ARCHIVED')),
  current_round_no INTEGER NOT NULL DEFAULT 0 CHECK(current_round_no >= 0),
  evidence_board_json TEXT NOT NULL DEFAULT '{}',
  final_task_id TEXT REFERENCES a2a_tasks(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE a2a_debate_rounds (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES a2a_debate_sessions(id) ON DELETE CASCADE,
  round_no INTEGER NOT NULL CHECK(round_no >= 1),
  operation TEXT NOT NULL,
  focus TEXT NOT NULL,
  user_stance TEXT CHECK(user_stance IN ('NEUTRAL','BULL','BEAR')),
  judge_result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  UNIQUE(session_id, round_no)
);

CREATE TABLE a2a_debate_turns (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES a2a_debate_rounds(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL CHECK(sequence_no >= 1),
  role TEXT NOT NULL CHECK(role IN ('USER','ORCHESTRATOR','EVIDENCE','BULL','BEAR','JUDGE')),
  content TEXT NOT NULL,
  structured_output_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(round_id, sequence_no)
);

CREATE INDEX idx_a2a_clients_status ON a2a_external_clients(status, created_at DESC);
CREATE INDEX idx_a2a_tokens_client_active ON a2a_external_client_tokens(external_client_id, revoked_at);
CREATE INDEX idx_a2a_contexts_client_expiry ON a2a_contexts(external_client_id, expires_at);
CREATE INDEX idx_a2a_tasks_client_created ON a2a_tasks(external_client_id, created_at DESC, id DESC);
CREATE INDEX idx_a2a_tasks_context_created ON a2a_tasks(context_id, created_at, id);
CREATE INDEX idx_a2a_tasks_status ON a2a_tasks(status, created_at);
```

- [ ] **Step 4: Add Drizzle declarations**

Create `src/server/db/schema/a2a.ts` with one exported `sqliteTable` per migration table. Use string columns for JSON and timestamps, integer columns for versions, sequence numbers, round numbers, and rate limits. Export inferred row types:

```typescript
export type A2AExternalClientRow = typeof a2aExternalClients.$inferSelect;
export type A2AContextRow = typeof a2aContexts.$inferSelect;
export type A2ATaskRow = typeof a2aTasks.$inferSelect;
```

Modify `src/server/db/schema/index.ts`:

```typescript
export * from "./a2a";
```

- [ ] **Step 5: Add schema constraint tests**

Create `src/server/db/schema/a2a.test.ts`:

```typescript
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { prepareDatabase } from "../migration-runner";

describe("external A2A schema", () => {
  it("enforces task idempotency per client", () => {
    const db = new Database(":memory:");
    prepareDatabase(db as never, ":memory:");
    seedClientContext(db);
    const insert = db.prepare(`INSERT INTO a2a_tasks
      (id,external_client_id,context_id,capability_id,operation,client_message_id,request_hash,status,input_json,created_at,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    insert.run("task-1", "client-1", "context-1", "debate_mode", "start", "message-1", "hash-1", "submitted", "{}", now(), future());
    expect(() => insert.run("task-2", "client-1", "context-1", "debate_mode", "continue", "message-1", "hash-2", "submitted", "{}", now(), future()))
      .toThrow();
    db.close();
  });
});

function seedClientContext(db: Database.Database) {
  const timestamp = now();
  db.prepare("INSERT INTO users (id,display_name,created_at) VALUES ('admin','Admin',?)").run(timestamp);
  db.prepare("INSERT INTO users (id,display_name,created_at) VALUES ('exec-1','External execution',?)").run(timestamp);
  db.prepare(`INSERT INTO a2a_external_clients
    (id,name,status,capabilities_json,rate_limit_per_minute,created_by_user_id,created_at,updated_at,row_version)
    VALUES ('client-1','Client','ACTIVE','["debate_mode"]',60,'admin',?,?,1)`).run(timestamp, timestamp);
  db.prepare(`INSERT INTO a2a_contexts
    (id,external_client_id,execution_user_id,primary_capability,profile_json,goals_json,portfolio_input_json,created_at,updated_at,expires_at)
    VALUES ('context-1','client-1','exec-1','debate_mode','{}','[]','{}',?,?,?)`).run(timestamp, timestamp, future());
}

function now() { return "2026-07-25T00:00:00.000Z"; }
function future() { return "2026-08-24T00:00:00.000Z"; }
```

- [ ] **Step 6: Run database tests**

Run:

```bash
pnpm vitest run src/server/db/migration-runner.test.ts src/server/db/schema/a2a.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/db/migrations/0016_add_a2a_external_gateway.sql src/server/db/schema/a2a.ts src/server/db/schema/index.ts src/server/db/migration-runner.test.ts src/server/db/schema/a2a.test.ts
git commit -m "feat: add external A2A gateway schema"
```

---

### Task 2: Add External Client Tokens And Administrator APIs

**Files:**
- Create: `src/server/a2a/contracts.ts`
- Create: `src/server/a2a/client-service.ts`
- Create: `src/server/a2a/auth.ts`
- Create: `src/server/a2a/client-service.test.ts`
- Create: `src/app/api/v1/admin/a2a-clients/route.ts`
- Create: `src/app/api/v1/admin/a2a-clients/[id]/route.ts`
- Create: `src/app/api/v1/admin/a2a-clients/[id]/rotate-token/route.ts`
- Create: `src/app/api/v1/admin/a2a-clients/route.test.ts`
- Modify: `.env.example`
- Modify: `.env.prod.example`
- Modify: `README.md`

- [ ] **Step 1: Write failing token lifecycle tests**

Create `src/server/a2a/client-service.test.ts` using a temporary `DB_PATH`:

```typescript
it("returns a raw token once and authenticates by its hash", () => {
  seedAdmin("admin-1");
  const created = createExternalClient("admin-1", {
    name: "Research partner",
    capabilities: ["debate_mode", "tasks_read"],
    rateLimitPerMinute: 30,
  });

  expect(created.token).toMatch(/^mwa2a_[a-z0-9]+_[A-Za-z0-9_-]+$/u);
  expect(authenticateExternalToken(created.token)).toMatchObject({
    clientId: created.client.id,
    capabilities: ["debate_mode", "tasks_read"],
  });

  const db = getDatabase();
  const stored = db.prepare("SELECT token_hash FROM a2a_external_client_tokens WHERE external_client_id=?").get(created.client.id) as { token_hash: string };
  db.close();
  expect(stored.token_hash).not.toBe(created.token);
});

it("revokes the previous token during rotation", () => {
  seedAdmin("admin-1");
  const created = createExternalClient("admin-1", {
    name: "Research partner",
    capabilities: ["research_search"],
    rateLimitPerMinute: 60,
  });
  const rotated = rotateExternalClientToken("admin-1", created.client.id);
  expect(authenticateExternalToken(created.token)).toBeNull();
  expect(authenticateExternalToken(rotated.token)?.clientId).toBe(created.client.id);
});
```

- [ ] **Step 2: Run the service tests and verify RED**

```bash
pnpm vitest run src/server/a2a/client-service.test.ts
```

Expected: FAIL because the client service does not exist.

- [ ] **Step 3: Implement token creation and client CRUD**

Create the shared client identity contract in `src/server/a2a/contracts.ts`:

```typescript
export const A2A_CAPABILITIES = [
  "chief_advisor_conversation",
  "debate_mode",
  "scenario_simulation",
  "research_search",
  "tasks_read",
  "tasks_cancel",
] as const;

export type A2ACapability = (typeof A2A_CAPABILITIES)[number];

export type ExternalClientView = {
  id: string;
  name: string;
  status: "ACTIVE" | "DISABLED";
  capabilities: A2ACapability[];
  rateLimitPerMinute: number;
  tokenPrefix: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type ExternalClientPrincipal = {
  clientId: string;
  name: string;
  capabilities: A2ACapability[];
  rateLimitPerMinute: number;
};
```

In `src/server/a2a/client-service.ts`, import those types and implement:

```typescript
export function createExternalClient(
  actorUserId: string,
  input: { name: string; capabilities: A2ACapability[]; rateLimitPerMinute: number },
): { client: ExternalClientView; token: string };

export function listExternalClients(): ExternalClientView[];
export function getExternalClient(clientId: string): ExternalClientView | null;
export function updateExternalClient(
  actorUserId: string,
  clientId: string,
  input: { name?: string; status?: "ACTIVE" | "DISABLED"; capabilities?: A2ACapability[]; rateLimitPerMinute?: number; expectedVersion: number },
): ExternalClientView;
export function rotateExternalClientToken(actorUserId: string, clientId: string): { token: string; tokenPrefix: string };
```

Use:

```typescript
const secret = randomBytes(32).toString("base64url");
const tokenPrefix = randomBytes(4).toString("hex");
const token = `mwa2a_${tokenPrefix}_${secret}`;
const tokenHash = createHash("sha256").update(token).digest("hex");
```

Every create, update, disable, and rotate operation writes an `audit_events` row without the raw token.

- [ ] **Step 4: Implement authentication and rate limiting**

In `src/server/a2a/auth.ts`, import `A2ACapability` and `ExternalClientPrincipal` from `contracts.ts`, then implement:

```typescript
export function authenticateExternalToken(rawToken: string): ExternalClientPrincipal | null;
export function authenticateExternalRequest(request: NextRequest): ExternalClientPrincipal;
export function requireA2ACapability(principal: ExternalClientPrincipal, capability: A2ACapability): void;
export function resetA2ARateLimitsForTests(): void;
```

`authenticateExternalToken` must:

1. SHA-256 hash the presented token.
2. Query an active, non-revoked token joined to an `ACTIVE` client.
3. Compare the stored and calculated hash using `timingSafeEqual`.
4. Update token/client `last_used_at`.
5. Enforce a process-local per-minute rolling window.

If no database token matches, temporarily accept `A2A_BEARER_TOKEN` as the `a2a-legacy-client`, scoped to all capabilities. Keep this fallback isolated in `auth.ts` so it can be removed later.

- [ ] **Step 5: Write failing administrator route tests**

Create `src/app/api/v1/admin/a2a-clients/route.test.ts`:

```typescript
it("creates a scoped client and returns its raw token once", async () => {
  const response = await POST(authenticatedRequest("http://localhost/api/v1/admin/a2a-clients", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "a2a-client-create-1" },
    body: JSON.stringify({
      name: "Partner",
      capabilities: ["debate_mode", "tasks_read"],
      rateLimitPerMinute: 20,
    }),
  }));
  const body = await response.json();
  expect(response.status).toBe(201);
  expect(body.data.client.capabilities).toEqual(["debate_mode", "tasks_read"]);
  expect(body.data.token).toMatch(/^mwa2a_/u);

  const listed = await GET(authenticatedRequest("http://localhost/api/v1/admin/a2a-clients"));
  const listBody = await listed.json();
  expect(listBody.data.items[0]).not.toHaveProperty("token");
});
```

Add these route tests:

```typescript
it("rejects non-admin users", async () => {
  const response = await GET(authenticatedRequest(
    "http://localhost/api/v1/admin/a2a-clients",
    {},
    { role: "USER" },
  ));
  expect(response.status).toBe(403);
});

it("enforces If-Match and disables authentication", async () => {
  const created = createExternalClientFixture();
  const stale = await PATCH(
    authenticatedRequest(`http://localhost/api/v1/admin/a2a-clients/${created.client.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "if-match": "99" },
      body: JSON.stringify({ status: "DISABLED" }),
    }),
    { params: Promise.resolve({ id: created.client.id }) },
  );
  expect(stale.status).toBe(412);

  const disabled = await PATCH(
    authenticatedRequest(`http://localhost/api/v1/admin/a2a-clients/${created.client.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "if-match": "1" },
      body: JSON.stringify({ status: "DISABLED" }),
    }),
    { params: Promise.resolve({ id: created.client.id }) },
  );
  expect(disabled.status).toBe(200);
  expect(authenticateExternalToken(created.token)).toBeNull();
});

it("rotates a token and revokes the old token", async () => {
  const created = createExternalClientFixture();
  const response = await ROTATE(
    authenticatedRequest(`http://localhost/api/v1/admin/a2a-clients/${created.client.id}/rotate-token`, {
      method: "POST",
      headers: { "idempotency-key": "rotate-1" },
    }),
    { params: Promise.resolve({ id: created.client.id }) },
  );
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.data.token).not.toBe(created.token);
  expect(authenticateExternalToken(created.token)).toBeNull();
  expect(authenticateExternalToken(body.data.token)?.clientId).toBe(created.client.id);
});
```

- [ ] **Step 6: Implement administrator routes**

Use Zod request schemas and existing `requireAdmin`, `beginIdempotentRequest`, and `If-Match` conventions.

Create:

```text
POST/GET  /api/v1/admin/a2a-clients
GET/PATCH /api/v1/admin/a2a-clients/[id]
POST      /api/v1/admin/a2a-clients/[id]/rotate-token
```

Create and rotate responses:

```json
{
  "data": {
    "client": {
      "id": "a2a_client_...",
      "name": "Partner",
      "status": "ACTIVE",
      "capabilities": ["debate_mode"],
      "rateLimitPerMinute": 60,
      "version": 1
    },
    "token": "mwa2a_..."
  },
  "meta": {}
}
```

- [ ] **Step 7: Update environment documentation**

Change `.env.example`, `.env.prod.example`, and `README.md` so `A2A_BEARER_TOKEN` is documented as a temporary legacy bootstrap token. Document the administrator APIs as the normal client provisioning path.

- [ ] **Step 8: Run focused tests**

```bash
pnpm vitest run src/server/a2a/client-service.test.ts src/app/api/v1/admin/a2a-clients/route.test.ts
pnpm eslint src/server/a2a/client-service.ts src/server/a2a/auth.ts src/app/api/v1/admin/a2a-clients
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/server/a2a/contracts.ts src/server/a2a/client-service.ts src/server/a2a/auth.ts src/server/a2a/client-service.test.ts src/app/api/v1/admin/a2a-clients .env.example .env.prod.example README.md
git commit -m "feat: manage external A2A clients"
```

---

### Task 3: Add Context Isolation And Server-Side Portfolio Snapshots

**Files:**
- Modify: `src/server/a2a/contracts.ts`
- Create: `src/server/a2a/context-service.ts`
- Create: `src/server/a2a/external-market-data.ts`
- Create: `src/server/a2a/context-service.test.ts`
- Create: `src/server/a2a/external-market-data.test.ts`

- [ ] **Step 1: Define validated external input schemas**

Extend `src/server/a2a/contracts.ts`:

```typescript
import { z } from "zod";

export const CapabilityIdSchema = z.enum([
  "chief_advisor_conversation",
  "debate_mode",
  "scenario_simulation",
  "research_search",
]);

export const ExternalProfileSchema = z.object({
  riskLevel: z.string().trim().max(40).optional(),
  investmentAmount: z.string().regex(/^\d+(?:\.\d+)?$/u).optional(),
  horizon: z.string().trim().max(80).optional(),
  maxDrawdown: z.string().regex(/^0(?:\.\d+)?$|^1(?:\.0+)?$/u).optional(),
}).strict();

export const ExternalGoalSchema = z.object({
  name: z.string().trim().min(1).max(200),
  targetAmount: z.string().regex(/^\d+(?:\.\d+)?$/u),
  targetDate: z.string().date().optional(),
  horizon: z.string().trim().min(1).max(80),
  priority: z.string().trim().min(1).max(40),
  assetPreference: z.string().trim().max(200).optional(),
}).strict();

export const ExternalHoldingSchema = z.object({
  symbol: z.string().trim().min(1).max(32),
  quantity: z.string().regex(/^\d+(?:\.\d+)?$/u),
  cost: z.string().regex(/^\d+(?:\.\d+)?$/u),
}).strict();

export const ExternalPortfolioSchema = z.object({
  cash: z.string().regex(/^\d+(?:\.\d+)?$/u),
  holdings: z.array(ExternalHoldingSchema).min(1).max(100),
}).strict();

export type CapabilityId = z.infer<typeof CapabilityIdSchema>;
export type CapabilityFamily = "ADVISORY" | "SIMULATION" | "RESEARCH";
export type ExternalProfile = z.infer<typeof ExternalProfileSchema>;
export type ExternalGoal = z.infer<typeof ExternalGoalSchema>;
export type ExternalPortfolio = z.infer<typeof ExternalPortfolioSchema>;

export function capabilityFamily(capabilityId: CapabilityId): CapabilityFamily {
  if (capabilityId === "chief_advisor_conversation" || capabilityId === "debate_mode") return "ADVISORY";
  if (capabilityId === "scenario_simulation") return "SIMULATION";
  return "RESEARCH";
}

export type A2AContextView = {
  id: string;
  externalClientId: string;
  executionUserId: string;
  primaryCapability: CapabilityId;
  status: "ACTIVE" | "COMPLETED" | "ARCHIVED" | "EXPIRED";
  profile: ExternalProfile;
  goals: ExternalGoal[];
  portfolioInput: ExternalPortfolio | null;
  portfolioSnapshotId: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};
```

- [ ] **Step 2: Write failing market-data tests**

Create `src/server/a2a/external-market-data.test.ts` with `callPandaData` mocked:

```typescript
it("uses PandaData prices instead of accepting caller prices", async () => {
  callPandaDataMock.mockResolvedValueOnce({
    data: [{ symbol: "AAPL", close: "205.50", date: "20260724" }],
    fresh: true,
    asOfDate: "2026-07-24",
    method: "get_us_daily",
  });

  const resolved = await resolveExternalPortfolio({
    cash: "1000",
    holdings: [{ symbol: "AAPL", quantity: "2", cost: "170" }],
  });

  expect(resolved.holdings[0]).toMatchObject({
    symbol: "AAPL",
    quantity: "2",
    cost: "170",
    price: "205.50",
    priceSource: "PANDADATA",
    dataAsOf: "2026-07-24",
  });
});
```

Add an unresolved-symbol test expecting:

```typescript
await expect(resolveExternalPortfolio({
  cash: "1000",
  holdings: [{ symbol: "NOT_REAL", quantity: "1", cost: "1" }],
})).rejects.toMatchObject({ code: "INSTRUMENT_NOT_RESOLVED" });
```

- [ ] **Step 3: Implement server-side instrument and price resolution**

Create `src/server/a2a/external-market-data.ts`:

```typescript
export type ResolvedExternalHolding = {
  instrumentId: string;
  symbol: string;
  quantity: string;
  cost: string;
  price: string;
  priceSource: "PANDADATA";
  dataAsOf: string;
  market: string;
  assetType: string;
};

export async function resolveExternalPortfolio(
  input: z.infer<typeof ExternalPortfolioSchema>,
): Promise<{ cash: string; holdings: ResolvedExternalHolding[]; dataAsOf: string }>;
```

Rules:

1. Query `instruments` case-insensitively by symbol.
2. Reject unresolved or non-tradable instruments with `INSTRUMENT_NOT_RESOLVED`.
3. Choose PandaData method:
   - US market: `get_us_daily`
   - HK market: `get_hk_daily`
   - fund: `get_fund_daily`
   - index: `get_index_daily`
   - otherwise: `get_stock_rt_daily`, followed by `get_stock_daily` if empty
4. Request the latest 10 calendar days.
5. Sort returned rows by normalized date and use the latest valid positive `close`.
6. Reject missing/stale core prices with `DATA_SOURCE_UNAVAILABLE`.
7. Never read a client-supplied current price.

- [ ] **Step 4: Write failing context isolation tests**

Create `src/server/a2a/context-service.test.ts`:

```typescript
it("creates a non-login execution principal and persists only caller data", async () => {
  seedExternalClient("client-1");
  quoteResolverMock.mockResolvedValue(resolvedPortfolioFixture());

  const context = await createA2AContext({
    externalClientId: "client-1",
    capabilityId: "scenario_simulation",
    profile: { riskLevel: "BALANCED", horizon: "MEDIUM_TERM", maxDrawdown: "0.15" },
    goals: [{ name: "Retirement", targetAmount: "1000000", horizon: "LONG_TERM", priority: "HIGH" }],
    portfolio: { cash: "20000", holdings: [{ symbol: "AAPL", quantity: "10", cost: "170" }] },
  });

  const db = getDatabase();
  const user = db.prepare("SELECT username,password_hash FROM users WHERE id=?").get(context.executionUserId) as { username: string | null; password_hash: string | null };
  const snapshot = db.prepare("SELECT user_id FROM portfolio_snapshots WHERE id=?").get(context.portfolioSnapshotId) as { user_id: string };
  db.close();

  expect(user).toEqual({ username: null, password_hash: null });
  expect(snapshot.user_id).toBe(context.executionUserId);
});

it("does not allow another client to load the context", async () => {
  expect(getA2AContext("client-2", "context-1")).toBeNull();
});

it("allows advisor and debate to share a context but rejects other capability families", async () => {
  seedContext({
    clientId: "client-1",
    contextId: "context-1",
    primaryCapability: "debate_mode",
  });
  expect(requireCompatibleA2AContext("client-1", "context-1", "chief_advisor_conversation").id)
    .toBe("context-1");
  expect(() => requireCompatibleA2AContext("client-1", "context-1", "scenario_simulation"))
    .toThrowError("CONTEXT_CAPABILITY_MISMATCH");
  expect(() => requireCompatibleA2AContext("client-1", "context-1", "research_search"))
    .toThrowError("CONTEXT_CAPABILITY_MISMATCH");
});
```

- [ ] **Step 5: Implement context creation**

In `src/server/a2a/context-service.ts`, implement:

```typescript
export async function createA2AContext(input: {
  externalClientId: string;
  capabilityId: CapabilityId;
  requestedContextId?: string;
  profile?: ExternalProfile;
  goals?: ExternalGoal[];
  portfolio?: ExternalPortfolio;
}): Promise<{
  contextId: string;
  executionUserId: string;
  portfolioSnapshotId: string | null;
}>;

export function getA2AContext(externalClientId: string, contextId: string): A2AContextView | null;
export function requireA2AContext(externalClientId: string, contextId: string): A2AContextView;
export function requireCompatibleA2AContext(
  externalClientId: string,
  contextId: string,
  requestedCapability: CapabilityId,
): A2AContextView;
```

Creation transaction:

1. Create `users` row with null username/password and display name `A2A External Context`.
2. Create `a2a_contexts` with expiry `now + 30 days`.
3. Insert `user_profiles` when supplied.
4. Insert `goals`.
5. Resolve and insert `portfolio_snapshots` plus `holding_snapshots`.
6. Record price source/status in `source_statuses_json`.
7. Never query another user's profile, goals, holdings, or snapshots.

Compatibility rules:

```text
ADVISORY   = chief_advisor_conversation + debate_mode
SIMULATION = scenario_simulation only
RESEARCH   = research_search only
```

`requireCompatibleA2AContext` compares `capabilityFamily(primaryCapability)` with `capabilityFamily(requestedCapability)` and throws `CONTEXT_CAPABILITY_MISMATCH` when they differ.

- [ ] **Step 6: Run context and market-data tests**

```bash
pnpm vitest run src/server/a2a/external-market-data.test.ts src/server/a2a/context-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/a2a/contracts.ts src/server/a2a/context-service.ts src/server/a2a/external-market-data.ts src/server/a2a/context-service.test.ts src/server/a2a/external-market-data.test.ts
git commit -m "feat: isolate external A2A context data"
```

---

### Task 4: Add Common A2A Tasks, Idempotency, And Protocol Mapping

**Files:**
- Modify: `src/server/a2a/contracts.ts`
- Create: `src/server/a2a/task-service.ts`
- Create: `src/server/a2a/protocol.ts`
- Create: `src/server/a2a/task-service.test.ts`
- Create: `src/server/a2a/protocol.test.ts`

- [ ] **Step 1: Write failing task ownership and idempotency tests**

Create `src/server/a2a/task-service.test.ts`:

```typescript
it("replays the same client message and rejects changed content", () => {
  seedContext("client-1", "context-1");
  const first = createA2ATask({
    externalClientId: "client-1",
    contextId: "context-1",
    capabilityId: "debate_mode",
    operation: "start",
    clientMessageId: "message-1",
    input: { text: "AAPL debate" },
  });
  const replay = createA2ATask({
    externalClientId: "client-1",
    contextId: "context-1",
    capabilityId: "debate_mode",
    operation: "start",
    clientMessageId: "message-1",
    input: { text: "AAPL debate" },
  });
  expect(replay).toMatchObject({ replayed: true, task: { id: first.task.id } });

  expect(() => createA2ATask({
    externalClientId: "client-1",
    contextId: "context-1",
    capabilityId: "debate_mode",
    operation: "start",
    clientMessageId: "message-1",
    input: { text: "Different request" },
  })).toThrowError("IDEMPOTENCY_CONFLICT");
});

it("returns null for a foreign task", () => {
  expect(getA2ATask("client-2", "task-1")).toBeNull();
});
```

- [ ] **Step 2: Implement task storage**

Add the shared task and adapter types to `src/server/a2a/contracts.ts`. These types use `ExternalClientPrincipal` and `A2AContextView` already declared in the same file, so the behavior modules do not import each other:

```typescript
export type A2ATaskStatus =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "canceled"
  | "failed";

export type A2AArtifact = {
  artifactId: string;
  name: string;
  text: string;
  data: Record<string, unknown>;
};

export type A2ATaskResult = {
  message: string;
  artifacts: A2AArtifact[];
  metadata?: Record<string, unknown>;
};

export type PublicA2AError = {
  code: string;
  message: string;
  status: number;
  retryable?: boolean;
  details?: Record<string, unknown>;
};

export type A2ATaskView = {
  id: string;
  externalClientId: string;
  contextId: string;
  capabilityId: z.infer<typeof CapabilityIdSchema>;
  operation: string;
  status: A2ATaskStatus;
  domainResourceType: string | null;
  domainResourceId: string | null;
  result: A2ATaskResult | null;
  error: PublicA2AError | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  events: Array<{ sequenceNo: number; eventType: string; payload: unknown; createdAt: string }>;
};

export type CapabilityAdapterInput = {
  principal: ExternalClientPrincipal;
  task: A2ATaskView;
  context: A2AContextView;
  messageId: string;
  text: string;
  operation: string;
  input: Record<string, unknown>;
  acceptedOutputModes: string[];
};

export type CapabilityCancellationInput = {
  principal: ExternalClientPrincipal;
  task: A2ATaskView;
};

export type CapabilityAdapter = {
  run(input: CapabilityAdapterInput): Promise<A2ATaskView>;
  cancel?(input: CapabilityCancellationInput): Promise<void> | void;
};

export type A2ACommand =
  | {
      kind: "send-message";
      requestId: string | number | null;
      payload: {
        messageId: string;
        contextId: string | null;
        text: string;
        capabilityId: z.infer<typeof CapabilityIdSchema>;
        operation: string;
        input: Record<string, unknown>;
        acceptedOutputModes: string[];
      };
    }
  | { kind: "get-task"; requestId: string | number | null; taskId: string }
  | { kind: "list-tasks"; requestId: string | number | null; cursor?: string; limit: number }
  | { kind: "cancel-task"; requestId: string | number | null; taskId: string };
```

In `src/server/a2a/task-service.ts`, implement:

```typescript
export function createA2ATask(input: CreateTaskInput): { replayed: boolean; task: A2ATaskView };
export function startA2ATask(clientId: string, taskId: string): A2ATaskView;
export function completeA2ATask(clientId: string, taskId: string, result: A2ATaskResult): A2ATaskView;
export function requireInputForA2ATask(clientId: string, taskId: string, result: A2ATaskResult): A2ATaskView;
export function failA2ATask(clientId: string, taskId: string, error: PublicA2AError): A2ATaskView;
export function cancelA2ATask(clientId: string, taskId: string): A2ATaskView;
export function getA2ATask(clientId: string, taskId: string, historyLength?: number): A2ATaskView | null;
export function listA2ATasks(clientId: string, input: { limit: number; cursor?: string }): { items: A2ATaskView[]; nextCursor: string | null };
export function appendA2ATaskEvent(clientId: string, taskId: string, eventType: string, payload: unknown): void;
```

Canonical request hashing:

```typescript
const requestHash = createHash("sha256")
  .update(JSON.stringify(sortKeysRecursively(input)))
  .digest("hex");
```

Cancellation rules:

- `submitted` and `working` become `canceled`.
- Terminal tasks throw `TASK_NOT_CANCELLABLE`.
- Foreign tasks return `TASK_NOT_FOUND`.

- [ ] **Step 3: Write failing protocol alias tests**

Create `src/server/a2a/protocol.test.ts`:

```typescript
it.each(["message/send", "SendMessage"])("normalizes %s", (method) => {
  expect(parseJsonRpcCommand({
    jsonrpc: "2.0",
    id: "rpc-1",
    method,
    params: {
      message: {
        role: "user",
        messageId: "message-1",
        parts: [{ kind: "text", text: "hello" }],
      },
    },
  })).toMatchObject({ kind: "send-message", requestId: "rpc-1" });
});

it.each([
  ["tasks/get", "get-task"],
  ["GetTask", "get-task"],
  ["tasks/list", "list-tasks"],
  ["ListTasks", "list-tasks"],
  ["tasks/cancel", "cancel-task"],
  ["CancelTask", "cancel-task"],
])("normalizes %s", (method, kind) => {
  expect(parseJsonRpcCommand({ jsonrpc: "2.0", id: "rpc-1", method, params: { id: "task-1" } }))
    .toMatchObject({ kind });
});
```

- [ ] **Step 4: Implement protocol normalization**

In `src/server/a2a/protocol.ts`, implement:

```typescript
export function parseJsonRpcCommand(body: unknown): A2ACommand;
export function parseLegacySendMessage(body: unknown): A2ACommand;
export function parseHttpSendMessage(body: unknown): A2ACommand;
export function jsonRpcSuccess(requestId: string | number | null, result: unknown): unknown;
export function jsonRpcError(requestId: string | number | null, error: PublicA2AError): unknown;
export function toA2ATaskResource(task: A2ATaskView): Record<string, unknown>;
```

Message parsing must retain:

- `messageId`
- `contextId`
- text parts
- `metadata.capabilityId`
- `metadata.operation`
- `metadata.input`
- accepted output modes

Default missing capability metadata to Chief Advisor `send`.

- [ ] **Step 5: Run task/protocol tests**

```bash
pnpm vitest run src/server/a2a/task-service.test.ts src/server/a2a/protocol.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/a2a/task-service.ts src/server/a2a/protocol.ts src/server/a2a/task-service.test.ts src/server/a2a/protocol.test.ts
git commit -m "feat: add A2A task lifecycle"
```

---

### Task 5: Build The Gateway And Dual Protocol Routes

**Files:**
- Create: `src/server/a2a/gateway.ts`
- Create: `src/server/a2a/gateway.test.ts`

- [ ] **Step 1: Write failing dispatcher tests**

Create `src/server/a2a/gateway.test.ts` with capability adapters mocked:

```typescript
it("dispatches a normalized message through the injected adapter registry", async () => {
  const registry = adapterRegistryFixture();
  const result = await executeA2ACommand(principalFixture(), {
    kind: "send-message",
    requestId: "rpc-1",
    payload: {
      messageId: "message-1",
      contextId: null,
      text: "Review my portfolio",
      capabilityId: "chief_advisor_conversation",
      operation: "send",
      input: {},
      acceptedOutputModes: [],
    },
  }, registry);
  expect(registry.chief_advisor_conversation.run).toHaveBeenCalled();
  expect(result).toMatchObject({ jsonrpc: "2.0", id: "rpc-1" });
});

it("rejects a capability outside the client scope", async () => {
  await expect(executeA2ACommand(
    principalFixture(["tasks_read"]),
    debateCommand(),
    adapterRegistryFixture(),
  ))
    .rejects.toMatchObject({ code: "CAPABILITY_NOT_ALLOWED", status: 403 });
});
```

- [ ] **Step 2: Implement the common gateway**

Create `src/server/a2a/gateway.ts`:

```typescript
export async function handleJsonRpcA2ARequest(request: NextRequest): Promise<Response>;
export async function handleHttpSendMessage(request: NextRequest): Promise<Response>;
export async function handleHttpListTasks(request: NextRequest): Promise<Response>;
export async function handleHttpTaskRequest(request: NextRequest, path: string[]): Promise<Response>;
export async function executeA2ACommand(
  principal: ExternalClientPrincipal,
  command: A2ACommand,
  adapters: Record<CapabilityId, CapabilityAdapter>,
): Promise<unknown>;
```

`executeA2ACommand` rules:

- `send-message`: require the capability scope, create/load a context, create an idempotent task, dispatch the adapter, and map the task.
- `get-task`: require `tasks_read`.
- `list-tasks`: require `tasks_read`.
- `cancel-task`: require `tasks_cancel`, load the task, invoke the injected adapter's cancellation hook, then mark the task canceled.

The request-handler exports accept a registry parameter:

```typescript
export function createA2ARequestHandlers(adapters: Record<CapabilityId, CapabilityAdapter>) {
  return {
    handleJsonRpcA2ARequest,
    handleHttpSendMessage,
    handleHttpListTasks,
    handleHttpTaskRequest,
  };
}
```

This task tests the gateway with injected mock adapters. Production route wiring waits until Task 6 creates the first real adapter and Task 10 completes the full registry.

- [ ] **Step 3: Run gateway tests**

```bash
pnpm vitest run src/server/a2a/gateway.test.ts
```

Expected: PASS with all capability adapters injected as mocks.

- [ ] **Step 4: Commit**

```bash
git add src/server/a2a/gateway.ts src/server/a2a/gateway.test.ts
git commit -m "feat: add capability-neutral A2A gateway"
```

---

### Task 6: Connect The Chief Advisor To External Context Data

**Files:**
- Create: `src/server/a2a/capabilities/advisor.ts`
- Create: `src/server/a2a/capabilities/advisor.test.ts`
- Create: `src/server/a2a/adapter-registry.ts`
- Modify: `src/server/a2a/gateway.ts`
- Modify: `src/app/api/a2a/message-send/route.ts`
- Replace: `src/app/api/a2a/message-send/route.test.ts`
- Create: `src/app/api/a2a/message:send/route.ts`
- Create: `src/app/api/a2a/tasks/route.ts`
- Create: `src/app/api/a2a/tasks/[...path]/route.ts`
- Create: `src/app/api/a2a/protocol-parity.test.ts`
- Modify: `src/server/a2a/agent-card.ts`

- [ ] **Step 1: Write the failing advisor adapter test**

Create `src/server/a2a/capabilities/advisor.test.ts`:

```typescript
it("runs the Chief Advisor under the context execution principal", async () => {
  seedContextWithExecutionUser({
    clientId: "client-1",
    contextId: "context-1",
    executionUserId: "exec-1",
  });
  runConversationAgentMock.mockResolvedValueOnce({
    messageId: "user-message",
    assistantMessageId: "assistant-message",
    analysis: { analysisId: "analysis-1", status: "COMPLETED" },
    answer: "组合集中度偏高。",
    recommendationId: null,
    missingQuestions: [],
    outputMode: "SQL_ONLY",
  });

  const task = await runAdvisorCapability(adapterInput({
    contextId: "context-1",
    text: "诊断我的组合风险",
  }));

  expect(runConversationAgentMock).toHaveBeenCalledWith(expect.objectContaining({
    userId: "exec-1",
    sessionId: expect.any(String),
    content: "诊断我的组合风险",
  }));
  expect(task.status).toBe("completed");
});
```

- [ ] **Step 2: Implement the advisor adapter**

Create `src/server/a2a/capabilities/advisor.ts`:

```typescript
export async function runAdvisorCapability(input: CapabilityAdapterInput): Promise<A2ATaskView>;
```

Behavior:

1. Require `operation` to be `send` or `answer_clarification`.
2. Load the context and execution principal.
3. Create/reuse a context-owned `conversation_sessions` row.
4. Start the task.
5. Call `runConversationAgent`.
6. Map:
   - `WAITING_FOR_USER` to `input-required`
   - `FAILED` to `failed`
   - other terminal status to `completed`
7. Return an `advisor_result` artifact containing answer, recommendation ID, missing questions, generated artifact, and risk notice.

- [ ] **Step 3: Update the Agent Card only for executable capabilities**

At this stage, keep `chief_advisor_conversation` executable. Do not advertise debate/simulation/research as top-level `skills` until their tasks pass later. Add task lifecycle metadata and both interface URLs.

- [ ] **Step 4: Wire the production registry and dual protocol routes**

Create `src/server/a2a/adapter-registry.ts`:

```typescript
import type { CapabilityAdapter, CapabilityId } from "./contracts";
import { runAdvisorCapability } from "./capabilities/advisor";

const unsupported = (capabilityId: CapabilityId): CapabilityAdapter => ({
  async run() {
    throw {
      code: "CAPABILITY_NOT_AVAILABLE",
      message: `${capabilityId} is not available yet`,
      status: 503,
      retryable: false,
    };
  },
});

export const capabilityAdapters: Record<CapabilityId, CapabilityAdapter> = {
  chief_advisor_conversation: { run: runAdvisorCapability },
  debate_mode: unsupported("debate_mode"),
  scenario_simulation: unsupported("scenario_simulation"),
  research_search: unsupported("research_search"),
};
```

Use `createA2ARequestHandlers(capabilityAdapters)` in:

```text
POST /api/a2a/message-send
POST /api/a2a/message:send
GET  /api/a2a/tasks
GET  /api/a2a/tasks/{id}
POST /api/a2a/tasks/{id}:cancel
```

The catch-all task route parses `{id}` and `{id}:cancel`; all other shapes return 404.

- [ ] **Step 5: Add protocol parity and authorization tests**

Create `src/app/api/a2a/protocol-parity.test.ts`:

```typescript
it("returns equivalent task resources for JSON-RPC and HTTP send", async () => {
  const token = seedExternalToken(["chief_advisor_conversation", "tasks_read"]);
  runConversationAgentMock.mockResolvedValue(completedAdvisorResultFixture());

  const rpc = await POST_JSON_RPC(a2aRequest("/api/a2a/message-send", token, rpcSendBody()));
  const http = await POST_HTTP(a2aRequest("/api/a2a/message:send", token, httpSendBody()));

  expect((await rpc.json()).result).toMatchObject(stripGeneratedFields(await http.json()));
});

it.each(["message/send", "SendMessage"])("accepts JSON-RPC method %s", async (method) => {
  const response = await POST_JSON_RPC(a2aRequest(
    "/api/a2a/message-send",
    token,
    { ...rpcSendBody(), method },
  ));
  expect(response.status).toBe(200);
  expect((await response.json()).result.kind).toBe("task");
});

it.each([
  ["tasks/get", "GetTask"],
  ["tasks/list", "ListTasks"],
  ["tasks/cancel", "CancelTask"],
])("keeps task aliases equivalent", async (legacyMethod, v1Method) => {
  const legacy = await callTaskMethod(token, legacyMethod, taskId);
  const v1 = await callTaskMethod(token, v1Method, taskId);
  expect(stripGeneratedFields(legacy)).toEqual(stripGeneratedFields(v1));
});

it("rejects missing tokens, missing scopes, and foreign tasks", async () => {
  expect((await POST_JSON_RPC(a2aRequest("/api/a2a/message-send", null, rpcSendBody()))).status).toBe(401);
  expect((await POST_JSON_RPC(a2aRequest("/api/a2a/message-send", readOnlyToken, rpcSendBody()))).status).toBe(403);
  expect((await GET_HTTP(a2aRequest(`/api/a2a/tasks/${taskId}`, otherClientToken))).status).toBe(404);
});
```

- [ ] **Step 6: Run advisor and protocol compatibility tests**

```bash
pnpm vitest run src/server/a2a/capabilities/advisor.test.ts src/app/api/a2a/message-send/route.test.ts src/app/api/a2a/protocol-parity.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/a2a/capabilities/advisor.ts src/server/a2a/capabilities/advisor.test.ts src/server/a2a/adapter-registry.ts src/server/a2a/gateway.ts src/app/api/a2a src/server/a2a/agent-card.ts
git commit -m "feat: run Chief Advisor through external A2A"
```

---

### Task 7: Implement The Service-Side Debate Agents

**Files:**
- Create: `src/server/a2a/capabilities/debate-contracts.ts`
- Create: `src/server/a2a/capabilities/debate-agents.ts`
- Create: `src/server/a2a/capabilities/debate-agents.test.ts`

- [ ] **Step 1: Add structured debate contracts**

Create `src/server/a2a/capabilities/debate-contracts.ts`:

```typescript
export const DebateOperationSchema = z.enum([
  "start",
  "continue",
  "question_bull",
  "question_bear",
  "join_bull",
  "join_bear",
  "summarize",
  "finalize",
]);

export const DebateEvidenceBoardSchema = z.object({
  topic: z.string().min(1),
  facts: z.array(z.string()).max(20),
  supportingEvidence: z.array(z.string()).max(12),
  counterEvidence: z.array(z.string()).max(12),
  unknowns: z.array(z.string()).max(12),
  dataAsOf: z.string().nullable(),
});

export const DebatePositionSchema = z.object({
  thesis: z.string().min(1),
  evidence: z.array(z.string()).min(1).max(5),
  counterEvidence: z.array(z.string()).min(1).max(3),
  assumptions: z.array(z.string()).min(1).max(5),
  rebuttal: z.string().min(1),
  risks: z.array(z.string()).min(1).max(5),
});

export const DebateJudgeSchema = z.object({
  roundFocus: z.string().min(1),
  userClaim: z.string().min(1),
  bullSummary: z.string().min(1),
  bearSummary: z.string().min(1),
  evidenceBalance: z.enum(["BULL_LEANING", "BEAR_LEANING", "BALANCED", "INSUFFICIENT"]),
  unansweredQuestions: z.array(z.string()).max(8),
  missingInformation: z.array(z.string()).max(8),
  recommendedNextQuestions: z.array(z.string()).min(1).max(5),
  dataAsOf: z.string().nullable(),
});
```

- [ ] **Step 2: Write failing debate agent tests**

Create `src/server/a2a/capabilities/debate-agents.test.ts`:

```typescript
it("produces evidence, bull, bear and judge outputs from one shared board", async () => {
  streamObjectMock
    .mockResolvedValueOnce(orchestratorFixture())
    .mockResolvedValueOnce(evidenceFixture())
    .mockResolvedValueOnce(bullFixture())
    .mockResolvedValueOnce(bearFixture())
    .mockResolvedValueOnce(judgeFixture());

  const result = await runDebateAgents({
    topic: "AAPL 是否适合两周内加仓",
    operation: "start",
    userText: "我觉得跌多了就可以买",
    userStance: "NEUTRAL",
    existingEvidenceBoard: null,
    publicContext: publicContextFixture(),
  });

  expect(result.turns.map((turn) => turn.role)).toEqual([
    "ORCHESTRATOR",
    "EVIDENCE",
    "BULL",
    "BEAR",
    "JUDGE",
  ]);
  expect(result.judge.evidenceBalance).toBe("BALANCED");
});
```

Add a direct-question test asserting `question_bear` puts BEAR before BULL.

- [ ] **Step 3: Implement Mastra debate agents**

Create `src/server/a2a/capabilities/debate-agents.ts`:

```typescript
export async function runDebateAgents(input: DebateAgentInput): Promise<DebateAgentResult>;
```

Create five Mastra `Agent` instances:

- `external-debate-orchestrator`
- `external-debate-evidence`
- `external-debate-bull`
- `external-debate-bear`
- `external-debate-judge`

All use `getDeepSeekModelConfig`, `maxSteps: 1`, temperature `0.1`, and structured output. Prompts must:

- Use only the shared public context and Evidence Board.
- Mark caller claims as claims.
- Avoid hidden reasoning.
- Avoid direct buy/sell commands.
- Include counter evidence and missing information.

Execute Evidence before positions. Execute Bull/Bear in operation-specific order. Judge always executes last.

- [ ] **Step 4: Run debate agent tests**

```bash
pnpm vitest run src/server/a2a/capabilities/debate-agents.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/a2a/capabilities/debate-contracts.ts src/server/a2a/capabilities/debate-agents.ts src/server/a2a/capabilities/debate-agents.test.ts
git commit -m "feat: add service-side debate agents"
```

---

### Task 8: Add Stateful Debate Sessions And Finalization

**Files:**
- Create: `src/server/a2a/capabilities/debate-service.ts`
- Create: `src/server/a2a/capabilities/debate.ts`
- Create: `src/server/a2a/capabilities/debate-service.test.ts`
- Modify: `src/server/a2a/gateway.ts`
- Modify: `src/server/a2a/adapter-registry.ts`

- [ ] **Step 1: Write failing multi-round workflow tests**

Create `src/server/a2a/capabilities/debate-service.test.ts`:

```typescript
it("starts and continues a debate with increasing round numbers", async () => {
  seedContextWithExecutionUser({ clientId: "client-1", contextId: "context-1", executionUserId: "exec-1" });
  runDebateAgentsMock
    .mockResolvedValueOnce(roundFixture(1))
    .mockResolvedValueOnce(roundFixture(2));

  const first = await runDebateCapability(adapterInput({ operation: "start", text: "AAPL 是否适合加仓" }));
  const second = await runDebateCapability(adapterInput({ operation: "continue", text: "继续讨论估值风险", contextId: first.contextId }));

  expect(first.result?.artifacts[0].data.roundNo).toBe(1);
  expect(second.result?.artifacts[0].data.roundNo).toBe(2);
});

it("finalizes through the Chief Advisor publication gate", async () => {
  runConversationAgentMock.mockResolvedValueOnce(completedAdvisorResultFixture());
  const result = await runDebateCapability(adapterInput({ operation: "finalize", contextId: "context-1", text: "给出最终模拟建议" }));
  expect(runConversationAgentMock).toHaveBeenCalledWith(expect.objectContaining({
    userId: "exec-1",
    content: expect.stringContaining("多空辩论证据"),
  }));
  expect(result.result?.artifacts.map((artifact) => artifact.name)).toContain("debate_summary");
});
```

- [ ] **Step 2: Implement debate persistence**

In `src/server/a2a/capabilities/debate-service.ts`, implement:

```typescript
export async function startDebateRound(input: DebateRoundInput): Promise<DebateRoundView>;
export function getDebateSession(clientId: string, contextId: string): DebateSessionView | null;
export async function finalizeDebate(input: DebateFinalizeInput): Promise<DebateFinalizeView>;
```

Rules:

- `start` requires no existing session.
- Other operations require an active session.
- Stance mapping:
  - `join_bull` -> `BULL`
  - `join_bear` -> `BEAR`
  - otherwise retain prior stance or `NEUTRAL`
- Persist one round and ordered public turns in one transaction.
- Merge the new Evidence Board with existing facts by exact normalized string.
- `summarize` may run Judge without creating new Bull/Bear positions.
- `finalize` marks the debate `FINALIZED` and invokes the Chief Advisor adapter using a generated public evidence summary.

- [ ] **Step 3: Implement the A2A debate adapter**

In `src/server/a2a/capabilities/debate.ts`:

```typescript
export async function runDebateCapability(input: CapabilityAdapterInput): Promise<A2ATaskView>;
```

Return:

- `debate_round` artifact for round operations.
- `debate_summary` plus `advisor_result` artifacts for finalize.
- `input-required` when topic or required portfolio/profile constraints are missing.

- [ ] **Step 4: Replace the debate placeholder adapter**

Update `src/server/a2a/adapter-registry.ts`:

```typescript
capabilityAdapters.debate_mode = {
  run: runDebateCapability,
};
```

- [ ] **Step 5: Run debate workflow tests**

```bash
pnpm vitest run src/server/a2a/capabilities/debate-service.test.ts src/server/a2a/capabilities/debate-agents.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/a2a/capabilities/debate-service.ts src/server/a2a/capabilities/debate.ts src/server/a2a/capabilities/debate-service.test.ts src/server/a2a/gateway.ts src/server/a2a/adapter-registry.ts
git commit -m "feat: expose stateful debate over A2A"
```

---

### Task 9: Expose Complete Branch Simulation Operations

**Files:**
- Create: `src/server/a2a/capabilities/simulation.ts`
- Create: `src/server/a2a/capabilities/simulation.test.ts`
- Create: `src/server/extensions/simulation/service.test.ts`
- Modify: `src/server/extensions/simulation/service.ts`
- Modify: `src/server/a2a/gateway.ts`
- Modify: `src/server/a2a/adapter-registry.ts`

- [ ] **Step 1: Add a focused archive service function**

Create `src/server/extensions/simulation/service.test.ts` with a temporary database and seed the minimum user, instrument, portfolio snapshot, root workspace, and root branch needed by `archiveWorkspace`:

```typescript
it("archives only the owned workspace", () => {
  const result = archiveWorkspace(TEST_USER_ID, workspaceId, 1);
  expect(result).toMatchObject({ status: "ARCHIVED", version: 2 });
  expect(() => archiveWorkspace("another-user", workspaceId, 2)).toThrowError("WORKSPACE_NOT_FOUND");
});
```

Implement:

```typescript
export function archiveWorkspace(userId: string, workspaceId: string, expectedVersion: number) {
  const db = getDatabase();
  const owned = db.prepare("SELECT row_version FROM simulation_workspaces WHERE id=? AND user_id=?")
    .get(workspaceId, userId) as { row_version: number } | undefined;
  if (!owned) {
    db.close();
    throw new Error("WORKSPACE_NOT_FOUND");
  }
  if (owned.row_version !== expectedVersion) {
    db.close();
    throw new Error("VERSION_CONFLICT");
  }
  const now = isoNow();
  db.prepare(`UPDATE simulation_workspaces
    SET status='archived',row_version=row_version+1,updated_at=?
    WHERE id=? AND user_id=? AND row_version=?`)
    .run(now, workspaceId, userId, expectedVersion);
  db.close();
  return getWorkspace(userId, workspaceId);
}
```

- [ ] **Step 2: Write failing simulation adapter tests**

Create `src/server/a2a/capabilities/simulation.test.ts`:

```typescript
it("starts from the context-owned server-priced snapshot", async () => {
  seedContextWithPortfolio({
    clientId: "client-1",
    contextId: "context-1",
    executionUserId: "exec-1",
    portfolioSnapshotId: "snapshot-1",
  });
  const task = await runSimulationCapability(adapterInput({
    capabilityId: "scenario_simulation",
    operation: "start",
    input: { objective: "比较保持、再平衡和降险", label: "外部模拟" },
  }));
  expect(createWorkspaceMock).toHaveBeenCalledWith("exec-1", expect.objectContaining({
    portfolioSnapshotId: "snapshot-1",
  }));
  expect(task.result?.artifacts[0].name).toBe("simulation_workspace");
});
```

Add operation mapping tests:

```typescript
it.each([
  ["generate_options", generateOptionsMock],
  ["get_options", listOptionsMock],
  ["execute_option", executeOptionMock],
  ["get_tree", getWorkspaceMock],
  ["get_snapshot", getBranchSnapshotMock],
  ["switch_branch", switchBranchMock],
  ["undo", undoBranchMock],
  ["archive", archiveWorkspaceMock],
] as const)("maps %s to the simulation service", async (operation, serviceMock) => {
  await runSimulationCapability(adapterInput({
    operation,
    input: simulationOperationInput(operation),
  }));
  expect(serviceMock).toHaveBeenCalled();
  expect(serviceMock.mock.calls[0]?.[0]).toBe("exec-1");
});

it("does not expose a workspace owned by another execution principal", async () => {
  getWorkspaceMock.mockReturnValueOnce(null);
  await expect(runSimulationCapability(adapterInput({
    operation: "get_tree",
    input: { workspaceId: "foreign-workspace" },
  }))).rejects.toMatchObject({ code: "TASK_NOT_FOUND", status: 404 });
});
```

- [ ] **Step 3: Implement the simulation adapter**

Create `src/server/a2a/capabilities/simulation.ts`:

```typescript
export async function runSimulationCapability(input: CapabilityAdapterInput): Promise<A2ATaskView>;
export function cancelSimulationCapability(input: CapabilityCancellationInput): void;
```

Operation mapping:

```text
start            -> createWorkspace
generate_options -> generateOptions
get_options      -> listOptions
execute_option   -> executeOption
get_tree         -> getWorkspace
get_snapshot     -> getBranchSnapshot
switch_branch    -> switchBranch
undo             -> undoBranch
archive          -> archiveWorkspace
```

Every call must:

1. Load the A2A context and execution `userId`.
2. Validate the workspace ID stored in the context/task domain resource.
3. Invoke existing service functions using the execution `userId`.
4. Persist domain resource type/ID on the A2A task.
5. Map results to one of:
   - `simulation_workspace`
   - `simulation_options`
   - `simulation_branch`
   - `simulation_snapshot`

`generate_options` returns a working task linked to the option batch analysis. `GetTask` refreshes it from `agent_runs` and `simulation_option_batches`.

- [ ] **Step 4: Add domain-status synchronization**

Extend `task-service.ts` with:

```typescript
export function refreshA2ATaskFromDomain(clientId: string, taskId: string): A2ATaskView;
```

For `simulation_option_batch`, map batch state to A2A state and attach generated options when succeeded.

- [ ] **Step 5: Replace the simulation placeholder adapter**

Update `src/server/a2a/adapter-registry.ts`:

```typescript
capabilityAdapters.scenario_simulation = {
  run: runSimulationCapability,
  cancel: cancelSimulationCapability,
};
```

- [ ] **Step 6: Run simulation tests**

```bash
pnpm vitest run src/server/a2a/capabilities/simulation.test.ts src/server/extensions/simulation/service.test.ts src/app/api/v1/simulation-workspaces/route.test.ts src/server/extensions/simulation/candidate-generator.test.ts src/server/extensions/simulation/deterministic-engine.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/a2a/capabilities/simulation.ts src/server/a2a/capabilities/simulation.test.ts src/server/extensions/simulation/service.ts src/server/extensions/simulation/service.test.ts src/server/a2a/gateway.ts src/server/a2a/task-service.ts src/server/a2a/adapter-registry.ts
git commit -m "feat: expose branch simulation over A2A"
```

---

### Task 10: Expose Stateful Research Search, Refine, Retry, And Cancel

**Files:**
- Create: `src/server/a2a/capabilities/research.ts`
- Create: `src/server/a2a/capabilities/research.test.ts`
- Create: `src/server/extensions/search/service.test.ts`
- Modify: `src/server/extensions/search/service.ts`
- Modify: `src/server/extensions/search/web-adapter.ts`
- Modify: `src/server/extensions/search/mcp-adapter.ts`
- Modify: `src/server/extensions/search/knowledge-base-adapter.ts`
- Modify: `src/server/extensions/search/rss-adapter.ts`
- Modify: `src/server/a2a/gateway.ts`
- Modify: `src/server/a2a/task-service.ts`
- Modify: `src/server/a2a/adapter-registry.ts`

- [ ] **Step 1: Refactor research execution into start, execute, and await APIs**

Write a failing test in `src/server/extensions/search/service.test.ts`:

```typescript
it("starts immediately and does not publish completed state after cancellation", async () => {
  const controller = new AbortController();
  searchWebMock.mockImplementation(async (_query, { signal }) => {
    await waitForAbort(signal);
    return [{ title: "late", url: "https://example.com", snippet: "late" }];
  });

  const started = startResearchSearch({
    userId: "exec-1",
    query: "AAPL",
    adapters: ["WEB"],
    maximumResults: 10,
    signal: controller.signal,
  });
  expect(started.status).toBe("RUNNING");

  controller.abort();
  const result = await started.completion;
  expect(result.status).toBe("CANCELED");
});
```

Split the service into:

```typescript
export type ResearchSearchInput = {
  userId: string;
  query: string;
  adapters: ResearchAdapter[];
  maximumResults: number;
  signal?: AbortSignal;
  parentSearchId?: string;
};

export function startResearchSearch(input: ResearchSearchInput): {
  searchId: string;
  analysisId: string;
  status: "RUNNING";
  completion: Promise<ResearchSearchResult>;
};

export async function runResearchSearch(input: ResearchSearchInput): Promise<ResearchSearchResult> {
  return startResearchSearch(input).completion;
}
```

Check `signal.aborted` before adapter calls, before persistence, and before final status updates. Change every search adapter signature to:

```typescript
(query: string, filters: { limit: number; signal?: AbortSignal }) => Promise<SearchResult[]>
```

Pass the same signal to WEB, MCP, KNOWLEDGE_BASE, and RSS adapters. Late adapter results are discarded and never written after cancellation.

Existing `/api/v1/research-searches` behavior remains compatible because it continues awaiting `runResearchSearch`. The A2A adapter uses `startResearchSearch` so it can return a working task immediately.

- [ ] **Step 2: Write failing research adapter tests**

Create `src/server/a2a/capabilities/research.test.ts`:

```typescript
it("starts a working research task and returns cited results after refresh", async () => {
  const completion = deferred<ResearchSearchResult>();
  startResearchSearchMock.mockReturnValueOnce({
    searchId: "search-1",
    analysisId: "analysis-1",
    status: "RUNNING",
    completion: completion.promise,
  });
  seedResearchResult("search-1", {
    title: "Apple filing",
    url: "https://example.com/apple",
    snippet: "Risk factors",
    adapter: "web",
  });

  const task = await runResearchCapability(adapterInput({
    operation: "start",
    input: { query: "AAPL risks", adapters: ["WEB"], maximumResults: 10 },
  }));
  expect(task.status).toBe("working");
  expect(task.domainResourceId).toBe("search-1");

  completion.resolve({
    searchId: "search-1",
    analysisId: "analysis-1",
    resultCount: 1,
    status: "COMPLETED",
    sourceStatuses: [{ adapter: "WEB", status: "SUCCEEDED", error: null }],
  });
  await completion.promise;

  const refreshed = refreshA2ATaskFromDomain("client-1", task.id);
  expect(refreshed.status).toBe("completed");
  expect(refreshed.result?.artifacts[0]).toMatchObject({
    name: "research_results",
    data: { items: [expect.objectContaining({ citation: "https://example.com/apple" })] },
  });
});
```

Add these adapter tests:

```typescript
it("reads results only through the context execution user", async () => {
  seedResearchSearch({ searchId: "search-1", userId: "exec-1" });
  seedResearchSearch({ searchId: "search-foreign", userId: "exec-2" });
  const own = await runResearchCapability(adapterInput({
    operation: "get_results",
    input: { searchId: "search-1" },
  }));
  expect(own.result?.artifacts[0].data.searchId).toBe("search-1");
  await expect(runResearchCapability(adapterInput({
    operation: "get_results",
    input: { searchId: "search-foreign" },
  }))).rejects.toMatchObject({ code: "TASK_NOT_FOUND", status: 404 });
});

it("refines with a child query and retries only failed adapters", async () => {
  seedResearchSources("search-1", [
    { adapter: "web", status: "succeeded" },
    { adapter: "rss", status: "failed" },
  ]);
  await runResearchCapability(adapterInput({
    operation: "refine",
    input: { parentSearchId: "search-1", query: "AAPL supply-chain risk", maximumResults: 5 },
  }));
  expect(startResearchSearchMock).toHaveBeenLastCalledWith(expect.objectContaining({
    parentSearchId: "search-1",
    query: "AAPL supply-chain risk",
  }));

  await runResearchCapability(adapterInput({
    operation: "retry",
    input: { searchId: "search-1", maximumResults: 5 },
  }));
  expect(startResearchSearchMock).toHaveBeenLastCalledWith(expect.objectContaining({
    adapters: ["RSS"],
  }));
});

it("keeps cancellation terminal after a late adapter completion", async () => {
  const task = await runResearchCapability(adapterInput({
    operation: "start",
    input: { query: "AAPL risks", adapters: ["WEB"], maximumResults: 10 },
  }));
  await cancelResearchCapability(cancellationInput("task-1"));
  resolveLateSearch();
  await flushPromises();
  expect(getA2ATask("client-1", task.id)?.status).toBe("canceled");
});
```

- [ ] **Step 3: Implement the research adapter**

Create `src/server/a2a/capabilities/research.ts`:

```typescript
export async function runResearchCapability(input: CapabilityAdapterInput): Promise<A2ATaskView>;
export function cancelResearchCapability(input: CapabilityCancellationInput): void;
```

Maintain active controllers:

```typescript
const activeResearchTasks = new Map<string, AbortController>();
```

Operation mapping:

```text
start       -> startResearchSearch and return working immediately
get_results -> query research_searches/results/sources by execution user
retry       -> rerun failed source adapters
refine      -> run a child query in the same context
cancel      -> abort active controller and keep task canceled
```

`start`, `retry`, and `refine` attach a rejection handler to `completion` so a
background failure is persisted on the A2A task instead of becoming an
unhandled rejection. They never await completion before returning the
`working` task.

Result artifact:

```typescript
{
  name: "research_results",
  data: {
    searchId,
    query,
    items: [{ title, snippet, url, citation, adapter, createdAt }],
    sourceStatuses: [{ adapter, status, resultCount, error }],
  },
}
```

- [ ] **Step 4: Add research status refresh**

Extend `refreshA2ATaskFromDomain` for `research_search`:

- running -> working
- succeeded -> completed with results
- failed -> failed
- canceled -> canceled

The search service persists `research_searches.status = 'canceled'`,
`completed_at`, and the linked `agent_runs.status = 'canceled'` when the abort
signal wins. The existing schema intentionally has no SQL status CHECK, so no
additional migration is required for this terminal state. A late adapter
completion must not replace it.

Update `src/server/a2a/adapter-registry.ts`:

```typescript
capabilityAdapters.research_search = {
  run: runResearchCapability,
  cancel: cancelResearchCapability,
};
```

- [ ] **Step 5: Run search tests**

```bash
pnpm vitest run src/server/extensions/search/service.test.ts src/server/a2a/capabilities/research.test.ts src/app/api/v1/research-searches/route.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/a2a/capabilities/research.ts src/server/a2a/capabilities/research.test.ts src/server/extensions/search src/server/a2a/gateway.ts src/server/a2a/task-service.ts
git commit -m "feat: expose research search over A2A"
```

---

### Task 11: Add 30-Day Cleanup And Context Deletion

**Files:**
- Create: `src/server/a2a/cleanup.ts`
- Create: `src/server/a2a/cleanup.test.ts`
- Create: `src/server/a2a/cleanup-scheduler.ts`
- Create: `src/app/api/a2a/contexts/[id]/route.ts`
- Create: `src/app/api/a2a/contexts/[id]/route.test.ts`
- Modify: `src/instrumentation.ts`

- [ ] **Step 1: Write failing cleanup safety tests**

Create `src/server/a2a/cleanup.test.ts`:

```typescript
it("deletes expired external data and preserves real users", () => {
  seedRealUser("real-user");
  seedExpiredExternalContext({
    clientId: "client-1",
    contextId: "context-expired",
    executionUserId: "exec-expired",
  });

  const result = cleanupExpiredA2AContexts("2026-08-25T00:00:00.000Z");

  const db = getDatabase();
  expect(db.prepare("SELECT id FROM users WHERE id='real-user'").get()).toEqual({ id: "real-user" });
  expect(db.prepare("SELECT id FROM users WHERE id='exec-expired'").get()).toBeUndefined();
  expect(db.prepare("SELECT id FROM a2a_contexts WHERE id='context-expired'").get()).toBeUndefined();
  db.close();
  expect(result.deletedContexts).toBe(1);
});

it("cancels active tasks before deleting a context", () => {
  seedExpiredWorkingTask();
  cleanupExpiredA2AContexts("2026-08-25T00:00:00.000Z");
  expect(cancelCapabilityTaskMock).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task-working" }));
});
```

- [ ] **Step 2: Implement context cleanup**

Create `src/server/a2a/cleanup.ts`:

```typescript
export function cleanupExpiredA2AContexts(now = isoNow()): {
  deletedContexts: number;
  deletedExecutionUsers: number;
  canceledTasks: number;
};

export function deleteA2AContext(externalClientId: string, contextId: string): void;
```

`deleteA2AContext` is the shared primitive for both TTL cleanup and the public
early-deletion HTTP extension. It first verifies ownership by both
`external_client_id` and `context_id`; a missing or foreign context produces
`CONTEXT_NOT_FOUND`.

For each eligible context:

1. Cancel active capability tasks.
2. Delete debate rows through context cascade.
3. Delete linked simulation workspaces.
4. Delete linked research searches.
5. Delete task events and tasks.
6. Delete context-owned recommendations, evidence, messages, sessions, snapshots, profiles, goals, risk assessments, holdings, and agent runs using the execution user ID.
7. Delete the A2A context.
8. Delete the execution user.

Every domain deletion query must include the execution user or a context-owned domain ID. Never delete by age alone from shared tables.

- [ ] **Step 3: Write failing early-deletion route tests**

Create `src/app/api/a2a/contexts/[id]/route.test.ts`:

```typescript
it("lets the owning external client delete a context before expiry", async () => {
  const token = seedExternalToken("client-1", ["tasks_cancel"]);
  seedActiveContext({
    clientId: "client-1",
    contextId: "context-active",
    executionUserId: "exec-active",
  });

  const response = await DELETE(
    a2aRequest("/api/a2a/contexts/context-active", token, { method: "DELETE" }),
    { params: Promise.resolve({ id: "context-active" }) },
  );

  expect(response.status).toBe(204);
  expect(loadA2AContext("client-1", "context-active")).toBeNull();
});

it("requires tasks_cancel and hides a foreign context", async () => {
  const readOnlyToken = seedExternalToken("client-1", ["tasks_read"]);
  seedActiveContext({
    clientId: "client-2",
    contextId: "context-foreign",
    executionUserId: "exec-foreign",
  });

  const forbidden = await DELETE(
    a2aRequest("/api/a2a/contexts/context-foreign", readOnlyToken, { method: "DELETE" }),
    { params: Promise.resolve({ id: "context-foreign" }) },
  );
  expect(forbidden.status).toBe(403);

  const cancelToken = seedExternalToken("client-1", ["tasks_cancel"]);
  const hidden = await DELETE(
    a2aRequest("/api/a2a/contexts/context-foreign", cancelToken, { method: "DELETE" }),
    { params: Promise.resolve({ id: "context-foreign" }) },
  );
  expect(hidden.status).toBe(404);
});
```

- [ ] **Step 4: Implement the HTTP early-deletion extension**

Create `src/app/api/a2a/contexts/[id]/route.ts`:

```typescript
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const principal = authenticateExternalRequest(request);
  requireA2ACapability(principal, "tasks_cancel");
  const { id } = await params;
  deleteA2AContext(principal.clientId, id);
  return new Response(null, { status: 204 });
}
```

Use the same public-error mapper as the A2A gateway so missing authentication,
missing scope, and foreign contexts return the established `401`, `403`, and
`404` contracts. This route is a documented Money Whisperer HTTP extension,
not an A2A v1 method alias.

- [ ] **Step 5: Add the hourly scheduler**

Create `src/server/a2a/cleanup-scheduler.ts` using the notification scheduler pattern:

```typescript
const SCHEDULER_INTERVAL_MS = 60 * 60 * 1_000;
const START_DELAY_MS = 30_000;

export function startA2ACleanupScheduler(): void;
```

Modify `src/instrumentation.ts`:

```typescript
const { startA2ACleanupScheduler } = await import("@/server/a2a/cleanup-scheduler");
startA2ACleanupScheduler();
```

- [ ] **Step 6: Run cleanup tests**

```bash
pnpm vitest run src/server/a2a/cleanup.test.ts src/app/api/a2a/contexts/[id]/route.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/a2a/cleanup.ts src/server/a2a/cleanup.test.ts src/server/a2a/cleanup-scheduler.ts src/app/api/a2a/contexts src/instrumentation.ts
git commit -m "feat: expire external A2A contexts"
```

---

### Task 12: Publish The Final Agent Card And Verify End-To-End Behavior

**Files:**
- Modify: `src/server/a2a/agent-card.ts`
- Modify: `src/app/.well-known/agent-card.json/route.test.ts`
- Modify: `docs/a2a-submission.md`
- Modify: `src/app/docs/a2a-submission/route.ts`
- Create: `tests/integration/a2a-external-gateway.test.ts`

- [ ] **Step 1: Write the failing final Agent Card test**

Update `src/app/.well-known/agent-card.json/route.test.ts`:

```typescript
expect(body.skills.map((skill: { id: string }) => skill.id)).toEqual([
  "chief_advisor_conversation",
  "debate_mode",
  "scenario_simulation",
  "research_search",
]);

expect(body.supportedInterfaces).toEqual(expect.arrayContaining([
  expect.objectContaining({
    url: "https://agents.example.com/api/a2a/message-send",
    protocolBinding: "JSONRPC",
  }),
  expect.objectContaining({
    url: "https://agents.example.com/api/a2a/message:send",
    protocolBinding: "HTTP+JSON",
  }),
]));

expect(body.capabilities).toMatchObject({
  streaming: false,
  pushNotifications: false,
  stateTransitionHistory: true,
});
```

Expected RED until the runtime can execute all four skills.

- [ ] **Step 2: Update the Agent Card**

Top-level executable skills:

```text
chief_advisor_conversation
debate_mode
scenario_simulation
research_search
```

Add:

```typescript
extensions: [
  {
    uri: `${baseUrl}/docs/a2a-submission#capability-metadata`,
    description: "Use message.metadata.capabilityId, operation, and input to invoke a stateful Money Whisperer capability.",
    required: false,
  },
],
```

Declare both JSON-RPC and HTTP+JSON interfaces. Remove any metadata language implying a listed top-level skill is workbench-only.

- [ ] **Step 3: Add cross-client end-to-end integration tests**

Create `tests/integration/a2a-external-gateway.test.ts`:

```typescript
describe("external A2A gateway", () => {
  it("runs all advertised capabilities and isolates two clients", async () => {
    const clientA = seedExternalToken([
      "chief_advisor_conversation",
      "debate_mode",
      "scenario_simulation",
      "research_search",
      "tasks_read",
      "tasks_cancel",
    ]);
    const clientB = seedExternalToken(["tasks_read"]);

    const advisor = await sendCapability(clientA.token, advisorRequest());
    const debate = await sendCapability(clientA.token, debateStartRequest());
    const simulation = await sendCapability(clientA.token, simulationStartRequest());
    const research = await sendCapability(clientA.token, researchStartRequest());

    expect([advisor, debate, simulation, research].map((task) => task.capabilityId)).toEqual([
      "chief_advisor_conversation",
      "debate_mode",
      "scenario_simulation",
      "research_search",
    ]);

    const foreign = await getTask(clientB.token, debate.id);
    expect(foreign.status).toBe(404);
  });
});
```

Add these integration tests:

```typescript
it("keeps JSON-RPC and HTTP+JSON task resources equivalent", async () => {
  const rpc = await sendJsonRpc(clientA.token, advisorRequest());
  const http = await sendHttpJson(clientA.token, advisorRequest());
  expect(stripGeneratedFields(rpc.result)).toEqual(stripGeneratedFields(http));
});

it("lists only owned tasks and rejects terminal cancellation", async () => {
  const ownTask = await sendCapability(clientA.token, advisorRequest());
  await sendCapability(clientB.token, researchStartRequest());
  const listed = await listTasks(clientA.token);
  expect(listed.items.map((task) => task.id)).toContain(ownTask.id);
  expect(listed.items.every((task) => task.externalClientId === clientA.id)).toBe(true);
  const canceled = await cancelTask(clientA.token, ownTask.id);
  expect(canceled.status).toBe(409);
});

it("rejects incompatible context reuse", async () => {
  const debate = await sendCapability(clientA.token, debateStartRequest());
  const response = await sendCapabilityResponse(clientA.token, simulationStartRequest({
    contextId: debate.contextId,
  }));
  expect(response.status).toBe(409);
  expect((await response.json()).error.code).toBe("CONTEXT_CAPABILITY_MISMATCH");
});

it("never writes external caller data under a real user", async () => {
  seedRealUser("real-user");
  await sendCapability(clientA.token, simulationStartRequest());
  const db = getDatabase();
  const realSnapshots = db.prepare("SELECT COUNT(*) AS count FROM portfolio_snapshots WHERE user_id='real-user'")
    .get() as { count: number };
  const externalSnapshots = db.prepare(`SELECT COUNT(*) AS count
    FROM portfolio_snapshots p
    JOIN a2a_contexts c ON c.execution_user_id=p.user_id
    WHERE c.external_client_id=?`).get(clientA.id) as { count: number };
  db.close();
  expect(realSnapshots.count).toBe(0);
  expect(externalSnapshots.count).toBeGreaterThan(0);
});
```

- [ ] **Step 4: Update external documentation**

Document:

- Administrator client creation and rotation.
- Token format and one-time display.
- Message metadata contract.
- Example requests for all four capabilities.
- Follow-up operations and task retrieval.
- Early context deletion through the Money Whisperer HTTP extension `DELETE /api/a2a/contexts/{id}`.
- 30-day retention.
- Server-side price resolution.
- Research-only/no-order boundary.

- [ ] **Step 5: Run the complete focused verification**

```bash
pnpm vitest run \
  src/server/db/migration-runner.test.ts \
  src/server/db/schema/a2a.test.ts \
  src/server/a2a \
  src/app/api/a2a \
  src/app/api/v1/admin/a2a-clients \
  src/server/extensions/simulation/candidate-generator.test.ts \
  src/server/extensions/simulation/deterministic-engine.test.ts \
  src/server/extensions/search/service.test.ts \
  tests/integration/a2a-external-gateway.test.ts

pnpm typecheck
pnpm eslint src/server/a2a src/app/api/a2a src/app/api/v1/admin/a2a-clients src/server/db/schema/a2a.ts
pnpm build
```

Expected:

- All focused tests pass.
- Typecheck passes.
- ESLint passes.
- Production build passes.

- [ ] **Step 6: Run a local smoke test**

Start:

```bash
pnpm dev
```

Then:

```bash
curl -s http://localhost:3000/.well-known/agent-card.json
```

Verify the four skills and both interfaces are present.

Create a client through the administrator API, then send one request for each capability and retrieve each task through both JSON-RPC `GetTask` and HTTP `GET /api/a2a/tasks/{id}`.

- [ ] **Step 7: Commit**

```bash
git add src/server/a2a/agent-card.ts src/app/.well-known/agent-card.json/route.test.ts docs/a2a-submission.md src/app/docs/a2a-submission/route.ts tests/integration/a2a-external-gateway.test.ts
git commit -m "feat: publish complete external A2A capabilities"
```

---

## Final Verification Checklist

- [ ] Database migration applies twice without error.
- [ ] Raw external tokens are never persisted or logged.
- [ ] Disabled or rotated tokens cannot authenticate.
- [ ] Capability scopes are enforced.
- [ ] Foreign contexts and tasks return 404.
- [ ] External execution principals cannot log in.
- [ ] External workflows read only caller-supplied context data.
- [ ] Server-side market prices are used for simulations.
- [ ] Debate supports multiple rounds, questioning, side selection, summary, and finalization.
- [ ] Simulation supports create, generate, inspect, execute, switch, undo, and archive.
- [ ] Research supports start, results, retry, refine, and cancel.
- [ ] JSON-RPC aliases and HTTP+JSON endpoints are behaviorally equivalent.
- [ ] An owning client with `tasks_cancel` can delete a context through `DELETE /api/a2a/contexts/{id}` before expiry; foreign clients receive 404.
- [ ] Context cleanup preserves every real user row and real-user-owned resource.
- [ ] Agent Card advertises only executable top-level skills.
- [ ] Focused tests, typecheck, lint, and build pass.
