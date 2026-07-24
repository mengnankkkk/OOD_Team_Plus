import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticatedRequest } from "@tests/helpers/auth";
import { closeSemanticLayerRuntime } from "@/server/semantic-layer/runtime";

import { DELETE, GET, PATCH, POST } from "./route";

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
      authenticatedRequest("http://localhost/api/v1/admin/semantic-layer/domains", {
        method: "POST",
        body: JSON.stringify({ name: "投资组合", description: "用户组合语义域", isVisible: true }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ path: ["domains"] }) },
    );
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual(expect.objectContaining({ name: "投资组合", isVisible: true }));

    const listed = await GET(
      authenticatedRequest("http://localhost/api/v1/admin/semantic-layer/domains?pageNo=1&pageSize=20"),
      { params: Promise.resolve({ path: ["domains"] }) },
    );
    expect(listed.status).toBe(200);
    expect((await listed.json()).items).toEqual([expect.objectContaining({ name: "投资组合" })]);
  });

  it("returns 404 for unknown semantic routes", async () => {
    const response = await GET(
      authenticatedRequest("http://localhost/api/v1/admin/semantic-layer/unknown"),
      { params: Promise.resolve({ path: ["unknown"] }) },
    );
    expect(response.status).toBe(404);
  });

  it("manages semantic datasources through the admin namespace", async () => {
    const created = await POST(
      authenticatedRequest("http://localhost/api/v1/admin/semantic-layer/datasources", {
        method: "POST",
        body: JSON.stringify({
          datasourceKey: "warehouse-main",
          name: "数仓主库",
          description: "同步导入使用的数据源",
          connectionType: "sqlite",
          schemaName: "main",
          isVisible: true,
        }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ path: ["datasources"] }) },
    );
    expect(created.status).toBe(201);
    const payload = await created.json();
    expect(payload).toEqual(expect.objectContaining({ datasourceKey: "warehouse-main", name: "数仓主库", isVisible: true }));

    const listed = await GET(
      authenticatedRequest("http://localhost/api/v1/admin/semantic-layer/datasources?pageNo=1&pageSize=20"),
      { params: Promise.resolve({ path: ["datasources"] }) },
    );
    expect(listed.status).toBe(200);
    expect((await listed.json()).items).toEqual(expect.arrayContaining([expect.objectContaining({ datasourceKey: "warehouse-main" })]));

    const updated = await PATCH(
      authenticatedRequest(`http://localhost/api/v1/admin/semantic-layer/datasources/${payload.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: "数仓主库（已校验）", isVisible: false }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ path: ["datasources", payload.id] }) },
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual(expect.objectContaining({ name: "数仓主库（已校验）", isVisible: false }));

    const deleted = await DELETE(
      authenticatedRequest(`http://localhost/api/v1/admin/semantic-layer/datasources/${payload.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ path: ["datasources", payload.id] }) },
    );
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: 1 });
  });
});
