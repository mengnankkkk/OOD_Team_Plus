import { apiPost } from "@/features/frontend-migration/api";
import { sendAdvisorMessageStream, type AdvisorStreamObserver } from "@/services/advisorService";

type ConversationRow = {
  id: string;
};

export type PortfolioReportResult = {
  conversationId: string;
  analysisId: string;
  artifactId: string;
  previewUrl: string;
};

export async function generatePortfolioReport(
  focus: string,
  observer: AdvisorStreamObserver = {},
): Promise<PortfolioReportResult> {
  const createdAt = new Date();
  const titleTime = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(createdAt);
  const conversation = await apiPost<ConversationRow>("/api/v1/conversations", {
    title: `资产深度报告 · ${titleTime}`,
  });
  const prompt = [
    "请基于我当前全部真实持仓生成资产深度报告。",
    "请执行完整 Agent 回路，覆盖持仓分析、组合集中度、最大回撤、压力风险、支持证据、反方证据、合规结论、观察条件和失效条件。",
    "请区分事实、推断和建议，不要把研究模拟描述为真实交易指令。",
    focus.trim() ? `本次关注点：${focus.trim()}` : "",
  ].filter(Boolean).join("\n");

  const result = await sendAdvisorMessageStream(
    prompt,
    conversation.id,
    "FINANCIAL_REPORT",
    observer,
    "DAILY_PORTFOLIO",
  );
  const artifactId = result.artifact?.artifactId;
  if (!result.analysisId || !artifactId) {
    throw new Error("Agent 已完成分析，但没有生成可预览的报告产物");
  }

  return {
    conversationId: result.sessionId,
    analysisId: result.analysisId,
    artifactId,
    previewUrl: result.artifact?.previewUrl ?? `/api/v1/generated-artifacts/${artifactId}/preview`,
  };
}
