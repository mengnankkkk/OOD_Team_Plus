import { activeRuns } from "@/server/advisor/active-runs";
import { clarificationAnswerSchema } from "@/server/advisor/contracts";
import { AdvisorError } from "@/server/advisor/http";
import { runAdvisorConversation } from "@/server/advisor/runner";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { advisorStore, type AdvisorStore } from "@/server/advisor/store";

export class AdvisorService {
  constructor(private readonly store: AdvisorStore = advisorStore) {}

  createConversation(input: Record<string, unknown>) {
    return this.store.conversations.create(DEMO_USER_ID, input);
  }

  listMessages(conversationId: string) {
    return this.store.conversations.listMessages(DEMO_USER_ID, conversationId);
  }

  async sendMessage(conversationId: string, input: { content: string; clientMessageId?: string }) {
    this.store.ensureConversation(conversationId);
    if (activeRuns.has(conversationId)) throw new AdvisorError("RUN_ALREADY_ACTIVE", "当前会话已有运行中的分析。", 409);
    const message = this.store.conversations.addMessage(DEMO_USER_ID, conversationId, {
      role: "user",
      content: input.content,
      clientMessageId: input.clientMessageId,
    });
    const root = this.startRoot(conversationId, message.id, input.content);
    return { message, analysisId: root.id, streamUrl: `/api/v1/analyses/${root.id}/events` };
  }

  startAnalysis(conversationId: string, type: string, input: Record<string, unknown>) {
    if (activeRuns.has(conversationId)) throw new AdvisorError("RUN_ALREADY_ACTIVE", "当前会话已有运行中的分析。", 409);
    const question = String(input.question ?? defaultQuestion(type));
    const root = this.startRoot(conversationId, undefined, question, type);
    return { analysisId: root.id, type, status: "QUEUED", streamUrl: `/api/v1/analyses/${root.id}/events` };
  }

  getAnalysis(analysisId: string) {
    const run = this.store.getRun(analysisId);
    if (!run) throw new AdvisorError("RESOURCE_NOT_FOUND", "分析不存在。", 404);
    return {
      id: run.id,
      type: "ADVISORY_QA",
      status: mapRunStatus(run.status),
      stage: run.status === "succeeded" || run.status === "blocked" ? "FINALIZED" : run.stage?.toUpperCase() ?? run.status.toUpperCase(),
      result: this.store.getRecommendationForAnalysis(analysisId),
      diagnostic: this.store.analysis.getDiagnosticByAnalysis(analysisId),
      failure: run.status === "failed" ? { code: "ANALYSIS_FAILED", message: run.summary } : null,
    };
  }

  cancelAnalysis(analysisId: string) {
    const run = this.store.getRun(analysisId);
    if (!run) throw new AdvisorError("RESOURCE_NOT_FOUND", "分析不存在。", 404);
    const active = activeRuns.get(run.conversationId);
    active?.controller.abort();
    this.store.updateRun(analysisId, { status: "cancelled", stage: "FINALIZED", summary: "用户取消了本次分析。" });
    this.store.appendEvent({ analysisId, conversationId: run.conversationId, type: "run.failed", payload: { code: "CANCELLED", message: "分析已取消。" } });
    activeRuns.delete(run.conversationId);
    return this.store.getRun(analysisId);
  }

  retryAnalysis(analysisId: string) {
    const run = this.store.getRun(analysisId);
    if (!run) throw new AdvisorError("RESOURCE_NOT_FOUND", "分析不存在。", 404);
    const question = this.store.conversations.listMessages(DEMO_USER_ID, run.conversationId).reverse().find((message) => message.role === "USER")?.content;
    if (!question) throw new AdvisorError("ANALYSIS_NOT_RETRYABLE", "没有可重试的用户问题。", 409);
    return this.startAnalysis(run.conversationId, "ADVISORY_QA", { question });
  }

  private async runInBackground(
    conversationId: string,
    analysisId: string,
    question: string,
    abortSignal?: AbortSignal,
    skipClarification = false,
  ) {
    try {
      const clarification = skipClarification ? null : this.missingClarification(conversationId, question);
      if (clarification) {
        const request = this.store.conversations.createClarification(DEMO_USER_ID, conversationId, {
          analysisId,
          prompt: clarification.prompt,
          fields: clarification.fields,
        });
        this.store.updateRun(analysisId, { status: "waiting_user", stage: "CHECKING_CONTEXT", summary: request.prompt });
        this.store.conversations.addMessage(DEMO_USER_ID, conversationId, {
          role: "assistant",
          messageType: "question",
          content: request.prompt,
          artifact: { clarificationId: request.id, fields: request.fields },
        });
        this.store.appendEvent({ analysisId, conversationId, type: "clarification.created", payload: { clarificationId: request.id, fields: request.fields } });
        return;
      }
      const result = await runAdvisorConversation({
        conversationId,
        question,
        store: this.store,
        existingAnalysisId: analysisId,
        abortSignal,
      });
      const recommendation = this.store.getRecommendation(result.recommendationId);
      this.store.conversations.addMessage(DEMO_USER_ID, conversationId, {
        role: "assistant",
        messageType: "card",
        content: recommendation?.summary ?? "分析已完成。",
        artifact: { recommendationId: result.recommendationId, status: recommendation?.status },
      });
    } catch (error) {
      if (error instanceof Error && error.message === "ANALYSIS_CANCELLED") return;
      this.store.updateRun(analysisId, { status: "failed", stage: "FINALIZED", errorCode: "ANALYSIS_FAILED", errorMessage: "分析执行失败。" });
    } finally {
      activeRuns.delete(conversationId);
    }
  }

  answerClarification(conversationId: string, clarificationId: string, rawAnswers: unknown) {
    const answers = clarificationAnswerSchema.parse(rawAnswers).answers;
    const clarification = this.store.conversations.answerClarification(DEMO_USER_ID, conversationId, clarificationId, answers);
    const messages = this.store.conversations.listMessages(DEMO_USER_ID, conversationId);
    const question = [...messages].reverse().find((message) => message.role === "USER")?.content;
    if (!question || !clarification.analysisId) throw new AdvisorError("RESOURCE_NOT_FOUND", "原始分析问题不存在。", 404);
    this.store.conversations.patchContext(DEMO_USER_ID, conversationId, normalizeConversationContext(answers));
    applyClarificationToProfile(this.store, answers);
    const controller = new AbortController();
    const promise = this.runInBackground(conversationId, clarification.analysisId, question, controller.signal, true);
    activeRuns.set(conversationId, { controller, promise });
    return { clarification, analysisId: clarification.analysisId, streamUrl: `/api/v1/analyses/${clarification.analysisId}/events` };
  }

  private missingClarification(conversationId: string, question: string) {
    const profile = this.store.profile.getProfile(DEMO_USER_ID);
    const context = this.store.conversations.get(DEMO_USER_ID, conversationId)?.context ?? {};
    if (!profile || profile.status !== "COMPLETE") {
      const fields: Array<Record<string, unknown>> = [];
      if (!context.holdingPeriod) fields.push({ key: "holdingPeriod", type: "SINGLE_CHOICE", label: "计划持有多久？", options: ["SHORT", "MEDIUM", "LONG"], required: true });
      if (context.maxDrawdown == null) fields.push({ key: "maxDrawdown", type: "RATIO", label: "最大可接受回撤？", required: true });
      if (context.nearTermUse == null) fields.push({ key: "nearTermUse", type: "BOOLEAN", label: "这笔钱近期是否需要使用？", required: true });
      if (fields.length === 0) return null;
      return {
        prompt: "为了先建立适合你的风险边界，请补充计划期限、最大可接受回撤和这笔资金近期是否需要使用。",
        fields,
      };
    }
    if (!needsAdviceContext(question)) return null;
    const fields = [];
    if (!context.holdingPeriod && !/(短线|中线|长线|持有|天|月|年)/.test(question)) fields.push({ key: "holdingPeriod", type: "SINGLE_CHOICE", label: "计划持有多久？", options: ["SHORT", "MEDIUM", "LONG"], required: true });
    if (!context.investmentAmount && !/(投入|万元|元|资金|本金|预算)/.test(question)) fields.push({ key: "investmentAmount", type: "MONEY", label: "准备投入多少钱？", required: true });
    if (context.maxDrawdown == null && profile.maxAcceptableDrawdown == null && !/(回撤|亏损|风险)/.test(question)) fields.push({ key: "maxDrawdown", type: "RATIO", label: "最大可接受多少回撤？", required: true });
    if (fields.length === 0) return null;
    return { prompt: "为了避免把短期资金或超出风险边界的仓位直接纳入建议，请先补充关键信息。", fields };
  }

  private startRoot(conversationId: string, triggerMessageId: string | undefined, question: string, type = "ADVISORY_QA") {
    this.store.ensureConversation(conversationId);
    const root = this.store.createRun({
      conversationId,
      parentRunId: null,
      role: "chief_advisor",
      objective: `Agentic 多 Agent ${type} 分析`,
      triggerMessageId,
    });
    this.store.updateRun(root.id, { status: "queued", stage: "RECEIVED" });
    this.store.appendEvent({ analysisId: root.id, conversationId, type: "run.started", payload: { type, status: "QUEUED" } });
    const controller = new AbortController();
    activeRuns.set(conversationId, {
      controller,
      promise: this.runInBackground(conversationId, root.id, question, controller.signal),
    });
    return root;
  }
}

function needsAdviceContext(question: string) {
  return /买|入场|加仓|卖|减仓|止损|止盈|适合|推荐|科技|黄金|芯片/.test(question);
}

function applyClarificationToProfile(store: AdvisorStore, answers: Record<string, string | number | boolean>) {
  const patch: Record<string, unknown> = {};
  if (answers.investmentAmount != null) patch.investableCapital = String(answers.investmentAmount);
  if (answers.maxDrawdown != null) patch.maxAcceptableDrawdown = Number(answers.maxDrawdown);
  if (answers.instrumentPreference != null) patch.instrumentPreferences = [String(answers.instrumentPreference)];
  if (answers.holdingPeriod != null) patch.notes = `最近一次咨询期限：${String(answers.holdingPeriod)}`;
  if (Object.keys(patch).length > 0) store.profile.patchProfile(DEMO_USER_ID, patch);
}

function normalizeConversationContext(answers: Record<string, string | number | boolean>) {
  const context: Record<string, unknown> = {};
  if (answers.holdingPeriod != null) context.holdingPeriod = String(answers.holdingPeriod).toUpperCase();
  if (answers.investmentAmount != null) context.investmentAmount = String(answers.investmentAmount);
  if (answers.maxDrawdown != null) context.maxDrawdown = normalizeRatio(answers.maxDrawdown);
  if (answers.nearTermUse != null) context.nearTermUse = Boolean(answers.nearTermUse);
  if (answers.instrumentPreference != null) context.instrumentPreference = String(answers.instrumentPreference).toUpperCase();
  return context;
}

function normalizeRatio(value: string | number | boolean) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return numeric > 1 ? numeric / 100 : numeric;
}

function defaultQuestion(type: string) {
  if (type === "PORTFOLIO_DIAGNOSTIC") return "请诊断当前组合的浮盈、回撤、集中度和风险适配。";
  if (type === "STOCK_DIAGNOSTIC") return "请分析当前持仓的估值、基本面、技术指标、事件和持有条件。";
  return "请根据我的画像和持仓给出条件化的理财建议。";
}

function mapRunStatus(status: string) {
  if (status === "succeeded") return "COMPLETED";
  if (status === "waiting_user") return "WAITING_FOR_USER";
  return status.toUpperCase();
}
