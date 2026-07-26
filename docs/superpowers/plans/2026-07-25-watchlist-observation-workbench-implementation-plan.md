# 持仓观测工作台完整化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将持仓观测补齐为支持多列表、目标关联、条目聚合、七类结构化规则、真实数据降级、事件提醒和顾问联动的完整工作台。

**Architecture:** 在现有 `watchlists`、`watchlist_items`、`observation_conditions` 和通知表上增量扩展。服务端按列表生命周期、条目生命周期、只读聚合、规则评估、检查编排和 RSS 关联拆分；前端使用 React Query 和小型工作台组件组合，不把所有逻辑继续堆在单个页面文件中。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript、SQLite、better-sqlite3、Drizzle schema、Zod、TanStack Query、Radix UI、Lucide、Vitest、Playwright。

---

## File Map

**Database and contracts**

- Create: `src/server/db/migrations/0016_complete_watchlist_observation.sql`
- Modify: `src/server/db/schema/watchlists.ts`
- Modify: `src/server/db/schema/watchlists.zod.ts`
- Modify: `src/server/db/schema/index.ts`
- Modify: `src/server/db/migration-runner.test.ts`
- Modify: `src/server/db/schema/watchlists.test.ts`

**Server domain**

- Create: `src/server/extensions/watchlists/types.ts`
- Create: `src/server/extensions/watchlists/service.ts`
- Create: `src/server/extensions/watchlists/service.test.ts`
- Create: `src/server/extensions/watchlists/aggregation.ts`
- Create: `src/server/extensions/watchlists/aggregation.test.ts`
- Create: `src/server/extensions/watchlists/check-service.ts`
- Create: `src/server/extensions/watchlists/check-service.test.ts`
- Create: `src/server/extensions/rss/instrument-linker.ts`
- Create: `src/server/extensions/rss/instrument-linker.test.ts`
- Modify: `src/server/extensions/rss/service.ts`
- Modify: `src/server/extensions/notifications/alert-engine.ts`
- Modify: `src/server/extensions/notifications/alert-engine.test.ts`
- Modify: `src/server/extensions/notifications/watchlist-alerts.ts`
- Modify: `src/server/extensions/notifications/proactive-service.ts`
- Modify: `src/server/extensions/notifications/proactive-service.test.ts`
- Modify: `src/server/extensions/notifications/scheduler.ts`
- Modify: `src/server/extensions/errors/codes.ts`

**API routes**

- Modify: `src/app/api/v1/watchlists/route.ts`
- Modify: `src/app/api/v1/watchlists/route.test.ts`
- Modify: `src/app/api/v1/watchlists/[id]/route.ts`
- Modify: `src/app/api/v1/watchlists/[id]/route.test.ts`
- Modify: `src/app/api/v1/watchlists/[id]/items/route.ts`
- Modify: `src/app/api/v1/watchlists/[id]/items/route.test.ts`
- Create: `src/app/api/v1/watchlists/[id]/check/route.ts`
- Create: `src/app/api/v1/watchlists/[id]/check/route.test.ts`
- Modify: `src/app/api/v1/watchlist-items/[id]/route.ts`
- Create: `src/app/api/v1/watchlist-items/[id]/route.test.ts`
- Create: `src/app/api/v1/watchlist-items/[id]/move/route.ts`
- Create: `src/app/api/v1/watchlist-items/[id]/move/route.test.ts`
- Create: `src/app/api/v1/watchlist-items/[id]/check/route.ts`
- Create: `src/app/api/v1/watchlist-items/[id]/check/route.test.ts`
- Modify: `src/app/api/v1/observation-conditions/route.ts`
- Create: `src/app/api/v1/observation-conditions/route.test.ts`
- Modify: `src/app/api/v1/observation-conditions/[id]/route.ts`
- Create: `src/app/api/v1/observation-conditions/[id]/route.test.ts`
- Modify: `src/app/api/v1/observation-conditions/evaluate/route.ts`

**Frontend**

- Rewrite: `src/services/watchlistService.ts`
- Create: `src/services/watchlistService.test.ts`
- Create: `src/services/observationConditionService.ts`
- Create: `src/services/observationConditionService.test.ts`
- Create: `src/hooks/useWatchlists.ts`
- Rewrite: `src/features/workbench/pages/WatchlistPage.tsx`
- Create: `src/features/workbench/components/watchlist/WatchlistToolbar.tsx`
- Create: `src/features/workbench/components/watchlist/WatchlistSummary.tsx`
- Create: `src/features/workbench/components/watchlist/WatchlistCard.tsx`
- Create: `src/features/workbench/components/watchlist/WatchlistEditorDialog.tsx`
- Create: `src/features/workbench/components/watchlist/WatchlistManagerDialog.tsx`
- Create: `src/features/workbench/components/watchlist/ConditionSheet.tsx`
- Create: `src/features/workbench/components/watchlist/watchlist-format.ts`
- Create: `src/features/workbench/components/watchlist/watchlist-format.test.ts`
- Modify: `src/features/workbench/pages/AlertsPage.tsx`
- Modify: `src/workbench.css`
- Create: `tests/e2e/watchlist-observation.spec.ts`

## Task 1: Add Database Migration and Schema Contracts

**Files:**

- Create: `src/server/db/migrations/0016_complete_watchlist_observation.sql`
- Modify: `src/server/db/schema/watchlists.ts`
- Modify: `src/server/db/schema/watchlists.zod.ts`
- Modify: `src/server/db/migration-runner.test.ts`
- Modify: `src/server/db/schema/watchlists.test.ts`

- [ ] **Step 1: Write migration tests that describe the final schema**

Add to `src/server/db/migration-runner.test.ts`:

```ts
it("migrates complete watchlist observation contracts", () => {
  const db = new Database(":memory:");
  prepareDatabase(db as never, ":memory:");

  expect(db.pragma("user_version", { simple: true })).toBe(16);
  expect((db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count).toBe(18);

  const watchlistColumns = db.prepare("PRAGMA table_info(watchlist_items)").all() as Array<{ name: string }>;
  expect(watchlistColumns.map((column) => column.name)).toEqual(expect.arrayContaining(["goal_id", "source_type"]));

  const conditionColumns = db.prepare("PRAGMA table_info(observation_conditions)").all() as Array<{ name: string }>;
  expect(conditionColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
    "watchlist_item_id",
    "severity",
    "threshold_date",
    "window_days",
    "config_json",
    "last_triggered_at",
  ]));

  expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rss_item_instruments'").get()).toBeTruthy();
  db.close();
});
```

Add to `src/server/db/schema/watchlists.test.ts`:

```ts
it("accepts goal and source metadata on watchlist items", () => {
  const result = watchlistItemInsertSchema.safeParse({
    id: "wi_goal",
    watchlistId: "wl_goal",
    instrumentId: "600519.SH",
    goalId: "goal_1",
    sourceType: "user",
    status: "active",
    addedAt: "2026-07-25T00:00:00.000Z",
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
  });
  expect(result.success).toBe(true);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
pnpm vitest run src/server/db/migration-runner.test.ts src/server/db/schema/watchlists.test.ts
```

Expected: FAIL because migration version is `15`, new columns are absent, and Zod does not accept `goalId` or `sourceType`.

- [ ] **Step 3: Add migration `0016_complete_watchlist_observation.sql`**

Use the following statements in this order:

```sql
ALTER TABLE watchlist_items ADD COLUMN goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL;
ALTER TABLE watchlist_items ADD COLUMN source_type TEXT NOT NULL DEFAULT 'user'
  CHECK(source_type IN ('user','agent','import'));

DROP INDEX IF EXISTS idx_watchlists_user_name;
CREATE UNIQUE INDEX idx_watchlists_user_name
  ON watchlists(user_id, name)
  WHERE status != 'deleted';

WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY watchlist_id, instrument_id
      ORDER BY created_at ASC, id ASC
    ) AS position
  FROM watchlist_items
  WHERE status = 'active'
)
UPDATE watchlist_items
SET status = 'removed',
    removed_at = COALESCE(removed_at, updated_at),
    updated_at = updated_at,
    row_version = row_version + 1
WHERE id IN (SELECT id FROM ranked WHERE position > 1);

CREATE UNIQUE INDEX idx_watchlist_items_active_instrument
  ON watchlist_items(watchlist_id, instrument_id)
  WHERE status = 'active';

ALTER TABLE observation_conditions ADD COLUMN watchlist_item_id TEXT REFERENCES watchlist_items(id) ON DELETE SET NULL;
ALTER TABLE observation_conditions ADD COLUMN severity TEXT NOT NULL DEFAULT 'attention';
ALTER TABLE observation_conditions ADD COLUMN threshold_date TEXT;
ALTER TABLE observation_conditions ADD COLUMN window_days INTEGER;
ALTER TABLE observation_conditions ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE observation_conditions ADD COLUMN last_triggered_at TEXT;

CREATE INDEX idx_observation_conditions_watchlist_item
  ON observation_conditions(watchlist_item_id, status, created_at);

CREATE TABLE rss_item_instruments (
  id TEXT PRIMARY KEY,
  rss_item_id TEXT NOT NULL REFERENCES rss_items(id) ON DELETE CASCADE,
  instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  match_basis TEXT NOT NULL
    CHECK(match_basis IN ('symbol_exact','name_exact','research_link')),
  matched_text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_rss_item_instruments_unique
  ON rss_item_instruments(rss_item_id, instrument_id);
CREATE INDEX idx_rss_item_instruments_instrument
  ON rss_item_instruments(instrument_id, created_at);

INSERT OR IGNORE INTO observation_conditions (
  id,user_id,instrument_id,condition_type,threshold_decimal,status,
  watchlist_item_id,severity,window_days,config_json,created_at,updated_at
)
SELECT
  'condition_watchlist_' || wi.id,
  w.user_id,
  wi.instrument_id,
  'DRAWDOWN_REACH',
  CAST(ABS(wi.drawdown_threshold_bps) / 10000.0 AS TEXT),
  'active',
  wi.id,
  'attention',
  20,
  '{}',
  wi.created_at,
  wi.updated_at
FROM watchlist_items wi
JOIN watchlists w ON w.id = wi.watchlist_id
WHERE wi.status = 'active'
  AND w.status = 'active'
  AND wi.drawdown_threshold_bps IS NOT NULL;
```

- [ ] **Step 4: Extend Drizzle and Zod contracts**

In `src/server/db/schema/watchlists.ts`, add:

```ts
goalId: text("goal_id"),
sourceType: text("source_type", { enum: ["user", "agent", "import"] }).notNull().default("user"),
```

Add `rssItemInstruments`:

```ts
export const rssItemInstruments = sqliteTable(
  "rss_item_instruments",
  {
    id: text("id").primaryKey(),
    rssItemId: text("rss_item_id").notNull(),
    instrumentId: text("instrument_id").notNull(),
    matchBasis: text("match_basis", { enum: ["symbol_exact", "name_exact", "research_link"] }).notNull(),
    matchedText: text("matched_text").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_rss_item_instruments_unique").on(table.rssItemId, table.instrumentId),
    index("idx_rss_item_instruments_instrument").on(table.instrumentId, table.createdAt),
  ],
);
```

In `src/server/db/schema/watchlists.zod.ts`, add:

```ts
const WATCHLIST_ITEM_SOURCES = ["user", "agent", "import"] as const;

goalId: optionalText,
sourceType: z.enum(WATCHLIST_ITEM_SOURCES).default("user"),
```

- [ ] **Step 5: Run database tests and verify GREEN**

Run:

```bash
pnpm vitest run src/server/db/migration-runner.test.ts src/server/db/schema/watchlists.test.ts
```

Expected: PASS with migration version `16` and 18 recorded migrations.

- [ ] **Step 6: Commit the database contract**

```bash
git add src/server/db/migrations/0016_complete_watchlist_observation.sql src/server/db/schema/watchlists.ts src/server/db/schema/watchlists.zod.ts src/server/db/migration-runner.test.ts src/server/db/schema/watchlists.test.ts
git commit -m "feat: extend watchlist observation schema"
```

## Task 2: Implement Watchlist and Item Domain Service

**Files:**

- Create: `src/server/extensions/watchlists/types.ts`
- Create: `src/server/extensions/watchlists/service.ts`
- Create: `src/server/extensions/watchlists/service.test.ts`
- Modify: `src/server/extensions/errors/codes.ts`

- [ ] **Step 1: Write failing service tests**

Create `src/server/extensions/watchlists/service.test.ts` with tests for:

```ts
it("persists goal metadata and creates an initial drawdown condition", () => {
  const created = createWatchlistItem("service-user", "wl-service", {
    instrumentId: "AAPL",
    reason: "长期观察",
    plannedHorizon: "3-5 年",
    goalId: "goal-service",
    source: "USER",
    initialDrawdownThresholdPct: 12,
  });

  expect(created.goalId).toBe("goal-service");
  expect(created.activeConditionCount).toBe(1);
});

it("returns WATCHLIST_ITEM_EXISTS for an active duplicate", () => {
  createWatchlistItem("service-user", "wl-service", { instrumentId: "AAPL", source: "USER" });
  expect(() => createWatchlistItem("service-user", "wl-service", { instrumentId: "AAPL", source: "USER" }))
    .toThrowError(expect.objectContaining({ code: "WATCHLIST_ITEM_EXISTS" }));
});

it("moves an item and rejects a target-list duplicate", () => {
  const item = createWatchlistItem("service-user", "wl-source", { instrumentId: "AAPL", source: "USER" });
  createWatchlistItem("service-user", "wl-target", { instrumentId: "AAPL", source: "USER" });
  expect(() => moveWatchlistItem("service-user", item.id, "wl-target", item.version))
    .toThrowError(expect.objectContaining({ code: "WATCHLIST_ITEM_MOVE_CONFLICT" }));
});
```

Use a local test helper in the same file to seed the user, lists, goal, and instrument with `getDatabase()`.

- [ ] **Step 2: Run the service test and verify RED**

Run:

```bash
pnpm vitest run src/server/extensions/watchlists/service.test.ts
```

Expected: FAIL because `service.ts` and exported functions do not exist.

- [ ] **Step 3: Define domain types**

Create `src/server/extensions/watchlists/types.ts`:

```ts
export type WatchlistStatus = "active" | "archived" | "deleted";
export type WatchlistItemSource = "USER" | "AGENT" | "IMPORT";

export type CreateWatchlistItemInput = {
  instrumentId: string;
  reason?: string;
  plannedHorizon?: string;
  goalId?: string | null;
  source: WatchlistItemSource;
  initialDrawdownThresholdPct?: number | null;
};

export type WatchlistSummary = {
  id: string;
  name: string;
  description: string | null;
  status: WatchlistStatus;
  itemCount: number;
  activeConditionCount: number;
  unreadAlertCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type WatchlistPatch = {
  name?: string;
  description?: string | null;
  status?: "ACTIVE" | "ARCHIVED";
};

export type WatchlistItemBase = {
  id: string;
  watchlistId: string;
  instrumentId: string;
  reason: string | null;
  plannedHorizon: string | null;
  goalId: string | null;
  source: WatchlistItemSource;
  activeConditionCount: number;
  version: number;
};

export type WatchlistItemPatch = {
  reason?: string | null;
  plannedHorizon?: string | null;
  goalId?: string | null;
};

export type WatchlistCheckResult = {
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  checkedItemCount: number;
  itemIds: string[];
  evaluatedConditionCount: number;
  createdNotificationCount: number;
  marketRefreshAttempted: boolean;
  marketRefreshSucceeded: boolean;
  dataAsOf: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export class WatchlistDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
```

- [ ] **Step 4: Implement list and item transactions**

Create `src/server/extensions/watchlists/service.ts` with these exports:

```ts
export function createWatchlist(userId: string, input: { name: string; description?: string | null }): WatchlistSummary;
export function listWatchlists(userId: string, status: "active" | "archived", limit: number): WatchlistSummary[];
export function updateWatchlist(userId: string, id: string, input: WatchlistPatch, version: number): WatchlistSummary;
export function deleteWatchlist(userId: string, id: string, version: number): void;
export function createWatchlistItem(userId: string, watchlistId: string, input: CreateWatchlistItemInput): WatchlistItemBase;
export function updateWatchlistItem(userId: string, itemId: string, input: WatchlistItemPatch, version: number): WatchlistItemBase;
export function moveWatchlistItem(userId: string, itemId: string, targetWatchlistId: string, version: number): WatchlistItemBase;
export function removeWatchlistItem(userId: string, itemId: string, version: number): void;
```

Implement duplicate conversion around SQLite constraints:

```ts
function duplicateItemError(
  watchlistId: string,
  instrumentId: string,
  existingItemId: string,
): WatchlistDomainError {
  return new WatchlistDomainError(
    "WATCHLIST_ITEM_EXISTS",
    "该标的已在当前观察列表中",
    409,
    { watchlistId, instrumentId, existingItemId },
  );
}
```

Validate a goal before writing:

```ts
if (input.goalId) {
  const goal = db.prepare(
    "SELECT id FROM goals WHERE id=? AND user_id=? AND status='active'",
  ).get(input.goalId, userId);
  if (!goal) throw new WatchlistDomainError("RESOURCE_NOT_FOUND", "关联目标不存在", 404);
}
```

Create the initial drawdown rule in the same transaction:

```ts
if (input.initialDrawdownThresholdPct != null) {
  db.prepare(`INSERT INTO observation_conditions
    (id,user_id,instrument_id,condition_type,threshold_decimal,status,
     watchlist_item_id,severity,window_days,config_json,created_at,updated_at)
    VALUES (?,?,?,?,?,'active',?,'attention',20,'{}',?,?)`)
    .run(
      createId("condition"),
      userId,
      input.instrumentId,
      "DRAWDOWN_REACH",
      String(input.initialDrawdownThresholdPct / 100),
      itemId,
      now,
      now,
    );
}
```

- [ ] **Step 5: Add error codes**

In `src/server/extensions/errors/codes.ts`, add:

```ts
WATCHLIST_ITEM_EXISTS = "WATCHLIST_ITEM_EXISTS",
WATCHLIST_ITEM_MOVE_CONFLICT = "WATCHLIST_ITEM_MOVE_CONFLICT",
WATCHLIST_ARCHIVED = "WATCHLIST_ARCHIVED",
OBSERVATION_CONDITION_INVALID = "OBSERVATION_CONDITION_INVALID",
OBSERVATION_DATA_INSUFFICIENT = "OBSERVATION_DATA_INSUFFICIENT",
```

- [ ] **Step 6: Run service tests and verify GREEN**

Run:

```bash
pnpm vitest run src/server/extensions/watchlists/service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit domain service**

```bash
git add src/server/extensions/watchlists src/server/extensions/errors/codes.ts
git commit -m "feat: add watchlist domain service"
```

## Task 3: Route List and Item CRUD Through the Domain Service

**Files:**

- Modify watchlist and item route files listed in the File Map.
- Create move route and route tests.

- [ ] **Step 1: Extend route tests before changing routes**

Add tests that:

```ts
it("persists goalId and returns a duplicate conflict with the existing item", async () => {
  const first = await POST(
    authenticatedRequest(collectionUrl, {
      method: "POST",
      body: JSON.stringify({
        instrumentId: "AAPL",
        goalId: "goal-route",
        source: "USER",
        initialDrawdownThresholdPct: 15,
      }),
      headers: { "Idempotency-Key": "item-create-1" },
    }, { userId: "route-user" }),
    context,
  );
  expect(first.status).toBe(201);

  const duplicate = await POST(
    authenticatedRequest(collectionUrl, {
      method: "POST",
      body: JSON.stringify({ instrumentId: "AAPL", source: "USER" }),
      headers: { "Idempotency-Key": "item-create-2" },
    }, { userId: "route-user" }),
    context,
  );
  expect(duplicate.status).toBe(409);
  expect((await duplicate.json()).error.code).toBe("WATCHLIST_ITEM_EXISTS");
});
```

Add tests for:

- `GET /watchlists?status=archived`.
- archive and restore through `PATCH`.
- editing `reason`, free-text `plannedHorizon`, and `goalId`.
- moving an item.
- deleting a list pauses active conditions.

- [ ] **Step 2: Run route tests and verify RED**

Run:

```bash
pnpm vitest run src/app/api/v1/watchlists/route.test.ts src/app/api/v1/watchlists/[id]/route.test.ts src/app/api/v1/watchlists/[id]/items/route.test.ts src/app/api/v1/watchlist-items/[id]/route.test.ts src/app/api/v1/watchlist-items/[id]/move/route.test.ts
```

Expected: FAIL on missing schemas, routes, and conflict behavior.

- [ ] **Step 3: Replace inline SQL with service calls**

Use one route error adapter:

```ts
function domainResponse(error: unknown): NextResponse {
  if (error instanceof WatchlistDomainError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    );
  }
  throw error;
}
```

The create-item schema must be:

```ts
const CreateItemSchema = z.object({
  instrumentId: z.string().trim().min(1),
  reason: z.string().trim().max(500).optional(),
  plannedHorizon: z.string().trim().max(120).optional(),
  goalId: z.string().trim().min(1).nullable().optional(),
  source: z.enum(["USER", "AGENT", "IMPORT"]).default("USER"),
  initialDrawdownThresholdPct: z.number().min(1).max(90).nullable().optional(),
});
```

The patch schema must accept:

```ts
const PatchItemSchema = z.object({
  reason: z.string().trim().max(500).nullable().optional(),
  plannedHorizon: z.string().trim().max(120).nullable().optional(),
  goalId: z.string().trim().min(1).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0);
```

- [ ] **Step 4: Implement move route**

Create `src/app/api/v1/watchlist-items/[id]/move/route.ts`:

```ts
const Schema = z.object({ targetWatchlistId: z.string().trim().min(1) });

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const version = parseVersion(req);
  if (version === null) return invalid("A numeric If-Match header is required");
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid("Invalid move request", parsed.error.format());
  try {
    return NextResponse.json({
      data: moveWatchlistItem(getRequestContext(req).userId, id, parsed.data.targetWatchlistId, version),
      meta: meta(),
    });
  } catch (error) {
    return domainResponse(error);
  }
}
```

- [ ] **Step 5: Run route tests and verify GREEN**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 6: Commit API CRUD**

```bash
git add src/app/api/v1/watchlists src/app/api/v1/watchlist-items
git commit -m "feat: complete watchlist CRUD APIs"
```

## Task 4: Build Real Watchlist Aggregation

**Files:**

- Create: `src/server/extensions/watchlists/aggregation.ts`
- Create: `src/server/extensions/watchlists/aggregation.test.ts`
- Modify: `src/server/extensions/watchlists/service.ts`
- Modify: `src/app/api/v1/watchlists/[id]/items/route.ts`
- Modify: `src/app/api/v1/watchlist-items/[id]/route.ts`

- [ ] **Step 1: Write aggregation tests**

Create fixtures for:

- 20 and 40 daily market points.
- a held AAPL item and an unheld SPY item.
- a goal.
- a recommendation and valuation evidence.
- an RSS link row.
- sector-weighted holdings.
- unread notifications.

Assert:

```ts
expect(held.portfolioRelation).toMatchObject({
  isHeld: true,
  quantity: 2,
  weight: 0.6,
});
expect(unheld.portfolioRelation.isHeld).toBe(false);
expect(held.risk.status).toBe("increasing");
expect(held.valuation.status).toBe("fair");
expect(held.industryConcentration).toMatchObject({
  label: "组合行业集中度",
  level: "critical",
});
expect(held.latestAgentConclusion?.recommendationId).toBe("rec-watchlist");
expect(held.activeConditionCount).toBe(1);
expect(held.unreadAlertCount).toBe(1);
```

Add a separate test that expects every unavailable field to return `status: "insufficient_data"` with `dataAsOf: null`.

- [ ] **Step 2: Run aggregation tests and verify RED**

Run:

```bash
pnpm vitest run src/server/extensions/watchlists/aggregation.test.ts
```

Expected: FAIL because aggregation module does not exist.

- [ ] **Step 3: Define aggregate response types**

In `types.ts`, define:

```ts
export type Availability = "available" | "stale" | "insufficient_data";

export type MarketAggregate = {
  price: number | null;
  previousClose: number | null;
  dailyMovePct: number | null;
  dataAsOf: string | null;
  status: Availability;
};

export type PortfolioRelationAggregate = {
  isHeld: boolean;
  quantity: number | null;
  weight: number | null;
  cost: number | null;
  unrealizedGainPct: number | null;
  dataAsOf: string | null;
};

export type RiskAggregate = {
  status: "increasing" | "decreasing" | "stable" | "insufficient_data";
  recentVolatility: number | null;
  previousVolatility: number | null;
  recentDrawdown: number | null;
  previousDrawdown: number | null;
  dataAsOf: string | null;
};

export type ValuationAggregate = {
  status: "low" | "fair" | "high" | "insufficient_data";
  label: string;
  source: string | null;
  dataAsOf: string | null;
};

export type EventAggregate = {
  id: string;
  title: string;
  source: string;
  canonicalUrl: string | null;
  publishedAt: string | null;
  matchBasis: "symbol_exact" | "name_exact" | "research_link";
};

export type IndustryConcentrationAggregate = {
  label: "组合行业集中度";
  sector: string | null;
  weight: number | null;
  level: "low" | "medium" | "high" | "critical" | "insufficient_data";
  dataAsOf: string | null;
};

export type AgentConclusionAggregate = {
  recommendationId: string;
  action: string;
  summary: string | null;
  status: string;
  createdAt: string;
};

export type WatchlistItemAggregate = {
  id: string;
  watchlistId: string;
  instrument: {
    id: string;
    symbol: string;
    name: string;
    assetType: string;
    sector: string | null;
  };
  reason: string | null;
  plannedHorizon: string | null;
  goal: { id: string; name: string } | null;
  source: WatchlistItemSource;
  version: number;
  market: MarketAggregate;
  portfolioRelation: PortfolioRelationAggregate;
  risk: RiskAggregate;
  valuation: ValuationAggregate;
  recentEvent: EventAggregate | null;
  industryConcentration: IndustryConcentrationAggregate;
  latestAgentConclusion: AgentConclusionAggregate | null;
  activeConditionCount: number;
  triggeredConditionCount: number;
  unreadAlertCount: number;
  lastCheckedAt: string | null;
};
```

- [ ] **Step 4: Implement independent aggregate readers**

Export these pure readers from `aggregation.ts`:

```ts
type Db = ReturnType<typeof getDatabase>;
type InstrumentRow = {
  id: string;
  symbol: string;
  name: string;
  market: string;
  asset_type: string;
  sector: string | null;
};
type MarketPoint = {
  date: string;
  close: number;
  previousClose: number | null;
};

export function readMarketAggregate(db: Db, instrument: InstrumentRow): MarketAggregate;
export function readPortfolioRelation(db: Db, userId: string, instrumentId: string): PortfolioRelationAggregate;
export function computeRiskAggregate(points: MarketPoint[]): RiskAggregate;
export function readValuationAggregate(db: Db, userId: string, instrumentId: string): ValuationAggregate;
export function readRecentEvent(db: Db, instrumentId: string): EventAggregate | null;
export function readIndustryConcentration(db: Db, userId: string, sector: string | null): IndustryConcentrationAggregate;
export function readLatestAgentConclusion(db: Db, userId: string, instrumentId: string): AgentConclusionAggregate | null;
export function aggregateWatchlistItems(userId: string, watchlistId: string, limit: number): WatchlistItemAggregate[];
```

Risk comparison must implement the approved thresholds:

```ts
const volatilityDelta = previousVolatility > 0
  ? currentVolatility / previousVolatility - 1
  : 0;
const drawdownDelta = previousDrawdown > 0
  ? currentDrawdown / previousDrawdown - 1
  : 0;

if (volatilityDelta >= 0.25 || drawdownDelta >= 0.25) return "increasing";
if (
  (volatilityDelta <= -0.2 || drawdownDelta <= -0.2)
  && volatilityDelta < 0.25
  && drawdownDelta < 0.25
) return "decreasing";
return "stable";
```

Valuation may return `low`, `fair`, or `high` only when evidence has an explicit normalized value; otherwise return `insufficient_data`.

- [ ] **Step 5: Route item GET responses through aggregation**

`GET /watchlists/:id/items` returns `{ items, summary }`.
`GET /watchlist-items/:id` returns one `WatchlistItemAggregate`.

- [ ] **Step 6: Run aggregation and route tests**

Run:

```bash
pnpm vitest run src/server/extensions/watchlists/aggregation.test.ts src/app/api/v1/watchlists/[id]/items/route.test.ts src/app/api/v1/watchlist-items/[id]/route.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit aggregation**

```bash
git add src/server/extensions/watchlists/aggregation.ts src/server/extensions/watchlists/aggregation.test.ts src/server/extensions/watchlists/types.ts src/server/extensions/watchlists/service.ts src/app/api/v1/watchlists/[id]/items src/app/api/v1/watchlist-items/[id]
git commit -m "feat: add watchlist insight aggregation"
```

## Task 5: Complete Structured Observation Conditions

**Files:**

- Modify condition API and notification engine files from the File Map.
- Add route tests.

- [ ] **Step 1: Write failing rule-engine tests**

Add one focused test per rule:

```ts
it.each([
  ["PRICE_ABOVE", "149", "151", "150"],
  ["PRICE_BELOW", "151", "149", "150"],
  ["DRAWDOWN_REACH", "0.09", "0.12", "0.10"],
  ["POSITION_WEIGHT_ABOVE", "0.29", "0.31", "0.30"],
  ["UNREALIZED_GAIN_REACH", "0.14", "0.16", "0.15"],
])("%s triggers only when crossing the threshold", (type, previous, current, threshold) => {
  expect(hasConditionCrossed(type as ObservationConditionType, previous, current, threshold)).toBe(true);
  expect(hasConditionCrossed(type as ObservationConditionType, current, current, threshold)).toBe(false);
});

it("DAILY_MOVE_REACH can trigger once per trading date", () => {
  expect(dailyMoveEvaluationKey("condition_1", "20260725")).toBe("condition_1:DAILY_MOVE_REACH:20260725");
});

it("REVIEW_DATE ignores threshold_decimal and deduplicates by date", () => {
  expect(reviewDateEvaluationKey("condition_1", "2026-07-25")).toBe("condition_1:REVIEW_DATE:2026-07-25");
});
```

Add API tests for create, filter by `watchlistItemId`, patch severity/status/threshold, and soft delete.

- [ ] **Step 2: Run condition tests and verify RED**

Run:

```bash
pnpm vitest run src/server/extensions/notifications/alert-engine.test.ts src/app/api/v1/observation-conditions/route.test.ts src/app/api/v1/observation-conditions/[id]/route.test.ts
```

Expected: FAIL on missing condition types and fields.

- [ ] **Step 3: Add normalized condition schema**

Use:

```ts
const ConditionType = z.enum([
  "PRICE_ABOVE",
  "PRICE_BELOW",
  "DRAWDOWN_REACH",
  "DAILY_MOVE_REACH",
  "POSITION_WEIGHT_ABOVE",
  "UNREALIZED_GAIN_REACH",
  "REVIEW_DATE",
]);

const CreateConditionSchema = z.object({
  watchlistItemId: z.string().trim().min(1),
  conditionType: ConditionType,
  threshold: z.string().trim().optional(),
  thresholdDate: z.string().date().optional(),
  windowDays: z.number().int().min(5).max(120).optional(),
  severity: z.enum(["INFORMATION", "ATTENTION", "IMPORTANT", "URGENT"]).default("ATTENTION"),
}).superRefine(validateConditionInput);
```

Implement `validateConditionInput`:

```ts
function validateConditionInput(
  value: {
    conditionType: z.infer<typeof ConditionType>;
    threshold?: string;
    thresholdDate?: string;
    windowDays?: number;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.conditionType === "REVIEW_DATE") {
    if (!value.thresholdDate) {
      ctx.addIssue({ code: "custom", path: ["thresholdDate"], message: "复查日期不能为空" });
    }
    if (value.threshold !== undefined || value.windowDays !== undefined) {
      ctx.addIssue({ code: "custom", path: ["conditionType"], message: "复查日期规则不接受数值阈值或窗口" });
    }
    return;
  }

  const threshold = Number(value.threshold);
  if (!Number.isFinite(threshold)) {
    ctx.addIssue({ code: "custom", path: ["threshold"], message: "请输入有效阈值" });
    return;
  }

  const ratioTypes = new Set([
    "DRAWDOWN_REACH",
    "DAILY_MOVE_REACH",
    "POSITION_WEIGHT_ABOVE",
    "UNREALIZED_GAIN_REACH",
  ]);
  if (ratioTypes.has(value.conditionType) && (threshold <= 0 || threshold > 1)) {
    ctx.addIssue({ code: "custom", path: ["threshold"], message: "比例阈值必须大于 0 且不超过 1" });
  }
  if ((value.conditionType === "PRICE_ABOVE" || value.conditionType === "PRICE_BELOW") && threshold <= 0) {
    ctx.addIssue({ code: "custom", path: ["threshold"], message: "价格阈值必须大于 0" });
  }
  if (value.conditionType === "DRAWDOWN_REACH") {
    if (value.windowDays !== undefined && (value.windowDays < 5 || value.windowDays > 120)) {
      ctx.addIssue({ code: "custom", path: ["windowDays"], message: "回撤窗口必须在 5 到 120 日之间" });
    }
  } else if (value.windowDays !== undefined) {
    ctx.addIssue({ code: "custom", path: ["windowDays"], message: "当前规则不接受窗口参数" });
  }
}
```

- [ ] **Step 4: Implement evaluators**

Refactor the engine around:

```ts
type ObservedMetric = {
  value: Decimal | null;
  dataAsOf: string | null;
  metricSnapshot: Record<string, unknown>;
};

function readObservedMetric(db: Db, condition: ConditionRow): ObservedMetric;
function evaluateCondition(condition: ConditionRow, observed: ObservedMetric): ConditionEvaluation;
```

For `REVIEW_DATE`, store `threshold_decimal = "0"` and compare `threshold_date` against the current Shanghai calendar date.

For insufficient data return:

```ts
{
  conditionId: String(condition.id),
  status: "insufficient_data",
  triggered: false,
  observedValue: null,
  dataAsOf: observed.dataAsOf,
}
```

- [ ] **Step 5: Run condition tests and verify GREEN**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 6: Commit structured conditions**

```bash
git add src/server/extensions/notifications/alert-engine.ts src/server/extensions/notifications/alert-engine.test.ts src/app/api/v1/observation-conditions
git commit -m "feat: complete structured observation rules"
```

## Task 6: Add List and Item Check Orchestration

**Files:**

- Create check-service and route files.
- Modify proactive service and scheduler.

- [ ] **Step 1: Write failing check-service tests**

Cover:

```ts
it("checks one item without evaluating another list", async () => {
  const result = await checkWatchlistItem("check-user", "item-a", { forceMarketRefresh: false });
  expect(result.checkedItemCount).toBe(1);
  expect(result.itemIds).toEqual(["item-a"]);
});

it("checks an active list and returns partial status when market refresh is unavailable", async () => {
  const result = await checkWatchlist("check-user", "list-a", { forceMarketRefresh: true });
  expect(result.status).toBe("PARTIAL");
  expect(result.errorCode).toBe("PANDADATA_NOT_CONFIGURED");
});
```

Add route tests that require `Idempotency-Key`, enforce ownership, and return saved idempotent responses.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm vitest run src/server/extensions/watchlists/check-service.test.ts src/app/api/v1/watchlists/[id]/check/route.test.ts src/app/api/v1/watchlist-items/[id]/check/route.test.ts
```

Expected: FAIL because modules and routes are missing.

- [ ] **Step 3: Implement check service**

Expose:

```ts
export async function checkWatchlist(
  userId: string,
  watchlistId: string,
  options: { forceMarketRefresh: boolean },
): Promise<WatchlistCheckResult>;

export async function checkWatchlistItem(
  userId: string,
  itemId: string,
  options: { forceMarketRefresh: boolean },
): Promise<WatchlistCheckResult>;
```

Both functions:

1. Validate active ownership.
2. Load only scoped targets.
3. Refresh scoped market symbols when due.
4. Evaluate scoped conditions.
5. Create default move/drawdown and RSS event notifications.
6. Return uppercase public status and public error text.

- [ ] **Step 4: Add check routes**

Both routes use:

```ts
const Schema = z.object({ forceMarketRefresh: z.boolean().default(true) });
```

and the existing idempotency middleware with route codes:

```ts
`watchlist_check:${id}`
`watchlist_item_check:${id}`
```

- [ ] **Step 5: Refactor scheduler and user-wide sync**

Keep `/api/v1/notifications/sync` backward compatible. Make `syncUserNotifications` delegate to the same scoped check primitives for all active holdings and watchlists.

- [ ] **Step 6: Run check and proactive tests**

Run:

```bash
pnpm vitest run src/server/extensions/watchlists/check-service.test.ts src/server/extensions/notifications/proactive-service.test.ts src/app/api/v1/watchlists/[id]/check/route.test.ts src/app/api/v1/watchlist-items/[id]/check/route.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit check orchestration**

```bash
git add src/server/extensions/watchlists/check-service.ts src/server/extensions/watchlists/check-service.test.ts src/server/extensions/notifications/proactive-service.ts src/server/extensions/notifications/proactive-service.test.ts src/server/extensions/notifications/scheduler.ts src/app/api/v1/watchlists/[id]/check src/app/api/v1/watchlist-items/[id]/check
git commit -m "feat: add scoped watchlist checks"
```

## Task 7: Link RSS Events and Create Event Notifications

**Files:**

- Create: `src/server/extensions/rss/instrument-linker.ts`
- Create: `src/server/extensions/rss/instrument-linker.test.ts`
- Modify: `src/server/extensions/rss/service.ts`
- Modify: `src/server/extensions/notifications/watchlist-alerts.ts`
- Modify: `src/server/extensions/watchlists/aggregation.ts`

- [ ] **Step 1: Write failing deterministic-link tests**

Test:

```ts
it("links an exact symbol with token boundaries", () => {
  expect(findInstrumentMatches(
    { title: "600519 发布年度报告", summary: null },
    [{ id: "600519.SH", symbol: "600519", name: "贵州茅台" }],
  )).toEqual([
    { instrumentId: "600519.SH", matchBasis: "symbol_exact", matchedText: "600519" },
  ]);
});

it("links an exact full name and rejects a partial name", () => {
  expect(findInstrumentMatches(
    { title: "贵州茅台发布公告", summary: null },
    [{ id: "600519.SH", symbol: "600519", name: "贵州茅台" }],
  )).toHaveLength(1);
  expect(findInstrumentMatches(
    { title: "茅台发布公告", summary: null },
    [{ id: "600519.SH", symbol: "600519", name: "贵州茅台" }],
  )).toHaveLength(0);
});
```

Add a notification test asserting one `WATCHLIST_EVENT` per user, item, and RSS item.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm vitest run src/server/extensions/rss/instrument-linker.test.ts src/server/extensions/notifications/proactive-service.test.ts
```

Expected: FAIL because linker and event notifications are absent.

- [ ] **Step 3: Implement exact matcher**

Use escaped token matching:

```ts
function exactTokenPattern(value: string): RegExp {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, "iu");
}
```

Export:

```ts
export function findInstrumentMatches(
  item: { title: string; summary: string | null },
  instruments: Array<{ id: string; symbol: string; name: string }>,
): InstrumentMatch[];

export function linkRecentRssItems(db: Db, instrumentIds: string[], publishedAfter: string): number;
```

- [ ] **Step 4: Call the linker after RSS sync**

After `finishSync` commits RSS rows, call the linker for instruments referenced by active holdings or active watchlist items. Link failures must not roll back RSS publication; record a public `rss.linked` SSE event with the linked count.

- [ ] **Step 5: Add event notifications and aggregation**

Create notifications with:

```ts
{
  sourceType: "WATCHLIST_EVENT",
  dedupeKey: `${userId}:watchlist-event:${target.id}:${rssItem.id}`,
  severity: "information",
  dataAsOf: rssItem.published_at ?? rssItem.created_at,
}
```

Add source label `"WATCHLIST_EVENT": "关联事件"` in `AlertsPage.tsx`.

- [ ] **Step 6: Run RSS and notification tests**

Run:

```bash
pnpm vitest run src/server/extensions/rss/instrument-linker.test.ts src/server/extensions/notifications/proactive-service.test.ts src/server/extensions/watchlists/aggregation.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit RSS linkage**

```bash
git add src/server/extensions/rss src/server/extensions/notifications/watchlist-alerts.ts src/server/extensions/watchlists/aggregation.ts src/server/extensions/watchlists/aggregation.test.ts src/features/workbench/pages/AlertsPage.tsx
git commit -m "feat: add watchlist event monitoring"
```

## Task 8: Build Typed Frontend Services and Hooks

**Files:**

- Rewrite: `src/services/watchlistService.ts`
- Create: `src/services/watchlistService.test.ts`
- Create: `src/services/observationConditionService.ts`
- Create: `src/services/observationConditionService.test.ts`
- Create: `src/hooks/useWatchlists.ts`

- [ ] **Step 1: Write failing mapping and mutation tests**

Mock only `apiGet`, `apiPost`, `apiPatch`, and `apiDelete`. Assert:

```ts
it("sends goalId and initial drawdown threshold", async () => {
  await createWatchlistItem("wl_1", {
    instrumentId: "600519.SH",
    reason: "长期观察",
    plannedHorizon: "3-5 年",
    goalId: "goal_1",
    initialDrawdownThresholdPct: 12,
  });
  expect(apiPost).toHaveBeenCalledWith("/api/v1/watchlists/wl_1/items", expect.objectContaining({
    goalId: "goal_1",
    initialDrawdownThresholdPct: 12,
  }));
});

it("preserves insufficient-data states from the aggregate API", async () => {
  vi.mocked(apiGet).mockResolvedValue({
    items: [{
      id: "item_1",
      valuation: { status: "insufficient_data", label: "暂无估值证据", dataAsOf: null },
    }],
    summary: {},
  });
  const result = await listWatchlistItems("wl_1");
  expect(result.items[0].valuation.status).toBe("insufficient_data");
});
```

- [ ] **Step 2: Run frontend service tests and verify RED**

Run:

```bash
pnpm vitest run src/services/watchlistService.test.ts src/services/observationConditionService.test.ts
```

Expected: FAIL because APIs and types are missing.

- [ ] **Step 3: Implement typed service API**

`watchlistService.ts` exports:

```ts
export type WatchlistCreateInput = {
  name: string;
  description?: string | null;
};

export type WatchlistItemCreateInput = {
  instrumentId: string;
  reason?: string;
  plannedHorizon?: string;
  goalId?: string | null;
  initialDrawdownThresholdPct?: number | null;
};

export type WatchlistItemsResponse = {
  items: WatchlistItem[];
  summary: {
    itemCount: number;
    heldCount: number;
    activeConditionCount: number;
    unreadAlertCount: number;
    insufficientDataCount: number;
    lastCheckedAt: string | null;
  };
};

export async function listWatchlists(status?: "active" | "archived"): Promise<WatchlistSummary[]>;
export async function createWatchlist(input: WatchlistCreateInput): Promise<WatchlistSummary>;
export async function updateWatchlist(item: WatchlistSummary, patch: WatchlistPatch): Promise<WatchlistSummary>;
export async function deleteWatchlist(item: WatchlistSummary): Promise<void>;
export async function listWatchlistItems(watchlistId: string): Promise<WatchlistItemsResponse>;
export async function createWatchlistItem(watchlistId: string, input: WatchlistItemCreateInput): Promise<WatchlistItem>;
export async function updateWatchlistItem(item: WatchlistItem, patch: WatchlistItemPatch): Promise<WatchlistItem>;
export async function moveWatchlistItem(item: WatchlistItem, targetWatchlistId: string): Promise<WatchlistItem>;
export async function removeWatchlistItem(item: WatchlistItem): Promise<void>;
export async function checkWatchlist(watchlistId: string): Promise<WatchlistCheckResult>;
export async function checkWatchlistItem(itemId: string): Promise<WatchlistCheckResult>;
```

`observationConditionService.ts` exports complete condition CRUD and evaluate functions.

- [ ] **Step 4: Add React Query hooks**

Create hooks with stable keys:

```ts
export const watchlistKeys = {
  lists: (userId: string | undefined, status: string) => ["watchlists", userId, status] as const,
  items: (userId: string | undefined, watchlistId: string | null) => ["watchlist-items", userId, watchlistId] as const,
  conditions: (userId: string | undefined, itemId: string | null) => ["observation-conditions", userId, itemId] as const,
};
```

- [ ] **Step 5: Run service tests and verify GREEN**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 6: Commit frontend data layer**

```bash
git add src/services/watchlistService.ts src/services/watchlistService.test.ts src/services/observationConditionService.ts src/services/observationConditionService.test.ts src/hooks/useWatchlists.ts
git commit -m "feat: add watchlist frontend data layer"
```

## Task 9: Implement the Watchlist Workbench UI

**Files:**

- Create E2E test first.
- Rewrite page and create watchlist components.
- Modify CSS.

- [ ] **Step 1: Write the failing desktop E2E flow**

Create `tests/e2e/watchlist-observation.spec.ts` with one desktop test that:

1. Registers and completes onboarding.
2. Opens `/watchlist`.
3. Creates a second list.
4. Adds `600519` with a goal and initial drawdown threshold.
5. Verifies one card, held/unheld label, goal, and threshold.
6. Attempts duplicate add and sees the existing-item conflict.
7. Edits reason and goal.
8. Creates a price-below rule.
9. Pauses and resumes the rule.
10. Runs single-item check.
11. Moves the item to the second list.
12. Opens “问顾问” and verifies the prompt query.

Use role-based selectors:

```ts
await page.getByRole("button", { name: "添加标的" }).click();
await page.getByPlaceholder("输入代码或名称，例如 600519 / 贵州茅台").fill("600519");
await page.getByRole("button", { name: /贵州茅台/u }).click();
await page.getByRole("button", { name: "保存观察对象" }).click();
await expect(page.getByRole("article", { name: /贵州茅台/u })).toBeVisible();
```

- [ ] **Step 2: Run the E2E test and verify RED**

Run:

```bash
pnpm exec playwright test tests/e2e/watchlist-observation.spec.ts --project=desktop-chromium
```

Expected: FAIL because the new controls and flows do not exist.

- [ ] **Step 3: Add pure formatting tests**

Create `watchlist-format.test.ts`:

```ts
expect(formatAvailability("insufficient_data")).toBe("数据不足");
expect(formatPercentRatio(0.1234)).toBe("12.34%");
expect(conditionSummary({
  conditionType: "DRAWDOWN_REACH",
  threshold: "0.12",
  windowDays: 20,
})).toBe("近 20 日回撤达到 12%");
```

Run the test and confirm it fails before creating `watchlist-format.ts`.

- [ ] **Step 4: Build the page shell**

Rewrite `WatchlistPage.tsx` to:

- read and write `?list=<id>`.
- select the default “持仓观测” list only when URL has no valid list.
- render toolbar, summary, state panels, and item grid.
- open controlled dialogs and Sheet components.
- invalidate only list, item, condition, and alert keys affected by a mutation.

- [ ] **Step 5: Implement focused components**

Component contracts:

```ts
export function WatchlistToolbar(props: {
  lists: WatchlistSummary[];
  activeListId: string | null;
  checking: boolean;
  onSelectList: (id: string) => void;
  onManageLists: () => void;
  onCheck: () => void;
  onAdd: () => void;
}): ReactNode;

export function WatchlistCard(props: {
  item: WatchlistItem;
  onAskAdvisor: () => void;
  onCheck: () => void;
  onEdit: () => void;
  onManageConditions: () => void;
  onMove: () => void;
  onRemove: () => void;
}): ReactNode;

export function WatchlistSummary(props: {
  itemCount: number;
  heldCount: number;
  activeConditionCount: number;
  unreadAlertCount: number;
  insufficientDataCount: number;
  lastCheckedAt: string | null;
}): ReactNode;
```

Every icon-only action must include both `aria-label` and a Tooltip.

- [ ] **Step 6: Implement dialogs and rule Sheet**

`WatchlistEditorDialog` handles create and edit modes. It must send `goalId` and only show initial drawdown threshold in create mode.

`WatchlistManagerDialog` handles create, rename, archive, restore, and delete.

`ConditionSheet` renders:

- rule type Select.
- numeric or date input based on rule type.
- window input only for drawdown.
- severity Select.
- active/paused Switch.
- edit and delete actions.

- [ ] **Step 7: Add responsive CSS**

Add classes to `src/workbench.css` for:

- `.watchlist-toolbar`
- `.watchlist-summary`
- `.watchlist-grid`
- `.watchlist-card`
- `.watchlist-card-actions`
- `.watchlist-data-grid`
- `.condition-list`

Use stable grid tracks and ensure the action row does not move when optional aggregates load.

- [ ] **Step 8: Run formatting tests and E2E**

Run:

```bash
pnpm vitest run src/features/workbench/components/watchlist/watchlist-format.test.ts
pnpm exec playwright test tests/e2e/watchlist-observation.spec.ts --project=desktop-chromium
```

Expected: PASS.

- [ ] **Step 9: Commit the workbench UI**

```bash
git add src/features/workbench/pages/WatchlistPage.tsx src/features/workbench/components/watchlist src/workbench.css tests/e2e/watchlist-observation.spec.ts
git commit -m "feat: build complete watchlist workbench"
```

## Task 10: Complete Alerts Integration and Mobile Verification

**Files:**

- Modify: `src/features/workbench/pages/AlertsPage.tsx`
- Modify: `tests/e2e/watchlist-observation.spec.ts`

- [ ] **Step 1: Extend E2E with alert-center behavior**

Add assertions for:

- `WATCHLIST_MOVE`, `WATCHLIST_DRAWDOWN`, `WATCHLIST_EVENT`, and `WATCH_CONDITION` labels.
- “问顾问” prompt includes reason, goal, rule, metric, and `dataAsOf`.
- mark read and ignore.

- [ ] **Step 2: Add mobile flow before UI fixes**

Add a mobile test using the existing mobile project that:

- switches lists.
- opens full-width editor.
- opens condition Sheet.
- verifies no horizontal scroll.

Run:

```bash
pnpm exec playwright test tests/e2e/watchlist-observation.spec.ts --project=mobile-chromium
```

Expected: FAIL until mobile sizing and action wrapping are complete.

- [ ] **Step 3: Add alert source metadata**

Extend `sourceLabels`:

```ts
WATCHLIST_EVENT: "关联事件",
```

Keep `askAdvisor` behavior, but ensure notification metadata generated by the server includes:

```ts
{
  watchlistId,
  watchlistItemId,
  conditionId,
  goalId,
  reason,
  rule,
  metricValue,
  threshold,
  dataAsOf,
  advisorPrompt,
}
```

- [ ] **Step 4: Fix mobile layout and run both projects**

Run:

```bash
pnpm exec playwright test tests/e2e/watchlist-observation.spec.ts --project=desktop-chromium --project=mobile-chromium
```

Expected: PASS.

- [ ] **Step 5: Capture screenshots**

Save Playwright screenshots under:

```text
artifacts/watchlist-observation-desktop.png
artifacts/watchlist-observation-mobile.png
```

Inspect both for:

- blank or clipped regions.
- text overflow.
- toolbar collisions.
- hidden action buttons.
- nested cards.

- [ ] **Step 6: Commit alert and mobile completion**

```bash
git add src/features/workbench/pages/AlertsPage.tsx tests/e2e/watchlist-observation.spec.ts src/workbench.css artifacts/watchlist-observation-desktop.png artifacts/watchlist-observation-mobile.png
git commit -m "test: verify watchlist alerts and mobile flow"
```

## Task 11: Full Regression and Release Verification

**Files:**

- Modify only files required to fix failures caused by Tasks 1-10.

- [ ] **Step 1: Run focused watchlist and notification tests**

```bash
pnpm vitest run \
  src/server/db/migration-runner.test.ts \
  src/server/db/schema/watchlists.test.ts \
  src/server/extensions/watchlists \
  src/server/extensions/rss/instrument-linker.test.ts \
  src/server/extensions/notifications/alert-engine.test.ts \
  src/server/extensions/notifications/proactive-service.test.ts \
  src/app/api/v1/watchlists \
  src/app/api/v1/watchlist-items \
  src/app/api/v1/observation-conditions \
  src/services/watchlistService.test.ts \
  src/services/observationConditionService.test.ts \
  src/features/workbench/components/watchlist/watchlist-format.test.ts
```

Expected: all focused tests pass with zero failures.

- [ ] **Step 2: Run lint and type checking**

```bash
pnpm lint
pnpm typecheck
```

Expected: both commands exit `0`.

- [ ] **Step 3: Run the full unit suite**

```bash
pnpm test
```

Expected: all Vitest files pass.

- [ ] **Step 4: Run complete E2E**

```bash
pnpm test:e2e
```

Expected: all desktop and mobile Playwright projects pass.

- [ ] **Step 5: Run production build**

```bash
pnpm build
```

Expected: production build exits `0` and includes `/watchlist`, list/item check routes, move route, and condition routes.

- [ ] **Step 6: Review migration against a copied legacy database**

Run the app against a copied pre-0016 database and verify:

```sql
SELECT COUNT(*) FROM watchlist_items WHERE status='active';
SELECT COUNT(*) FROM observation_conditions
WHERE watchlist_item_id IS NOT NULL AND condition_type='DRAWDOWN_REACH';
SELECT COUNT(*) FROM (
  SELECT watchlist_id,instrument_id,COUNT(*) AS count
  FROM watchlist_items
  WHERE status='active'
  GROUP BY watchlist_id,instrument_id
  HAVING count > 1
);
```

Expected:

- existing active entries remain visible.
- every legacy drawdown threshold has one condition.
- duplicate query returns zero rows.

- [ ] **Step 7: Review the final diff**

```bash
git diff --check
git status --short
git log --oneline --max-count=12
```

Confirm no unrelated evidence-lab, recommendation, advisor, or generated build files were staged by this implementation.

- [ ] **Step 8: Final commit if verification fixes were required**

```bash
git add \
  src/server/db/migrations/0016_complete_watchlist_observation.sql \
  src/server/db/schema/watchlists.ts \
  src/server/db/schema/watchlists.zod.ts \
  src/server/extensions/watchlists \
  src/server/extensions/rss/instrument-linker.ts \
  src/server/extensions/notifications/alert-engine.ts \
  src/server/extensions/notifications/watchlist-alerts.ts \
  src/server/extensions/notifications/proactive-service.ts \
  src/server/extensions/notifications/scheduler.ts \
  src/app/api/v1/watchlists \
  src/app/api/v1/watchlist-items \
  src/app/api/v1/observation-conditions \
  src/services/watchlistService.ts \
  src/services/observationConditionService.ts \
  src/hooks/useWatchlists.ts \
  src/features/workbench/pages/WatchlistPage.tsx \
  src/features/workbench/pages/AlertsPage.tsx \
  src/features/workbench/components/watchlist \
  src/workbench.css \
  tests/e2e/watchlist-observation.spec.ts
git commit -m "fix: close watchlist observation regressions"
```

Skip this commit when verification required no code changes.
