import { sb } from "@/services/supabaseClient";
import { supabase } from "@/integrations/supabase/client";
import type { Alert, AlertStatus, DecisionLog } from "@/types/app/notice";

const mapAlert = (row: any): Alert => ({
  id: row.id,
  recommendationId: row.recommendation_id,
  goalId: row.goal_id,
  severity: row.severity,
  title: row.title,
  message: row.message,
  status: row.status,
  createdAt: row.created_at,
});

const mapDecision = (row: any): DecisionLog => ({
  id: row.id,
  recommendationId: row.recommendation_id,
  action: row.action,
  reason: row.reason,
  agentSnapshot: row.agent_snapshot ?? {},
  createdAt: row.created_at,
});

export async function listAlerts(userId: string, opts?: { statuses?: string[]; limit?: number }): Promise<Alert[]> {
  const statuses = opts?.statuses ?? ["unread", "read"];
  const limit = opts?.limit ?? 40;
  const { data, error } = await sb
    .from("alerts")
    .select("*")
    .eq("user_id", userId)
    .in("status", statuses)
    .order("created_at", { ascending: false })
    .range(0, limit - 1);
  if (error) throw error;
  return (data ?? []).map(mapAlert);
}

export async function updateAlertStatus(userId: string, id: string, status: AlertStatus): Promise<void> {
  const { error } = await sb.from("alerts").update({ status }).eq("user_id", userId).eq("id", id);
  if (error) throw error;
}

export async function listDecisionLogs(userId: string, limit = 50): Promise<DecisionLog[]> {
  const { data, error } = await sb
    .from("decision_logs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(0, limit - 1);
  if (error) throw error;
  return (data ?? []).map(mapDecision);
}

export function subscribeAlerts(userId: string, onChange: () => void) {
  const channel = supabase
    .channel(`alerts-${userId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "alerts", filter: `user_id=eq.${userId}` }, () => onChange())
    .on("postgres_changes", { event: "*", schema: "public", table: "recommendations", filter: `user_id=eq.${userId}` }, () => onChange())
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
