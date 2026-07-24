import { sb } from "@/services/supabaseClient";
import { supabase } from "@/integrations/supabase/client";
import type { AgentRun, EvidencePack, Recommendation } from "@/types/app/recommendation";

const mapRec = (row: any): Recommendation => ({
  id: row.id,
  userId: row.user_id,
  agentRunId: row.agent_run_id,
  goalId: row.goal_id,
  action: row.action,
  headline: row.headline,
  targetSymbol: row.target_symbol,
  targetAssetClass: row.target_asset_class,
  amount: row.amount !== null ? Number(row.amount) : null,
  weight: row.weight !== null ? Number(row.weight) : null,
  pace: row.pace,
  driver: row.driver,
  evidence: row.evidence ?? [],
  counterEvidence: row.counter_evidence ?? [],
  effectiveUntil: row.effective_until,
  expireCondition: row.expire_condition,
  riskImpact: row.risk_impact ?? {},
  complianceStatus: row.compliance_status,
  complianceNotes: row.compliance_notes,
  status: row.status,
  createdAt: row.created_at,
});

const mapRun = (row: any): AgentRun => ({
  id: row.id,
  triggerType: row.trigger_type,
  status: row.status,
  plannerSummary: row.planner_summary,
  agentStates: row.agent_states ?? {},
  startedAt: row.started_at,
  completedAt: row.completed_at,
});

const mapEvidence = (row: any): EvidencePack => ({
  id: row.id,
  recommendationId: row.recommendation_id,
  agentRunId: row.agent_run_id,
  dataSnapshots: row.data_snapshots ?? [],
  skillRuns: row.skill_runs ?? [],
  workflowDag: row.workflow_dag ?? { nodes: [], edges: [] },
  researchMetrics: row.research_metrics ?? {},
  simulationLog: row.simulation_log ?? [],
  riskVerdicts: row.risk_verdicts ?? [],
  createdAt: row.created_at,
});

export async function listRecommendations(userId: string, opts?: { statuses?: string[]; limit?: number }): Promise<Recommendation[]> {
  const statuses = opts?.statuses ?? ["active", "simulated"];
  const limit = opts?.limit ?? 20;
  const { data, error } = await sb
    .from("recommendations")
    .select("*")
    .eq("user_id", userId)
    .in("status", statuses)
    .order("created_at", { ascending: false })
    .range(0, limit - 1);
  if (error) throw error;
  return (data ?? []).map(mapRec);
}

export async function getRecommendation(userId: string, id: string): Promise<Recommendation | null> {
  const { data, error } = await sb.from("recommendations").select("*").eq("user_id", userId).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? mapRec(data) : null;
}

export async function updateRecommendationStatus(userId: string, id: string, status: string): Promise<void> {
  const { error } = await sb.from("recommendations").update({ status }).eq("user_id", userId).eq("id", id);
  if (error) throw error;
}

export async function listAgentRuns(userId: string, limit = 10): Promise<AgentRun[]> {
  const { data, error } = await sb
    .from("agent_runs")
    .select("*")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .range(0, limit - 1);
  if (error) throw error;
  return (data ?? []).map(mapRun);
}

export async function getEvidenceForRecommendation(userId: string, recId: string): Promise<EvidencePack | null> {
  const { data, error } = await sb
    .from("evidence_packs")
    .select("*")
    .eq("user_id", userId)
    .eq("recommendation_id", recId)
    .order("created_at", { ascending: false })
    .range(0, 0);
  if (error) throw error;
  return data && data.length ? mapEvidence(data[0]) : null;
}

export async function runAgentWorkflow(trigger: string = "manual") {
  const { data, error } = await supabase.functions.invoke("agent-workflow", { body: { trigger } });
  if (error) throw error;
  return data as {
    runId: string;
    recommendations: any[];
    signals: any[];
    trace: { agent: string; label: string; summary: string; durationMs: number }[];
    agentStates: Record<string, any>;
  };
}
