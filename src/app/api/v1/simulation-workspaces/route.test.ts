import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { PATCH as patchWorkspace } from "./[id]/route";
import { PATCH as switchBranch } from "./[id]/active-branch/route";
import { POST as generateOptions } from "./[id]/options/route";
import { POST as undoBranch } from "./[id]/undo/route";
import { GET, POST } from "./route";
import { generateCandidates } from "@/server/extensions/simulation/candidate-generator";
import { executeSimulation } from "@/server/extensions/simulation/deterministic-engine";

const url = "http://localhost/api/v1/simulation-workspaces";

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
        portfolioSnapshotId: "snapshot-1",
      }),
      headers: { "Idempotency-Key": "key-1" },
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.data.analysis.status).toBe("QUEUED");
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

  it("POST options validates the request and queues generation", async () => {
    const missingKey = await generateOptions(
      new NextRequest(`${url}/ws-1/options`, { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: "ws-1" }) },
    );
    expect(missingKey.status).toBe(400);

    const valid = await generateOptions(
      new NextRequest(`${url}/ws-1/options`, {
        method: "POST",
        body: JSON.stringify({ objective: "Reduce concentration" }),
        headers: { "Idempotency-Key": "key-2" },
      }),
      { params: Promise.resolve({ id: "ws-1" }) },
    );
    expect(valid.status).toBe(202);
  });

  it("candidate generator returns A/B/C", async () => {
    const result = await generateCandidates("Reduce concentration", "snapshot-1");
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.map((candidate) => candidate.label)).toEqual([
      "Option A",
      "Option B",
      "Option C",
    ]);
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
      },
      priceManifest: {
        prices: { AAPL: "150", MSFT: "200" },
        sha256: "manifest-1",
        capturedAt: "2026-07-24T00:00:00.000Z",
      },
    };

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

  it("POST undo returns the workspace persistence stub response", async () => {
    const res = await undoBranch(
      new NextRequest(`${url}/ws-1/undo`, { method: "POST" }),
      { params: Promise.resolve({ id: "ws-1" }) },
    );
    expect(res.status).toBe(404);
  });
});
