import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { PATCH as patchWorkspace } from "./[id]/route";
import { POST as generateOptions } from "./[id]/options/route";
import { GET, POST } from "./route";
import { generateCandidates } from "@/server/extensions/simulation/candidate-generator";

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
    const res = await patchWorkspace(req, { params: { id: "missing" } });
    expect(res.status).toBe(400);
  });

  it("POST options validates the request and queues generation", async () => {
    const missingKey = await generateOptions(
      new NextRequest(`${url}/ws-1/options`, { method: "POST", body: "{}" }),
      { params: { id: "ws-1" } },
    );
    expect(missingKey.status).toBe(400);

    const valid = await generateOptions(
      new NextRequest(`${url}/ws-1/options`, {
        method: "POST",
        body: JSON.stringify({ objective: "Reduce concentration" }),
        headers: { "Idempotency-Key": "key-2" },
      }),
      { params: { id: "ws-1" } },
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
});
