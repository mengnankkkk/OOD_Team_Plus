import { getDatabase, createId, isoNow, json, parseJson } from "@/server/http/context";
import { calculatePortfolioMetrics, runPortfolioStressTests } from "@/server/extensions/analysis/financial-engine";
import { generateCandidates, type PriceManifest, type SimulationCandidate } from "./candidate-generator";
import { executeSimulation } from "./deterministic-engine";
import { persistSseEvent } from "../sse/event-persister";

type Row = Record<string, unknown>;

export function createWorkspace(userId: string, input: { label: string; objectiveText: string; portfolioSnapshotId: string; conversationSessionId?: string; recommendationId?: string }) {
  const db = getDatabase();
  const snapshot = db.prepare("SELECT * FROM portfolio_snapshots WHERE id = ? AND user_id = ?").get(input.portfolioSnapshotId, userId) as Row | undefined;
  if (!snapshot) { db.close(); throw new Error("Snapshot not found"); }
  const now = isoNow();
  const workspaceId = createId("workspace");
  const branchId = createId("branch");
  const analysisId = createId("analysis");
  const holdings = db.prepare(`SELECT h.*,i.asset_type,i.sector FROM holding_snapshots h
    JOIN instruments i ON i.id=h.instrument_id WHERE h.portfolio_snapshot_id=?`).all(input.portfolioSnapshotId) as Row[];
  const rootFinancialHoldings = holdings.map((holding) => ({
    instrumentId: String(holding.instrument_id), assetType: String(holding.asset_type), sector: holding.sector == null ? null : String(holding.sector),
    quantity: String(holding.quantity_decimal), price: String(holding.price_decimal), cost: String(holding.cost_decimal),
  }));
  const rootMetrics = calculatePortfolioMetrics(String(snapshot.cash_decimal), rootFinancialHoldings);
  const rootStress = runPortfolioStressTests(String(snapshot.cash_decimal), rootFinancialHoldings);
  const rootWorst = Math.min(0, ...rootStress.map((item) => Number(item.changeRatio)));
  const simSnapshotId = createId("sim_snapshot");
  const publish = db.transaction(() => {
    db.prepare("INSERT INTO agent_runs (id,user_id,type,status,created_at,completed_at) VALUES (?,?,?,'completed',?,?)").run(analysisId, userId, "simulation_workspace", now, now);
    db.prepare("INSERT INTO simulation_workspaces (id, user_id, conversation_session_id, recommendation_id, portfolio_snapshot_id, label, objective_text, status, root_branch_id, active_branch_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)").run(workspaceId, userId, input.conversationSessionId ?? null, input.recommendationId ?? null, input.portfolioSnapshotId, input.label, input.objectiveText, branchId, branchId, now, now);
    db.prepare("INSERT INTO simulation_branches (id, workspace_id, label, depth, status, created_at, updated_at) VALUES (?, ?, ?, 0, 'active', ?, ?)").run(branchId, workspaceId, "Initial assets", now, now);
    db.prepare("INSERT INTO simulation_asset_snapshots (id, workspace_id, branch_id, portfolio_snapshot_id, cash_decimal, total_market_value_decimal, metrics_json, model_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(simSnapshotId, workspaceId, branchId, input.portfolioSnapshotId, rootMetrics.cashValue, rootMetrics.totalMarketValue, json({ totalReturn: 0, maxDrawdown: rootWorst, volatility: null, concentrationHHI: Number(rootMetrics.concentrationHhi), expectedReturn: 0, bullCaseReturn: Number(rootStress.find((item) => item.scenario === "BULL")?.changeRatio ?? 0), bearCaseReturn: Number(rootStress.find((item) => item.scenario === "BEAR")?.changeRatio ?? 0), riskLevel: Math.abs(rootWorst) > 0.2 ? "HIGH" : Math.abs(rootWorst) > 0.1 ? "MEDIUM" : "LOW", stressTests: rootStress, missingMetrics: ["ANNUAL_VOLATILITY_REQUIRES_HISTORICAL_SERIES"], formulaVersion: rootMetrics.formulaVersion, assetConservationDelta: "0" }), "branch-simulation-v4", now);
    for (const holding of holdings) db.prepare("INSERT INTO simulation_asset_snapshot_items (id, snapshot_id, instrument_id, quantity_decimal, price_decimal, market_value_decimal, weight_bps, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(createId("sim_item"), simSnapshotId, holding.instrument_id, holding.quantity_decimal, holding.price_decimal, holding.market_value_decimal, holding.weight_bps, now);
    db.prepare("INSERT INTO simulation_branch_events (id, workspace_id, event_type, to_branch_id, user_id, created_at) VALUES (?, ?, 'root_created', ?, ?, ?)").run(createId("branch_event"), workspaceId, branchId, userId, now);
  });
  publish();
  db.close();
  persistSseEvent({ analysisId, type: "branch.created", payload: { workspaceId, branchId, simulationId: simSnapshotId } });
  return { workspaceId, branchId, analysisId, version: 1 };
}

export function getWorkspace(userId: string, workspaceId: string) {
  const db = getDatabase();
  const workspace = db.prepare("SELECT * FROM simulation_workspaces WHERE id = ? AND user_id = ?").get(workspaceId, userId) as Row | undefined;
  if (!workspace) { db.close(); return null; }
  const branches = db.prepare("SELECT * FROM simulation_branches WHERE workspace_id = ? ORDER BY depth, created_at, id").all(workspaceId) as Row[];
  const events = db.prepare("SELECT * FROM simulation_branch_events WHERE workspace_id = ? ORDER BY created_at, id").all(workspaceId) as Row[];
  db.close();
  return { id: workspace.id, name: workspace.label, objectiveText: workspace.objective_text, status: String(workspace.status).toUpperCase(), portfolioSnapshotId: workspace.portfolio_snapshot_id, rootBranchId: workspace.root_branch_id ?? branches[0]?.id ?? null, activeBranchId: workspace.active_branch_id, branches: branches.map((branch) => ({ id: branch.id, parentBranchId: branch.parent_branch_id, label: branch.label, depth: branch.depth, status: branch.status })), events, version: workspace.row_version };
}

export async function generateOptions(userId: string, workspaceId: string, objective: string) {
  const workspace = getWorkspace(userId, workspaceId);
  if (!workspace) throw new Error("Workspace not found");
  if (workspace.status === "ARCHIVED") throw new Error("WORKSPACE_ARCHIVED");
  const branchId = workspace.activeBranchId;
  const generated = await generateCandidates(objective, String(workspace.portfolioSnapshotId), String(branchId), userId);
  const db = getDatabase();
  const now = isoNow();
  const batchId = createId("option_batch");
  const analysisId = createId("analysis");
  const optionIds: string[] = [];
  const publish = db.transaction(() => {
    db.prepare("INSERT INTO agent_runs (id, user_id, type, status, created_at, completed_at) VALUES (?, ?, 'branch_option_generation', 'completed', ?, ?)").run(analysisId, userId, now, now);
    db.prepare("INSERT INTO simulation_option_batches (id, workspace_id, branch_id, agent_run_id, status, price_manifest_json, price_manifest_sha256, created_at) VALUES (?, ?, ?, ?, 'succeeded', ?, ?, ?)").run(batchId, workspaceId, branchId, analysisId, json(generated.priceManifest), generated.priceManifest.sha256, now);
    for (const candidate of generated.candidates) { const optionId = createId("option"); optionIds.push(optionId); db.prepare("INSERT INTO simulation_options (id, batch_id, workspace_id, sequence_no, label, description_text, trades_json, analysis_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(optionId, batchId, workspaceId, candidate.sequenceNo, candidate.label, candidate.description, json(candidate.trades), json({ ...candidate.analysis, targetAllocations: candidate.targetAllocations, tradeIntent: candidate.tradeIntent }), now); }
  });
  publish();
  db.close();
  persistSseEvent({ analysisId, type: "branch.options.created", payload: { workspaceId, branchId, optionIds } });
  return { batchId, analysisId, candidates: generated.candidates, priceManifest: generated.priceManifest };
}

export function listOptions(userId: string, workspaceId: string, batchId?: string) {
  const workspace = getWorkspace(userId, workspaceId);
  if (!workspace) return null;
  const db = getDatabase();
  const batch = (batchId ? db.prepare("SELECT * FROM simulation_option_batches WHERE id = ? AND workspace_id = ?").get(batchId, workspaceId) : db.prepare("SELECT * FROM simulation_option_batches WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1").get(workspaceId)) as Row | undefined;
  if (!batch) { db.close(); return { batch: null, items: [] }; }
  const items = db.prepare("SELECT * FROM simulation_options WHERE batch_id = ? ORDER BY sequence_no").all(batch.id) as Row[];
  db.close();
  return { batch, items: items.map((item) => ({ id: item.id, label: item.label, summary: item.description_text, trades: parseJson(item.trades_json as string, []), analysis: parseJson(item.analysis_json as string, {}) })) };
}

export function executeOption(userId: string, workspaceId: string, input: { parentBranchId: string; optionId: string; name: string }) {
  const workspace = getWorkspace(userId, workspaceId);
  if (!workspace) throw new Error("Workspace not found");
  if (workspace.status === "ARCHIVED") throw new Error("WORKSPACE_ARCHIVED");
  const db = getDatabase();
  const option = db.prepare("SELECT * FROM simulation_options WHERE id = ? AND workspace_id = ?").get(input.optionId, workspaceId) as Row | undefined;
  const parent = db.prepare("SELECT * FROM simulation_asset_snapshots WHERE branch_id = ? AND workspace_id = ?").get(input.parentBranchId, workspaceId) as Row | undefined;
  const batch = option ? db.prepare("SELECT * FROM simulation_option_batches WHERE id = ? AND workspace_id = ?").get(option.batch_id, workspaceId) as Row | undefined : undefined;
  if (!option || !parent || !batch) { db.close(); throw new Error("Branch or option not found"); }
  if (String(batch.branch_id) !== input.parentBranchId) { db.close(); throw new Error("OPTION_BRANCH_MISMATCH"); }
  if (option.executed_branch_id) { db.close(); throw new Error("OPTION_ALREADY_EXECUTED"); }
  const now = isoNow();
  const branchId = createId("branch");
  const assetSnapshotId = createId("sim_snapshot");
  const analysisId = createId("analysis");
  const trades = parseJson<Array<{ instrumentId: string; action: string; quantity: string; price?: string }>>(option.trades_json as string, []);
  const sourceItems = db.prepare(`SELECT h.*,i.asset_type,i.sector FROM simulation_asset_snapshot_items h
    JOIN instruments i ON i.id=h.instrument_id WHERE h.snapshot_id=?`).all(parent.id) as Row[];
  let simulation: ReturnType<typeof executeSimulation>;
  try {
    simulation = executeSimulation(
      String(parent.cash_decimal),
      sourceItems.map((item) => ({ instrumentId: String(item.instrument_id), quantity: String(item.quantity_decimal), marketValue: String(item.market_value_decimal), assetType: String(item.asset_type), sector: item.sector == null ? null : String(item.sector) })),
      { sequenceNo: Number(option.sequence_no), label: String(option.label), description: String(option.description_text), trades: trades as SimulationCandidate["trades"], targetAllocations: [], tradeIntent: "persisted option execution", analysis: parseJson(option.analysis_json as string, {}) as SimulationCandidate["analysis"] },
      assertManifest(parseJson<PriceManifest>(batch.price_manifest_json as string, {} as PriceManifest), String(batch.price_manifest_sha256)),
    );
  } catch (error) {
    db.close();
    throw error;
  }
  const publish = db.transaction(() => {
    db.prepare("INSERT INTO agent_runs (id,user_id,type,status,created_at,completed_at) VALUES (?,?,?,'completed',?,?)").run(analysisId, userId, "branch_execution", now, now);
    db.prepare("INSERT INTO simulation_branches (id, workspace_id, parent_branch_id, parent_option_id, label, depth, status, created_at, updated_at) SELECT ?, workspace_id, ?, ?, ?, depth + 1, 'active', ?, ? FROM simulation_branches WHERE id = ?").run(branchId, input.parentBranchId, option.id, input.name, now, now, input.parentBranchId);
    db.prepare("INSERT INTO simulation_asset_snapshots (id, workspace_id, branch_id, portfolio_snapshot_id, base_snapshot_id, cash_decimal, total_market_value_decimal, metrics_json, model_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(assetSnapshotId, workspaceId, branchId, parent.portfolio_snapshot_id, parent.id, simulation.newCashDecimal, simulation.newTotalMarketValue, json(simulation.metrics), "branch-simulation-v4", now);
    for (const item of simulation.holdings) db.prepare("INSERT INTO simulation_asset_snapshot_items (id, snapshot_id, instrument_id, quantity_decimal, price_decimal, market_value_decimal, weight_bps, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(createId("sim_item"), assetSnapshotId, item.instrumentId, item.quantity, item.price, item.marketValue, item.weightBps, now);
    db.prepare("UPDATE simulation_options SET executed_branch_id = ? WHERE id = ?").run(branchId, option.id);
    db.prepare("UPDATE simulation_workspaces SET active_branch_id = ?, row_version = row_version + 1, updated_at = ? WHERE id = ? AND user_id = ?").run(branchId, now, workspaceId, userId);
    db.prepare("INSERT INTO simulation_branch_events (id, workspace_id, event_type, from_branch_id, to_branch_id, option_id, user_id, created_at) VALUES (?, ?, 'option_executed', ?, ?, ?, ?, ?)").run(createId("branch_event"), workspaceId, input.parentBranchId, branchId, option.id, userId, now);
  });
  publish();
  db.close();
  persistSseEvent({ analysisId, type: "branch.created", payload: { workspaceId, branchId, simulationId: assetSnapshotId } });
  return { branchId, snapshotId: assetSnapshotId, activeBranchId: branchId, analysisId, metrics: simulation.metrics, tradingFees: simulation.tradingFees };
}

export function switchBranch(userId: string, workspaceId: string, branchId: string, expectedVersion?: number) {
  const workspace = getWorkspace(userId, workspaceId);
  if (!workspace || !workspace.branches.some((branch) => branch.id === branchId)) return null;
  if (expectedVersion !== undefined && workspace.version !== expectedVersion) throw new Error("VERSION_CONFLICT");
  const db = getDatabase();
  const now = isoNow();
  const update = db.transaction(() => {
    const result = db.prepare("UPDATE simulation_workspaces SET active_branch_id = ?, row_version = row_version + 1, updated_at = ? WHERE id = ? AND user_id = ? AND row_version = ?").run(branchId, now, workspaceId, userId, expectedVersion ?? workspace.version);
    if (!result.changes) throw new Error("VERSION_CONFLICT");
    db.prepare("INSERT INTO simulation_branch_events (id, workspace_id, event_type, from_branch_id, to_branch_id, user_id, created_at) VALUES (?, ?, 'branch_switched', ?, ?, ?, ?)").run(createId("branch_event"), workspaceId, workspace.activeBranchId, branchId, userId, now);
  });
  try {
    update();
  } catch (error) {
    db.close();
    throw error;
  }
  const updated = db.prepare("SELECT row_version FROM simulation_workspaces WHERE id = ?").get(workspaceId) as { row_version: number };
  db.close();
  return { activeBranchId: branchId, version: updated.row_version };
}

export function undoBranch(userId: string, workspaceId: string, expectedVersion?: number) {
  const workspace = getWorkspace(userId, workspaceId);
  if (!workspace) return null;
  const active = workspace.branches.find((branch) => branch.id === workspace.activeBranchId);
  if (!active?.parentBranchId) throw new Error("ROOT_BRANCH_CANNOT_UNDO");
  const result = switchBranch(userId, workspaceId, String(active.parentBranchId), expectedVersion);
  const db = getDatabase();
  db.prepare("INSERT INTO simulation_branch_events (id, workspace_id, event_type, from_branch_id, to_branch_id, user_id, created_at) VALUES (?, ?, 'undo', ?, ?, ?, ?)").run(createId("branch_event"), workspaceId, active.id, active.parentBranchId, userId, isoNow());
  db.close();
  return result;
}

export function getBranchSnapshot(userId: string, workspaceId: string, branchId: string) {
  const workspace = getWorkspace(userId, workspaceId);
  if (!workspace) return null;
  const db = getDatabase();
  const snapshot = db.prepare("SELECT * FROM simulation_asset_snapshots WHERE workspace_id = ? AND branch_id = ?").get(workspaceId, branchId) as Row | undefined;
  if (!snapshot) { db.close(); return null; }
  const items = db.prepare("SELECT * FROM simulation_asset_snapshot_items WHERE snapshot_id = ?").all(snapshot.id) as Row[];
  db.close();
  const db2 = getDatabase();
  const manifest = db2.prepare("SELECT b.price_manifest_sha256 FROM simulation_options o JOIN simulation_option_batches b ON b.id = o.batch_id WHERE o.executed_branch_id = ?").get(branchId) as { price_manifest_sha256?: string } | undefined;
  db2.close();
  return { cash: snapshot.cash_decimal, totalValue: snapshot.total_market_value_decimal, unrealizedPnl: "0", holdings: items.map((item) => ({ instrumentId: item.instrument_id, quantity: item.quantity_decimal, price: item.price_decimal, marketValue: item.market_value_decimal, weightBps: item.weight_bps })), metrics: parseJson(snapshot.metrics_json as string, {}), priceManifestSha256: manifest?.price_manifest_sha256 ?? null, dataAsOf: snapshot.created_at, engineVersion: snapshot.model_version };
}

function assertManifest(manifest: PriceManifest, persistedSha256: string): PriceManifest {
  if (!manifest || typeof manifest !== "object" || manifest.sha256 !== persistedSha256) throw new Error("PRICE_MANIFEST_HASH_MISMATCH");
  return manifest;
}
