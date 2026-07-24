import { createHash } from "node:crypto";

import { getDatabase, createId, isoNow, json, parseJson } from "@/server/http/context";
import { generateCandidates, type SimulationCandidate } from "./candidate-generator";
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
  db.prepare("INSERT INTO agent_runs (id,user_id,type,status,created_at,completed_at) VALUES (?,?,?,'completed',?,?)").run(analysisId, userId, "simulation_workspace", now, now);
  db.prepare("INSERT INTO simulation_workspaces (id, user_id, conversation_session_id, recommendation_id, portfolio_snapshot_id, label, objective_text, status, active_branch_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)").run(workspaceId, userId, input.conversationSessionId ?? null, input.recommendationId ?? null, input.portfolioSnapshotId, input.label, input.objectiveText, branchId, now, now);
  db.prepare("INSERT INTO simulation_branches (id, workspace_id, label, depth, status, created_at, updated_at) VALUES (?, ?, ?, 0, 'active', ?, ?)").run(branchId, workspaceId, "Initial assets", now, now);
  db.prepare("INSERT INTO simulation_asset_snapshots (id, workspace_id, branch_id, portfolio_snapshot_id, cash_decimal, total_market_value_decimal, metrics_json, model_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(createId("sim_snapshot"), workspaceId, branchId, input.portfolioSnapshotId, snapshot.cash_decimal, snapshot.total_market_value_decimal, json({ totalReturn: 0, maxDrawdown: 0, volatility: 0, concentrationHHI: 0 }), "branch-simulation-v1", now);
  const holdings = db.prepare("SELECT * FROM holding_snapshots WHERE portfolio_snapshot_id = ?").all(input.portfolioSnapshotId) as Row[];
  const simSnapshot = db.prepare("SELECT id FROM simulation_asset_snapshots WHERE branch_id = ?").get(branchId) as { id: string };
  for (const holding of holdings) db.prepare("INSERT INTO simulation_asset_snapshot_items (id, snapshot_id, instrument_id, quantity_decimal, price_decimal, market_value_decimal, weight_bps, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(createId("sim_item"), simSnapshot.id, holding.instrument_id, holding.quantity_decimal, holding.price_decimal, holding.market_value_decimal, holding.weight_bps, now);
  db.prepare("INSERT INTO simulation_branch_events (id, workspace_id, event_type, to_branch_id, user_id, created_at) VALUES (?, ?, 'root_created', ?, ?, ?)").run(createId("branch_event"), workspaceId, branchId, userId, now);
  db.close();
  persistSseEvent({ analysisId, type: "branch.created", payload: { workspaceId, branchId, simulationId: simSnapshot.id } });
  return { workspaceId, branchId, analysisId, version: 1 };
}

export function getWorkspace(userId: string, workspaceId: string) {
  const db = getDatabase();
  const workspace = db.prepare("SELECT * FROM simulation_workspaces WHERE id = ? AND user_id = ?").get(workspaceId, userId) as Row | undefined;
  if (!workspace) { db.close(); return null; }
  const branches = db.prepare("SELECT * FROM simulation_branches WHERE workspace_id = ? ORDER BY depth, created_at, id").all(workspaceId) as Row[];
  const events = db.prepare("SELECT * FROM simulation_branch_events WHERE workspace_id = ? ORDER BY created_at, id").all(workspaceId) as Row[];
  db.close();
  return { id: workspace.id, name: workspace.label, objectiveText: workspace.objective_text, status: String(workspace.status).toUpperCase(), portfolioSnapshotId: workspace.portfolio_snapshot_id, rootBranchId: branches[0]?.id ?? null, activeBranchId: workspace.active_branch_id, branches: branches.map((branch) => ({ id: branch.id, parentBranchId: branch.parent_branch_id, label: branch.label, depth: branch.depth, status: branch.status })), events, version: workspace.row_version };
}

export async function generateOptions(userId: string, workspaceId: string, objective: string) {
  const workspace = getWorkspace(userId, workspaceId);
  if (!workspace) throw new Error("Workspace not found");
  const branchId = workspace.activeBranchId;
  const generated = await generateCandidates(objective, String(workspace.portfolioSnapshotId));
  const db = getDatabase();
  const now = isoNow();
  const batchId = createId("option_batch");
  const analysisId = createId("analysis");
  const manifest = generated.priceManifest.prices;
  db.prepare("INSERT INTO agent_runs (id, user_id, type, status, created_at, completed_at) VALUES (?, ?, 'branch_option_generation', 'completed', ?, ?)").run(analysisId, userId, now, now);
  db.prepare("INSERT INTO simulation_option_batches (id, workspace_id, branch_id, agent_run_id, status, price_manifest_json, price_manifest_sha256, created_at) VALUES (?, ?, ?, ?, 'succeeded', ?, ?, ?)").run(batchId, workspaceId, branchId, analysisId, json(manifest), generated.priceManifest.sha256, now);
  const optionIds: string[] = [];
  for (const candidate of generated.candidates) { const optionId = createId("option"); optionIds.push(optionId); db.prepare("INSERT INTO simulation_options (id, batch_id, workspace_id, sequence_no, label, description_text, trades_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(optionId, batchId, workspaceId, candidate.sequenceNo, candidate.label, candidate.description, json(candidate.trades), now); }
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
  return { batch, items: items.map((item) => ({ id: item.id, label: item.label, summary: item.description_text, trades: parseJson(item.trades_json as string, []) })) };
}

export function executeOption(userId: string, workspaceId: string, input: { parentBranchId: string; optionId: string; name: string }) {
  const workspace = getWorkspace(userId, workspaceId);
  if (!workspace) throw new Error("Workspace not found");
  const db = getDatabase();
  const option = db.prepare("SELECT * FROM simulation_options WHERE id = ? AND workspace_id = ?").get(input.optionId, workspaceId) as Row | undefined;
  const parent = db.prepare("SELECT * FROM simulation_asset_snapshots WHERE branch_id = ? AND workspace_id = ?").get(input.parentBranchId, workspaceId) as Row | undefined;
  const batch = option ? db.prepare("SELECT * FROM simulation_option_batches WHERE id = ? AND workspace_id = ?").get(option.batch_id, workspaceId) as Row | undefined : undefined;
  if (!option || !parent || !batch) { db.close(); throw new Error("Branch or option not found"); }
  if (option.executed_branch_id) { db.close(); throw new Error("OPTION_ALREADY_EXECUTED"); }
  const now = isoNow();
  const branchId = createId("branch");
  const assetSnapshotId = createId("sim_snapshot");
  const analysisId = createId("analysis");
  const trades = parseJson<Array<{ instrumentId: string; action: string; quantity: string; price?: string }>>(option.trades_json as string, []);
  const sourceItems = db.prepare("SELECT * FROM simulation_asset_snapshot_items WHERE snapshot_id = ?").all(parent.id) as Row[];
  const simulation = executeSimulation(
    String(parent.cash_decimal),
    sourceItems.map((item) => ({ instrumentId: String(item.instrument_id), quantity: String(item.quantity_decimal), marketValue: String(item.market_value_decimal) })),
    { sequenceNo: Number(option.sequence_no), label: String(option.label), description: String(option.description_text), trades: trades as SimulationCandidate["trades"] },
    { prices: parseJson<Record<string, string>>(batch.price_manifest_json as string, {}), sha256: String(batch.price_manifest_sha256), capturedAt: String(batch.created_at) },
  );
  db.prepare("INSERT INTO agent_runs (id,user_id,type,status,created_at,completed_at) VALUES (?,?,?,'completed',?,?)").run(analysisId, userId, "branch_execution", now, now);
  db.prepare("INSERT INTO simulation_branches (id, workspace_id, parent_branch_id, parent_option_id, label, depth, status, created_at, updated_at) SELECT ?, workspace_id, ?, ?, ?, depth + 1, 'active', ?, ? FROM simulation_branches WHERE id = ?").run(branchId, input.parentBranchId, option.id, input.name, now, now, input.parentBranchId);
  db.prepare("INSERT INTO simulation_asset_snapshots (id, workspace_id, branch_id, portfolio_snapshot_id, base_snapshot_id, cash_decimal, total_market_value_decimal, metrics_json, model_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(assetSnapshotId, workspaceId, branchId, parent.portfolio_snapshot_id, parent.id, simulation.newCashDecimal, simulation.newTotalMarketValue, json(simulation.metrics), "branch-simulation-v2", now);
  for (const item of simulation.holdings) db.prepare("INSERT INTO simulation_asset_snapshot_items (id, snapshot_id, instrument_id, quantity_decimal, price_decimal, market_value_decimal, weight_bps, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(createId("sim_item"), assetSnapshotId, item.instrumentId, item.quantity, item.price, item.marketValue, item.weightBps, now);
  db.prepare("UPDATE simulation_options SET executed_branch_id = ? WHERE id = ?").run(branchId, option.id);
  db.prepare("UPDATE simulation_workspaces SET active_branch_id = ?, row_version = row_version + 1, updated_at = ? WHERE id = ? AND user_id = ?").run(branchId, now, workspaceId, userId);
  db.prepare("INSERT INTO simulation_branch_events (id, workspace_id, event_type, from_branch_id, to_branch_id, option_id, user_id, created_at) VALUES (?, ?, 'option_executed', ?, ?, ?, ?, ?)").run(createId("branch_event"), workspaceId, input.parentBranchId, branchId, option.id, userId, now);
  db.close();
  persistSseEvent({ analysisId, type: "branch.created", payload: { workspaceId, branchId, simulationId: assetSnapshotId } });
  return { branchId, snapshotId: assetSnapshotId, activeBranchId: branchId, analysisId, metrics: simulation.metrics, tradingFees: simulation.tradingFees };
}

export function switchBranch(userId: string, workspaceId: string, branchId: string) {
  const workspace = getWorkspace(userId, workspaceId);
  if (!workspace || !workspace.branches.some((branch) => branch.id === branchId)) return null;
  const db = getDatabase();
  const now = isoNow();
  db.prepare("UPDATE simulation_workspaces SET active_branch_id = ?, row_version = row_version + 1, updated_at = ? WHERE id = ? AND user_id = ?").run(branchId, now, workspaceId, userId);
  db.prepare("INSERT INTO simulation_branch_events (id, workspace_id, event_type, from_branch_id, to_branch_id, user_id, created_at) VALUES (?, ?, 'branch_switched', ?, ?, ?, ?)").run(createId("branch_event"), workspaceId, workspace.activeBranchId, branchId, userId, now);
  const updated = db.prepare("SELECT row_version FROM simulation_workspaces WHERE id = ?").get(workspaceId) as { row_version: number };
  db.close();
  return { activeBranchId: branchId, version: updated.row_version };
}

export function undoBranch(userId: string, workspaceId: string) {
  const workspace = getWorkspace(userId, workspaceId);
  if (!workspace) return null;
  const active = workspace.branches.find((branch) => branch.id === workspace.activeBranchId);
  if (!active?.parentBranchId) throw new Error("ROOT_BRANCH_CANNOT_UNDO");
  const result = switchBranch(userId, workspaceId, String(active.parentBranchId));
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
