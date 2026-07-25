import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prepareDatabase } from "@/server/db/migration-runner";

const candidateRun = vi.hoisted(() => {
  let resolve!: (value: {
    candidates: Array<{
      sequenceNo: number;
      label: string;
      description: string;
      trades: [];
      targetAllocations: [];
      tradeIntent: string;
      analysis: Record<string, unknown>;
    }>;
    priceManifest: { sha256: string };
    provider: "DETERMINISTIC_FALLBACK";
    delegatedAgents: [];
  }) => void;
  const promise = new Promise<Parameters<typeof resolve>[0]>((done) => {
    resolve = done;
  });
  return { promise, resolve };
});

vi.mock("./candidate-generator", () => ({
  generateCandidates: vi.fn(() => candidateRun.promise),
}));

import { cancelOptionGeneration, generateOptions } from "./service";

describe("simulation option cancellation", () => {
  let dbPath = "";

  beforeEach(() => {
    dbPath = `/tmp/simulation-cancel-${crypto.randomUUID()}.db`;
    vi.stubEnv("DB_PATH", dbPath);
    const db = new Database(dbPath);
    prepareDatabase(db as never, dbPath);
    const now = "2026-07-25T00:00:00.000Z";
    db.prepare("INSERT INTO users (id,display_name,created_at) VALUES ('exec-1','External',?)")
      .run(now);
    db.prepare(`INSERT INTO portfolio_snapshots
      (id,user_id,portfolio_id,cash_decimal,total_market_value_decimal,data_quality,source_statuses_json,as_of,created_at)
      VALUES ('portfolio-1','exec-1','portfolio','1000','0','complete','[]',?,?)`).run(now, now);
    db.pragma("defer_foreign_keys = ON");
    db.transaction(() => {
      db.prepare(`INSERT INTO simulation_workspaces
        (id,user_id,portfolio_snapshot_id,label,objective_text,status,root_branch_id,active_branch_id,created_at,updated_at,row_version)
        VALUES ('workspace-1','exec-1','portfolio-1','External','Defensive branches','active','branch-1','branch-1',?,?,1)`)
        .run(now, now);
      db.prepare(`INSERT INTO simulation_branches
        (id,workspace_id,label,depth,status,created_at,updated_at)
        VALUES ('branch-1','workspace-1','Root',0,'active',?,?)`).run(now, now);
    })();
    db.close();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not publish late model output after cancellation", async () => {
    const started = generateOptions("exec-1", "workspace-1", "Defensive branches");
    cancelOptionGeneration("exec-1", started.batchId);
    candidateRun.resolve({
      candidates: [{
        sequenceNo: 0,
        label: "Late option",
        description: "Must not persist",
        trades: [],
        targetAllocations: [],
        tradeIntent: "late",
        analysis: {},
      }],
      priceManifest: { sha256: "late" },
      provider: "DETERMINISTIC_FALLBACK",
      delegatedAgents: [],
    });
    await candidateRun.promise;
    await new Promise((resolve) => setTimeout(resolve, 20));

    const db = new Database(dbPath);
    const batch = db.prepare("SELECT status FROM simulation_option_batches WHERE id=?")
      .get(started.batchId);
    const options = db.prepare("SELECT COUNT(*) AS count FROM simulation_options WHERE batch_id=?")
      .get(started.batchId);
    db.close();
    expect(batch).toEqual({ status: "cancelled" });
    expect(options).toEqual({ count: 0 });
  });
});
