import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { PATCH as patchWorkspace } from "./[id]/route";
import { GET, POST } from "./route";

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
});
