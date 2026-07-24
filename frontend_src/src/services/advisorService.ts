import { sb } from "@/services/supabaseClient";
import { supabase } from "@/integrations/supabase/client";
import type { AdvisorReply, AdvisorSessionSummary, OnboardingMessage } from "@/types/app/onboarding";

const mapRow = (row: any): OnboardingMessage => ({
  id: row.id,
  role: row.role,
  content: row.content,
  metadata: row.metadata ?? {},
  createdAt: row.created_at,
  sessionId: row.session_id ?? null,
});

export async function listOnboardingMessages(userId: string, sessionId?: string): Promise<OnboardingMessage[]> {
  let q = sb
    .from("onboarding_messages")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .range(0, 199);
  if (sessionId) q = q.eq("session_id", sessionId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function listAdvisorSessions(userId: string): Promise<AdvisorSessionSummary[]> {
  const { data, error } = await sb
    .from("onboarding_messages")
    .select("session_id, role, content, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(0, 499);
  if (error) throw error;
  const groups = new Map<string, { messages: any[]; lastActivityAt: string; firstActivityAt: string }>();
  for (const row of data ?? []) {
    const sid = row.session_id;
    if (!sid) continue;
    let g = groups.get(sid);
    if (!g) {
      g = { messages: [], lastActivityAt: row.created_at, firstActivityAt: row.created_at };
      groups.set(sid, g);
    }
    g.messages.push(row);
    if (row.created_at > g.lastActivityAt) g.lastActivityAt = row.created_at;
    if (row.created_at < g.firstActivityAt) g.firstActivityAt = row.created_at;
  }
  const summaries: AdvisorSessionSummary[] = [];
  for (const [sid, g] of groups.entries()) {
    const firstUser = [...g.messages]
      .sort((a, b) => (a.created_at > b.created_at ? 1 : -1))
      .find((m) => m.role === "user");
    const rawTitle = (firstUser?.content ?? "新对话").trim();
    const title = rawTitle.length > 18 ? `${rawTitle.slice(0, 18)}…` : rawTitle;
    summaries.push({
      sessionId: sid,
      title: title || "新对话",
      messageCount: g.messages.length,
      lastActivityAt: g.lastActivityAt,
      firstActivityAt: g.firstActivityAt,
    });
  }
  summaries.sort((a, b) => (a.lastActivityAt > b.lastActivityAt ? -1 : 1));
  return summaries;
}

export async function sendAdvisorMessage(message: string, sessionId: string): Promise<AdvisorReply> {
  const { data, error } = await supabase.functions.invoke("advisor-chat", { body: { message, sessionId } });
  if (error) throw error;
  return data as AdvisorReply;
}

export async function deleteAdvisorSession(userId: string, sessionId: string): Promise<void> {
  const { error } = await sb
    .from("onboarding_messages")
    .delete()
    .eq("user_id", userId)
    .eq("session_id", sessionId);
  if (error) throw error;
}

export async function clearOnboardingConversation(userId: string): Promise<void> {
  const { error } = await sb.from("onboarding_messages").delete().eq("user_id", userId);
  if (error) throw error;
}
