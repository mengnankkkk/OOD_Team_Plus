import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, vi } from "vitest";

const dbPath = join(tmpdir(), `money-whisperer-test-${randomUUID()}.db`);
vi.stubEnv("DB_PATH", dbPath);

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(`${dbPath}${suffix}`, { force: true }); } catch { /* Windows may release SQLite handles after worker shutdown. */ }
  }
});
