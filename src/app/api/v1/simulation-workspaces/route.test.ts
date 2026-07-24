import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { PATCH as patchWorkspace } from "./[id]/route";
import { PATCH as switchBranch } from "./[id]/active-branch/route";
import { POST as executeBranch } from "./[id]/branches/route";
import { GET as listOptions, POST as generateOptions } from "./[id]/options/route";
import { POST as undoBranch } from "./[id]/undo/route";
import { GET, POST } from "./route";
import { generateCandidates, hashPriceManifest, type PriceManifest } from "@/server/extensions/simulation/candidate-generator";
import { executeSimulation } from "@/server/extensions/simulation/deterministic-engine";
import { getDatabase } from "@/server/http/context";

const url = "http://localhost/api/v1/simulation-workspaces";

beforeEach(() => {
  const db = getDatabase();
  for (const table of ["simulation_branch_events", "simulation_asset_snapshot_items", "simulation_asset_snapshots", "simulation_options", "simulation_option_batches", "simulation_branches", "simulation_workspaces", "idempotency_records", "agent_run_events", "agent_runs"]) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
  db.close();
});

describe("/api/v1/simulation-workspaces", () => {
  it("POST returns 400 without Idempotency-Key", async () => {
    const res = await POST(new NextRequest(url, { method: "POST", body: "{}" }));
    expect(res.status).toBe(400);
  });

  it("POST returns 400 without required fields", async () => {
    const req = new NextRequest(url, {
      method: "POST",
      body: "{}",
      headers: { "Idempotency-Key": "key-1" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("POST returns 202 with a valid request", async () => {
    const req = new NextRequest(url, {
      method: "POST",
      body: JSON.stringify({
        label: "Rebalance",
        objectiveText: "Reduce concentration",
        portfolioSnapshotId: "portfolio-snapshot-demo",
      }),
      headers: { "Idempotency-Key": "key-1" },
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.data.analysis.status).toBe("COMPLETED");
    expect(body.data.rootBranchId).toBe(body.data.activeBranchId);
  });

  it("GET returns an empty items list", async () => {
    const res = await GET(new NextRequest(url));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.items).toEqual([]);
  });

  it("PATCH workspace returns 400 without If-Match", async () => {
    const req = new NextRequest(`${url}/missing`, { method: "PATCH" });
    const res = await patchWorkspace(req, { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(400);
  });

  it("enforces workspace versions and blocks options after archive", async () => {
    const workspace = await createTestWorkspace("archive-workspace");
    const archived = await patchWorkspace(
      new NextRequest(`${url}/${workspace.id}`, { method: "PATCH", body: JSON.stringify({ status: "ARCHIVED" }), headers: { "If-Match": "1" } }),
      { params: Promise.resolve({ id: workspace.id }) },
    );
    expect(archived.status).toBe(200);
    const archivedBody = await archived.json();
    expect(archivedBody.data.status).toBe("ARCHIVED");
    expect(archivedBody.data.version).toBe(2);

    const stale = await patchWorkspace(
      new NextRequest(`${url}/${workspace.id}`, { method: "PATCH", body: JSON.stringify({ name: "Stale" }), headers: { "If-Match": "1" } }),
      { params: Promise.resolve({ id: workspace.id }) },
    );
    expect(stale.status).toBe(412);

    const options = await generateOptions(
      new NextRequest(`${url}/${workspace.id}/options`, { method: "POST", body: JSON.stringify({ objective: "Reduce concentration" }), headers: { "Idempotency-Key": "archived-options" } }),
      { params: Promise.resolve({ id: workspace.id }) },
    );
    expect(options.status).toBe(409);
    expect((await options.json()).error.code).toBe("WORKSPACE_ARCHIVED");
  });

  it("POST options validates the request and persists A/B/C", async () => {
    const missingKey = await generateOptions(
      new NextRequest(`${url}/ws-1/options`, { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: "ws-1" }) },
    );
    expect(missingKey.status).toBe(400);

    const workspace = await createTestWorkspace("options-workspace");
    const valid = await generateOptions(
      new NextRequest(`${url}/${workspace.id}/options`, {
        method: "POST",
        body: JSON.stringify({ objective: "Reduce concentration" }),
        headers: { "Idempotency-Key": "key-2" },
      }),
      { params: Promise.resolve({ id: workspace.id }) },
    );
    expect(valid.status).toBe(202);
    const body = await valid.json();
    expect(body.data.status).toBe("COMPLETED");
    expect(body.data.items).toHaveLength(3);
  });

  it("candidate generator returns distinct strategies", async () => {
    const result = await generateCandidates("Reduce concentration", "portfolio-snapshot-demo");
    expect(result.candidates).toHaveLength(3);
    expect(new Set(result.candidates.map((candidate) => candidate.label)).size).toBe(3);
    expect(result.candidates.every((candidate) => candidate.analysis.rationale.length > 0)).toBe(true);
  });

  it("simulation engine returns deterministic results", () => {
    const input = {
      parentCashDecimal: "100.00",
      parentHoldings: [
        { instrumentId: "AAPL", quantity: "2", marketValue: "300" },
        { instrumentId: "MSFT", quantity: "1", marketValue: "200" },
      ],
      candidate: {
        sequenceNo: 0,
        label: "Option A",
        description: "No trades",
        trades: [],
        targetAllocations: [],
        tradeIntent: "hold",
        analysis: {
          strategy: "HOLD" as const,
          riskLevel: "MEDIUM" as const,
          forecast: {
            expectedReturn: 0,
            bullCaseReturn: 0,
            bearCaseReturn: 0,
            annualVolatility: 0,
            maxDrawdown: 0,
            concentrationHHI: 0,
          },
          rationale: [],
          counterEvidence: [],
          risks: [],
          assumptions: [],
          stressTests: [],
        },
      },
      priceManifest: {
        prices: { AAPL: "150", MSFT: "200" },
        assets: { AAPL: { assetType: "STOCK", sector: "TECH" }, MSFT: { assetType: "STOCK", sector: "TECH" } },
        feeRate: "0.001",
        sha256: "",
        capturedAt: "2026-07-24T00:00:00.000Z",
      } as PriceManifest,
    };
    input.priceManifest.sha256 = hashPriceManifest(input.priceManifest);

    const first = executeSimulation(
      input.parentCashDecimal,
      [...input.parentHoldings],
      input.candidate,
      input.priceManifest,
    );
    const second = executeSimulation(
      input.parentCashDecimal,
      [...input.parentHoldings],
      input.candidate,
      input.priceManifest,
    );

    expect(first).toEqual(second);
    expect(first.newTotalMarketValue).toBe("500");
  });

  it("PATCH active branch validates If-Match and branchId", async () => {
    const missingMatch = await switchBranch(
      new NextRequest(`${url}/ws-1/active-branch`, {
        method: "PATCH",
        body: JSON.stringify({ branchId: "branch-1" }),
      }),
      { params: Promise.resolve({ id: "ws-1" }) },
    );
    expect(missingMatch.status).toBe(400);

    const missingBranch = await switchBranch(
      new NextRequest(`${url}/ws-1/active-branch`, {
        method: "PATCH",
        body: "{}",
        headers: { "If-Match": "1" },
      }),
      { params: Promise.resolve({ id: "ws-1" }) },
    );
    expect(missingBranch.status).toBe(400);
  });

  it("executes a branch and restores the parent asset state", async () => {
    const workspace = await createTestWorkspace("undo-workspace");
    await generateOptions(
      new NextRequest(`${url}/${workspace.id}/options`, {
        method: "POST",
        body: JSON.stringify({ objective: "Reduce concentration" }),
        headers: { "Idempotency-Key": "undo-options" },
      }),
      { params: Promise.resolve({ id: workspace.id }) },
    );
    const options = await (await listOptions(
      new NextRequest(`${url}/${workspace.id}/options`),
      { params: Promise.resolve({ id: workspace.id }) },
    )).json();
    const executed = await executeBranch(
      new NextRequest(`${url}/${workspace.id}/branches`, {
        method: "POST",
        body: JSON.stringify({ parentBranchId: workspace.rootBranchId, optionId: options.data.items[0].id, name: "Keep allocation" }),
        headers: { "Idempotency-Key": "execute-option-a" },
      }),
      { params: Promise.resolve({ id: workspace.id }) },
    );
    expect(executed.status).toBe(201);
    const executedBody = await executed.json();
    expect(executedBody.data.activeBranchId).not.toBe(workspace.rootBranchId);

    const res = await undoBranch(
      new NextRequest(`${url}/${workspace.id}/undo`, {
        method: "POST",
        headers: { "Idempotency-Key": "undo-option-a", "If-Match": "2" },
      }),
      { params: Promise.resolve({ id: workspace.id }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.activeBranchId).toBe(workspace.rootBranchId);
    expect(body.data.version).toBe(3);
  });

  it("rejects an option executed from a different branch", async () => {
    const workspace = await createTestWorkspace("branch-mismatch-workspace");
    await generateOptions(
      new NextRequest(`${url}/${workspace.id}/options`, { method: "POST", body: JSON.stringify({ objective: "Reduce concentration" }), headers: { "Idempotency-Key": "mismatch-options" } }),
      { params: Promise.resolve({ id: workspace.id }) },
    );
    const options = await (await listOptions(new NextRequest(`${url}/${workspace.id}/options`), { params: Promise.resolve({ id: workspace.id }) })).json();
    const first = await executeBranch(
      new NextRequest(`${url}/${workspace.id}/branches`, { method: "POST", body: JSON.stringify({ parentBranchId: workspace.rootBranchId, optionId: options.data.items[0].id, name: "First branch" }), headers: { "Idempotency-Key": "mismatch-first" } }),
      { params: Promise.resolve({ id: workspace.id }) },
    );
    const firstBody = await first.json();
    const mismatched = await executeBranch(
      new NextRequest(`${url}/${workspace.id}/branches`, { method: "POST", body: JSON.stringify({ parentBranchId: firstBody.data.branchId, optionId: options.data.items[1].id, name: "Invalid branch" }), headers: { "Idempotency-Key": "mismatch-second" } }),
      { params: Promise.resolve({ id: workspace.id }) },
    );
    expect(mismatched.status).toBe(422);
    expect((await mismatched.json()).error.code).toBe("OPTION_BRANCH_MISMATCH");
  });
});

async function createTestWorkspace(key: string) {
  const response = await POST(new NextRequest(url, {
    method: "POST",
    body: JSON.stringify({ label: "Rebalance", objectiveText: "Reduce concentration", portfolioSnapshotId: "portfolio-snapshot-demo" }),
    headers: { "Idempotency-Key": key },
  }));
  expect(response.status).toBe(202);
  return (await response.json()).data as { id: string; rootBranchId: string; activeBranchId: string; version: number };
}
