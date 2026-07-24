import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeSemanticLayerRuntime } from "@/server/semantic-layer/runtime";

import { GET, POST } from "./route";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-semantic-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
});

afterEach(() => {
  closeSemanticLayerRuntime();
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(`${dbPath}${suffix}`, { force: true }); } catch { /* SQLite can release Windows handles after teardown. */ }
  }
});

describe("/api/v1/admin/semantic-layer", () => {
  it("creates and lists domains through the authenticated admin namespace", async () => {
    const created = await POST(
      new NextRequest("http://localhost/api/v1/admin/semantic-layer/domains", {
        method: "POST",
        body: JSON.stringify({ name: "投资组合", description: "用户组合语义域", isVisible: true }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ path: ["domains"] }) },
    );
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual(expect.objectContaining({ name: "投资组合", isVisible: true }));

    const listed = await GET(
      new NextRequest("http://localhost/api/v1/admin/semantic-layer/domains?pageNo=1&pageSize=20"),
      { params: Promise.resolve({ path: ["domains"] }) },
    );
    expect(listed.status).toBe(200);
    expect((await listed.json()).items).toEqual([expect.objectContaining({ name: "投资组合" })]);
  });

  it("returns 404 for unknown semantic routes", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/v1/admin/semantic-layer/unknown"),
      { params: Promise.resolve({ path: ["unknown"] }) },
    );
    expect(response.status).toBe(404);
  });
});
