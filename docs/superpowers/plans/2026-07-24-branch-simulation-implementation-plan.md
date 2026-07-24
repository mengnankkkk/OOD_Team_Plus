# Agent Branch Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a C-facing A/B/C branch simulation experience where the Agent proposes scenario plans, a deterministic engine validates and calculates simulated assets, and users can execute, switch, and undo branches without changing real holdings.

**Architecture:** Keep the existing SQLite simulation workspace/branch/snapshot model. Add a dedicated structured Branch Scenario Agent boundary that produces validated candidate intents, keep price/quantity/cash/fee/asset-conservation calculations in the deterministic engine, and use persisted `agent_runs` plus SSE for asynchronous option generation. The frontend will use the existing workbench styling and API helpers, with a decision-flow default and a detailed branch-lab view.

**Tech Stack:** Next.js App Router, React, TypeScript, Mastra Agent, SQLite/better-sqlite3, Zod, Decimal.js, Vitest, Playwright, pnpm.

---

## Current File Map

- `src/server/extensions/simulation/candidate-generator.ts`: current deterministic A/B/C candidate creation and frozen price manifest.
- `src/server/extensions/simulation/deterministic-engine.ts`: current decimal-safe simulation executor.
- `src/server/extensions/simulation/service.ts`: workspace, option, branch, switch, undo, and snapshot persistence.
- `src/mastra/agents/chief-advisor.ts`: current Chief Advisor and specialist delegation.
- `src/server/extensions/advisor/professional.ts`: current professional advisor orchestration, data retrieval, publication gate, and deterministic fallback.
- `src/app/api/v1/simulation-workspaces/**`: current simulation REST endpoints.
- `src/app/(workbench)/simulations/page.tsx`: current simulation page with workspace, branch tree, options, execute, switch, and undo actions.
- `src/server/db/schema/simulation-branches.ts`: Drizzle schema for simulation workspaces, branches, options, snapshots, and events.
- `src/server/db/migrations/0003_add_simulation_branches.sql`: original branch simulation migration.
- `tests/server/extensions/simulation/deterministic-engine.test.ts` and `src/app/api/v1/simulation-workspaces/route.test.ts`: existing simulation coverage.
- `tests/e2e/business-flow.spec.ts`: existing browser flow coverage.

## Task 1: Restore the Current Dependency Baseline

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Test: `src/server/extensions/simulation/deterministic-engine.test.ts`
- Test: `src/app/api/v1/simulation-workspaces/route.test.ts`

- [ ] **Step 1: Confirm the dependency failure**

Run:

```bash
pnpm test -- src/server/extensions/simulation/deterministic-engine.test.ts
```

Expected before installation: import failures for packages such as `decimal.js`, `better-sqlite3`, or `drizzle-orm`.

- [ ] **Step 2: Install the committed dependency graph**

Run:

```bash
pnpm install --frozen-lockfile
```

Expected: `node_modules` is restored from `pnpm-lock.yaml` without changing the lockfile.

- [ ] **Step 3: Run the focused simulation tests**

Run:

```bash
pnpm test -- src/server/extensions/simulation/deterministic-engine.test.ts src/app/api/v1/simulation-workspaces/route.test.ts
```

Expected: the existing deterministic engine and route suites execute instead of failing at module resolution. Record any behavioral failures as the baseline for later tasks.

- [ ] **Step 4: Commit the environment-only change if lockfiles changed**

Run:

```bash
git status --short
git diff --check
```

Commit only if `package.json` or `pnpm-lock.yaml` changed:

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: restore branch simulation dependencies"
```

## Task 2: Add Branch Scenario Contracts and Agent Boundary

**Files:**
- Create: `src/server/extensions/simulation/scenario-contracts.ts`
- Create: `src/server/extensions/simulation/scenario-agent.ts`
- Modify: `src/mastra/agents/chief-advisor.ts`
- Modify: `src/server/extensions/advisor/professional-contracts.ts` only if shared role types need extension
- Test: `src/server/extensions/simulation/scenario-agent.test.ts`

- [ ] **Step 1: Add failing schema tests**

Create tests covering:

```ts
expect(BranchScenarioPlanSchema.parse({
  provider: "CHIEF_ADVISOR",
  options: [{
    label: "B · 风险预算再平衡",
    description: "降低集中度",
    strategy: "BALANCED",
    trades: [{ instrumentId: "instrument_a", action: "SELL", quantity: "10" }],
    targetAllocations: [],
    rationale: ["集中度过高"],
    counterEvidence: ["上涨时可能落后"],
    risks: ["仍存在市场风险"],
    assumptions: ["使用冻结价格"],
    invalidationConditions: ["画像发生变化"]
  }]
})).toMatchObject({ options: [{ strategy: "BALANCED" }] });
```

Reject:

- zero or more than five options;
- empty rationale/counter evidence/risks;
- non-positive or malformed quantity;
- unknown action;
- trade fields that contain price values supplied by the model;
- duplicate instrument IDs in an option's same-direction trade set.

- [ ] **Step 2: Implement the schemas**

Define `BranchScenarioTradeSchema`, `BranchScenarioOptionSchema`, `BranchScenarioPlanSchema`, and `BranchScenarioContextSchema` with Zod. The model output schema must not expose `price`; the server attaches frozen prices later.

- [ ] **Step 3: Add the Branch Scenario Agent adapter**

Implement `runBranchScenarioAgent(input)` with:

```ts
type BranchScenarioAgentInput = {
  objective: string;
  profile: Record<string, unknown> | null;
  snapshot: Record<string, unknown>;
  holdings: Array<Record<string, unknown>>;
  instruments: Array<Record<string, unknown>>;
  research: Array<Record<string, unknown>>;
  riskConstraints: Record<string, unknown>;
  onAgentStarted?: (role: string, label: string) => void;
  onAgentCompleted?: (role: string, summary: string) => void;
};

type BranchScenarioAgentResult = {
  provider: "CHIEF_ADVISOR" | "DETERMINISTIC_FALLBACK";
  plan: BranchScenarioPlan;
  delegatedAgents: string[];
};
```

When `DEEPSEEK_API_KEY` is configured, delegate profile, research, risk, scenario, and compliance roles through the Chief Advisor. If the model output is invalid or unavailable, return a deterministic fallback marker rather than pretending it was model-generated.

- [ ] **Step 4: Run the contract tests**

Run:

```bash
pnpm test -- src/server/extensions/simulation/scenario-agent.test.ts
```

Expected: all schema and fallback tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/extensions/simulation/scenario-contracts.ts src/server/extensions/simulation/scenario-agent.ts src/mastra/agents/chief-advisor.ts src/server/extensions/advisor/professional-contracts.ts src/server/extensions/simulation/scenario-agent.test.ts
git commit -m "feat: add branch scenario agent contracts"
```

## Task 3: Make Candidate Generation Agent-First and Deterministically Executable

**Files:**
- Modify: `src/server/extensions/simulation/candidate-generator.ts`
- Modify: `src/server/extensions/simulation/service.ts`
- Modify: `src/server/extensions/simulation/deterministic-engine.ts`
- Test: `src/server/extensions/simulation/candidate-generator.test.ts`
- Test: `src/server/extensions/simulation/deterministic-engine.test.ts`

- [ ] **Step 1: Add failing candidate-generation tests**

Cover:

- an Agent plan is converted into candidates with server-owned prices;
- model-provided unknown instruments are rejected;
- a no-trade observation option remains valid;
- no candidate is marked `ACTIVE` merely because the model returned JSON;
- the fallback provider is visible in the returned batch metadata.

- [ ] **Step 2: Split proposal from execution inputs**

Refactor `candidate-generator.ts` so it accepts a `BranchScenarioPlan` plus a server-created `PriceManifest`, instead of deciding all candidate actions internally. Preserve the current deterministic generator as `generateDeterministicFallbackCandidates()`.

- [ ] **Step 3: Validate and normalize trades**

Add a server-side normalization function that:

1. resolves every `instrumentId` against the workspace allow-list;
2. removes model-supplied prices;
3. rejects invalid quantities and unsupported actions;
4. rejects trades that exceed parent holdings or available cash before execution;
5. keeps a clear validation error for the UI.

- [ ] **Step 4: Preserve asset conservation**

Keep the Decimal.js engine authoritative. Extend its result to include:

```ts
{
  newCashDecimal: string;
  newTotalMarketValue: string;
  newTotalAssets: string;
  tradingFees: string;
  unrealizedPnl: string;
  holdings: ...
  metrics: ...
}
```

Use parent holding cost basis and the frozen price manifest to calculate simulated unrealized P&L; do not return a hard-coded `"0"`.

- [ ] **Step 5: Test deterministic results**

Run:

```bash
pnpm test -- src/server/extensions/simulation/candidate-generator.test.ts src/server/extensions/simulation/deterministic-engine.test.ts
```

Expected: asset conservation, oversell, insufficient cash, frozen price hash, fallback provider, and P&L tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/extensions/simulation/candidate-generator.ts src/server/extensions/simulation/service.ts src/server/extensions/simulation/deterministic-engine.ts src/server/extensions/simulation/candidate-generator.test.ts src/server/extensions/simulation/deterministic-engine.test.ts
git commit -m "feat: validate agent scenarios with deterministic simulation"
```

## Task 4: Add Asynchronous Candidate Generation and Correct Run States

**Files:**
- Modify: `src/server/extensions/simulation/service.ts`
- Modify: `src/app/api/v1/simulation-workspaces/[id]/options/route.ts`
- Modify: `src/app/api/v1/analyses/[id]/route.ts`
- Modify: `src/app/api/v1/analyses/[id]/events/route.ts`
- Modify: `src/server/extensions/sse/event-persister.ts` only if replay or completion events need a small compatibility change
- Test: `src/app/api/v1/simulation-workspaces/route.test.ts`
- Test: `src/app/api/v1/analyses/[id]/events/route.test.ts`

- [ ] **Step 1: Add failing lifecycle tests**

Test:

- `POST options` returns `202` with `QUEUED`;
- `GET options` returns `QUEUED`, `RUNNING`, `SUCCEEDED`, or `FAILED`;
- SSE emits `run.started`, `agent.delegated`, `tool.started`, `branch.options.created`, and terminal events;
- a failed Agent run is not persisted as a succeeded option batch;
- duplicate idempotency requests replay the same response;
- `POST options` cannot create a second active run for the same workspace.

- [ ] **Step 2: Add an in-process active-run registry**

Use a module-level `Map<workspaceId, { controller: AbortController; promise: Promise<void> }>` for the MVP. Persist the authoritative run status in `agent_runs` and the batch status in `simulation_option_batches`. This intentionally avoids Redis while keeping restart recovery visible as `interrupted`.

- [ ] **Step 3: Move option generation to a background task**

The route should:

1. validate idempotency and workspace;
2. create a queued `agent_run` and queued option batch;
3. return `202`;
4. start the background task;
5. update run and batch statuses as the Agent, research, validation, and persistence stages finish;
6. emit a terminal SSE event.

- [ ] **Step 4: Add timeout and fallback behavior**

Use a 30-second child-agent timeout and 90-second total generation timeout. On model failure, run the deterministic fallback once and mark the provider. On fallback failure, mark both run and batch `failed` with a safe error code.

- [ ] **Step 5: Run lifecycle tests**

Run:

```bash
pnpm test -- src/app/api/v1/simulation-workspaces/route.test.ts src/app/api/v1/analyses/[id]/events/route.test.ts
```

Expected: the full queued-to-terminal lifecycle passes.

- [ ] **Step 6: Commit**

```bash
git add src/server/extensions/simulation/service.ts src/app/api/v1/simulation-workspaces/[id]/options/route.ts src/app/api/v1/analyses/[id]/route.ts src/app/api/v1/analyses/[id]/events/route.ts src/server/extensions/sse/event-persister.ts src/app/api/v1/simulation-workspaces/route.test.ts src/app/api/v1/analyses/[id]/events/route.test.ts
git commit -m "feat: add async branch option generation"
```

## Task 5: Fix Branch Execution, Switch, Undo, and Snapshot Semantics

**Files:**
- Modify: `src/server/extensions/simulation/service.ts`
- Modify: `src/app/api/v1/simulation-workspaces/[id]/branches/route.ts`
- Modify: `src/app/api/v1/simulation-workspaces/[id]/active-branch/route.ts`
- Modify: `src/app/api/v1/simulation-workspaces/[id]/undo/route.ts`
- Modify: `src/app/api/v1/simulation-workspaces/[id]/branches/[branchId]/snapshot/route.ts`
- Test: `src/app/api/v1/simulation-workspaces/route.test.ts`

- [ ] **Step 1: Add regression tests**

Test:

- branch execution never changes rows in `holdings`;
- branch snapshot returns non-zero simulated P&L when a cost basis exists;
- snapshot `dataAsOf` equals the frozen price manifest capture time;
- switch records one `branch_switched` event;
- undo records one `undo` event and returns to the parent pointer;
- root undo returns `409 ROOT_BRANCH_CANNOT_UNDO`;
- stale `If-Match` returns `412`;
- a branch from B can generate a new option batch from B rather than the root.

- [ ] **Step 2: Make undo atomic**

Implement undo as one transaction that updates the active pointer and inserts exactly one `undo` event. Do not call `switchBranch()` from `undoBranch()`, because that currently creates a duplicate `branch_switched` event.

- [ ] **Step 3: Return complete snapshot data**

Return cash, market value, total assets, cost basis, unrealized P&L, holdings, weight, metrics, price manifest hash, `capturedAt`, and engine version. Keep the original holding snapshot immutable.

- [ ] **Step 4: Run regression tests**

Run:

```bash
pnpm test -- src/app/api/v1/simulation-workspaces/route.test.ts
```

Expected: all branch create, execute, switch, undo, version, and snapshot tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/extensions/simulation/service.ts src/app/api/v1/simulation-workspaces/[id]/branches/route.ts src/app/api/v1/simulation-workspaces/[id]/active-branch/route.ts src/app/api/v1/simulation-workspaces/[id]/undo/route.ts src/app/api/v1/simulation-workspaces/[id]/branches/[branchId]/snapshot/route.ts src/app/api/v1/simulation-workspaces/route.test.ts
git commit -m "fix: complete branch snapshot and undo semantics"
```

## Task 6: Build the C-Facing Decision Flow and Detailed Branch Lab

**Files:**
- Modify: `src/app/(workbench)/simulations/page.tsx`
- Modify: `src/workbench.css`
- Modify: `src/features/workbench/components/shared.tsx` only for reusable status or diff presentation
- Create: `src/features/workbench/components/branch-option-card.tsx`
- Create: `src/features/workbench/components/branch-diff.tsx`
- Create: `src/features/workbench/components/branch-event-timeline.tsx`
- Create: `src/features/workbench/components/branch-decision-flow.tsx`
- Test: `tests/e2e/business-flow.spec.ts`

- [ ] **Step 1: Add the UI state model**

Use explicit states:

```ts
type OptionGenerationStatus = "EMPTY" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
type SimulationMode = "DECISION_FLOW" | "LAB";
```

The page must keep the selected workspace, active branch, option batch, selected option, generation status, snapshot, and event timeline separate.

- [ ] **Step 2: Implement `BranchOptionCard`**

Render conclusion, strategy, actions, simulated impact, risk, evidence, counter evidence, assumptions, provider badge, and a disabled state when the batch is not succeeded. Never label a deterministic fallback as AI.

- [ ] **Step 3: Implement `BranchDiff`**

Compare the parent and active snapshots for:

- cash;
- total assets;
- unrealized P&L;
- position weights;
- concentration;
- stress drawdown;
- executed trades.

- [ ] **Step 4: Implement `BranchEventTimeline`**

Render `root_created`, `option_executed`, `branch_switched`, `undo`, Agent progress, and failure events with timestamps and human-readable labels.

- [ ] **Step 5: Implement the default decision flow**

The primary view should show:

1. current portfolio summary;
2. current simulation objective;
3. A/B/C cards;
4. selected option confirmation with “simulation only” wording;
5. resulting active branch snapshot;
6. continue, switch, and undo actions.

- [ ] **Step 6: Add the professional lab toggle**

The detailed mode should show the branch tree, event timeline, evidence, frozen price metadata, and parent/child asset diff. Keep all operations on the same API state.

- [ ] **Step 7: Run frontend lint and type checks**

Run:

```bash
pnpm lint
pnpm typecheck
```

Expected: no lint or TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add -- 'src/app/(workbench)/simulations/page.tsx' src/workbench.css src/features/workbench/components/shared.tsx src/features/workbench/components/branch-option-card.tsx src/features/workbench/components/branch-diff.tsx src/features/workbench/components/branch-event-timeline.tsx src/features/workbench/components/branch-decision-flow.tsx tests/e2e/business-flow.spec.ts
git commit -m "feat: connect branch simulation decision flow"
```

## Task 7: Add End-to-End C-端 Linkage Verification

**Files:**
- Modify: `tests/e2e/business-flow.spec.ts`
- Modify: `playwright.config.ts` only if the local server command or timeout needs a project-specific correction
- Create: `tests/e2e/branch-simulation.spec.ts`
- Create: `scripts/branch-simulation-smoke.mjs`

- [ ] **Step 1: Add the browser test**

The Playwright scenario must:

1. open the local app;
2. enter the demo/authenticated state used by existing business-flow tests;
3. open `/simulations`;
4. create a workspace;
5. generate options;
6. wait for the terminal option batch;
7. assert three or more options;
8. execute option B;
9. assert the active branch changes and snapshot values render;
10. switch back to root or another sibling;
11. undo to the parent;
12. assert the simulation-only badge remains visible.

- [ ] **Step 2: Add a backend smoke script**

The smoke script must call the same sequence through HTTP and print only:

```text
workspace id
batch status/provider
option count
branch id
root and child total assets
active branch after switch
active branch after undo
real holdings hash before/after
```

The real holdings hash must be identical before and after every simulation operation.

- [ ] **Step 3: Start the local server**

Run:

```bash
pnpm dev --port 53523
```

If the port is busy, use the next free port and pass it to the smoke script and Playwright configuration.

- [ ] **Step 4: Run the backend smoke test**

Run:

```bash
node scripts/branch-simulation-smoke.mjs
```

Expected: workspace creation, option generation, branch execution, switch, undo, and holdings immutability all succeed.

- [ ] **Step 5: Run the browser test**

Run:

```bash
pnpm exec playwright test tests/e2e/branch-simulation.spec.ts
```

Expected: the C-facing decision flow completes without console errors or failed API requests.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/business-flow.spec.ts tests/e2e/branch-simulation.spec.ts scripts/branch-simulation-smoke.ts playwright.config.ts
git commit -m "test: verify branch simulation end to end"
```

## Task 8: Full Verification and Delivery

**Files:**
- Modify: only files needed to resolve verification failures.
- Test: all existing unit, API, and E2E suites.

- [ ] **Step 1: Run formatting and whitespace checks**

```bash
git diff --check
```

- [ ] **Step 2: Run full static checks**

```bash
pnpm lint
pnpm typecheck
```

- [ ] **Step 3: Run all unit and API tests**

```bash
pnpm test
```

Expected: zero failed suites and zero failed tests.

- [ ] **Step 4: Run the full C-facing E2E flow**

```bash
pnpm exec playwright test
```

- [ ] **Step 5: Verify the local service manually**

```bash
curl -fsS http://localhost:<port>/api/v1/health
```

Expected: database, model configuration, and required data providers report the actual current status without exposing secrets.

- [ ] **Step 6: Review the final diff**

```bash
git status --short --branch
git log --oneline -8
git diff --stat origin/codex/agent-financial-advisor-design...HEAD
```

Do not stage `.env.local`, `.superpowers/`, or local test artifacts.

- [ ] **Step 7: Commit any final verification fix**

```bash
git add <only-intended-files>
git commit -m "fix: complete branch simulation verification"
```
