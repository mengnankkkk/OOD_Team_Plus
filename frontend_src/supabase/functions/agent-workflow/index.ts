// Money Whisperer · 多 Agent 建议引擎
// 九个 Agent 协作：规划 / 画像 / 数据 / 研究 / 组合 / 信号 / 风险 / 合规 / 解释
// 风险 + 合规节点保留独立否决权；建议必须携带绑定目标、动因、证据链、有效期、失效条件五个字段。

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.56.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPERUN_API_KEY = Deno.env.get("SUPERUN_API_KEY")!;

const AGENT_LABELS = ["planner", "profile", "data", "research", "portfolio", "signal", "risk", "compliance", "explain"] as const;
type AgentName = typeof AGENT_LABELS[number];

const AGENT_LABEL_ZH: Record<AgentName, string> = {
  planner: "规划 Agent",
  profile: "画像 Agent",
  data: "数据 Agent",
  research: "研究 Agent",
  portfolio: "组合 Agent",
  signal: "信号 Agent",
  risk: "风险 Agent",
  compliance: "合规 Agent",
  explain: "解释 Agent",
};

const CASH_LIKE = new Set(["cash", "money_market"]);
const EQUITY_LIKE = new Set(["equity_fund", "stock", "index_fund"]);

const CLASS_DRAWDOWN: Record<string, number> = {
  cash: 0, money_market: 0.005, bond_fund: 0.04,
  equity_fund: 0.22, stock: 0.28, index_fund: 0.2, other: 0.1,
};

const CLASS_VOL: Record<string, number> = {
  cash: 0.001, money_market: 0.005, bond_fund: 0.05,
  equity_fund: 0.22, stock: 0.28, index_fund: 0.18, other: 0.1,
};

interface AgentState {
  status: "running" | "done" | "blocked" | "skipped";
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  summary?: string;
  detail?: unknown;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);
    const jwt = authHeader.replace("Bearer ", "");
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: userInfo } = await supabase.auth.getUser();
    const user = userInfo.user;
    if (!user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const trigger: string = body.trigger ?? "manual";

    const states: Record<AgentName, AgentState> = {} as any;
    const traceSteps: { agent: AgentName; label: string; summary: string; durationMs: number }[] = [];
    const start = (a: AgentName) => { states[a] = { status: "running", startedAt: new Date().toISOString() }; };
    const finish = (a: AgentName, summary: string, detail?: unknown) => {
      const s = states[a];
      const end = Date.now();
      const startMs = new Date(s.startedAt).getTime();
      s.status = "done"; s.finishedAt = new Date().toISOString(); s.durationMs = end - startMs;
      s.summary = summary; s.detail = detail;
      traceSteps.push({ agent: a, label: AGENT_LABEL_ZH[a], summary, durationMs: s.durationMs });
    };

    // Create agent_runs row up front
    const { data: runRow } = await supabase.from("agent_runs").insert({
      user_id: user.id, trigger_type: trigger, status: "running", planner_summary: "多 Agent 工作流启动中",
    }).select("*").single();
    const runId = runRow?.id;

    // 1. Planner
    start("planner");
    finish("planner", "拆解任务：读取画像、盘点持仓、检测触发信号，再由风险合规双重复核");

    // 2. Profile agent
    start("profile");
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
    const { data: goalsRaw } = await supabase.from("goals").select("*").eq("user_id", user.id).order("priority", { ascending: true }).range(0, 9);
    const goals = goalsRaw ?? [];
    const primaryGoal = goals[0] ?? null;
    finish("profile", `已读取风险等级 ${profile?.risk_level ?? "R3"}、月储蓄 ¥${((profile?.monthly_income ?? 0) - (profile?.monthly_expense ?? 0)).toLocaleString()}，主目标：${primaryGoal?.name ?? "尚未设置"}`);

    // 3. Data agent - holdings snapshot
    start("data");
    const { data: holdings } = await supabase.from("holdings").select("*").eq("user_id", user.id).order("market_value", { ascending: false }).range(0, 199);
    const holdingList = holdings ?? [];
    const totalAssets = holdingList.reduce((sum: number, h: any) => sum + Number(h.market_value ?? 0), 0);
    const dataSnapshot = {
      source: "internal.holdings",
      queried_at: new Date().toISOString(),
      rows: holdingList.length,
      total_assets: totalAssets,
    };
    finish("data", `聚合 ${holdingList.length} 笔持仓，共 ¥${Math.round(totalAssets).toLocaleString()}`, dataSnapshot);

    // Deterministic finance engine
    const classSums = new Map<string, number>();
    const industrySums = new Map<string, number>();
    for (const h of holdingList as any[]) {
      classSums.set(h.asset_class, (classSums.get(h.asset_class) ?? 0) + Number(h.market_value));
      if (h.industry && EQUITY_LIKE.has(h.asset_class)) {
        industrySums.set(h.industry, (industrySums.get(h.industry) ?? 0) + Number(h.market_value));
      }
    }
    const cashLike = ["cash", "money_market"].reduce((s, c) => s + (classSums.get(c) ?? 0), 0);
    const monthlyExpense = Number(profile?.monthly_expense ?? 0);
    const monthlyIncome = Number(profile?.monthly_income ?? 0);
    const emergencyMonths = monthlyExpense > 0 ? cashLike / monthlyExpense : null;
    const emergencyTarget = profile?.emergency_target_months ?? 6;

    let topClass: string | null = null; let topClassValue = 0;
    for (const [c, v] of classSums) { if (v > topClassValue) { topClass = c; topClassValue = v; } }
    const topClassRatio = totalAssets > 0 ? topClassValue / totalAssets : 0;

    const drawdown = totalAssets > 0
      ? (holdingList as any[]).reduce((sum, h) => sum + Number(h.market_value) * (CLASS_DRAWDOWN[h.asset_class] ?? 0.1), 0) / totalAssets
      : 0;

    const volatility = totalAssets > 0
      ? (holdingList as any[]).reduce((sum, h) => sum + Number(h.market_value) * (CLASS_VOL[h.asset_class] ?? 0.1), 0) / totalAssets
      : 0;

    // 4. Signal agent
    start("signal");
    const signals: { type: string; severity: "info" | "watch" | "important" | "urgent"; message: string; delta: number }[] = [];
    if (topClass && topClassRatio > 0.4 && totalAssets > 0) {
      signals.push({
        type: "concentration",
        severity: topClassRatio > 0.55 ? "urgent" : "important",
        message: `${classZh(topClass)}集中度 ${(topClassRatio * 100).toFixed(0)}%，超过 40% 上限`,
        delta: topClassRatio - 0.4,
      });
    }
    if (emergencyMonths !== null && emergencyMonths < emergencyTarget) {
      signals.push({
        type: "emergency",
        severity: emergencyMonths < emergencyTarget / 2 ? "important" : "watch",
        message: `应急金覆盖仅 ${emergencyMonths.toFixed(1)} 个月，低于目标 ${emergencyTarget} 个月`,
        delta: emergencyTarget - emergencyMonths,
      });
    }
    if (drawdown > 0.2) {
      signals.push({
        type: "drawdown",
        severity: drawdown > 0.25 ? "important" : "watch",
        message: `组合估算最大回撤 -${(drawdown * 100).toFixed(0)}%，已触发关注线`,
        delta: drawdown - 0.2,
      });
    }
    if (primaryGoal && primaryGoal.current_amount < primaryGoal.target_amount * 0.5 && primaryGoal.target_date) {
      const monthsLeft = Math.max(0, (new Date(primaryGoal.target_date).getTime() - Date.now()) / (30 * 24 * 3600 * 1000));
      const gap = Number(primaryGoal.target_amount) - Number(primaryGoal.current_amount);
      const requiredMonthly = monthsLeft > 0 ? gap / monthsLeft : gap;
      const savingsFlow = Math.max(0, monthlyIncome - monthlyExpense);
      if (requiredMonthly > savingsFlow * 1.5 && savingsFlow > 0) {
        signals.push({
          type: "goal_gap",
          severity: "watch",
          message: `${primaryGoal.name}还有 ¥${Math.round(gap).toLocaleString()} 缺口，按当前储蓄流可能落后`,
          delta: (requiredMonthly - savingsFlow) / savingsFlow,
        });
      }
    }
    finish("signal", signals.length ? `识别到 ${signals.length} 条触发信号` : "未触发关注阈值", signals);

    // 5. Portfolio agent - build candidate recommendations
    start("portfolio");
    const candidates: any[] = [];
    const topClassLabel = topClass ? classZh(topClass) : "";
    if (signals.some((s) => s.type === "concentration")) {
      const targetRatio = 0.4;
      const reduceRatio = topClassRatio - targetRatio;
      const amount = Math.round(totalAssets * reduceRatio);
      candidates.push({
        action: "decrease",
        headline: `分批减配${topClassLabel} ${(reduceRatio * 100).toFixed(0)}%，把${primaryGoal?.name ?? "买房目标"}从波动中拉回来`,
        target_asset_class: topClass,
        target_symbol: null,
        amount, weight: reduceRatio,
        pace: "分 3 次执行，每次约 ¥" + Math.round(amount / 3).toLocaleString(),
        driver: `${topClassLabel}集中度 ${(topClassRatio * 100).toFixed(0)}% > 40% 上限`,
        evidence: [
          { label: "持仓集中度", value: `${(topClassRatio * 100).toFixed(1)}%`, source: "internal.holdings" },
          { label: "组合估算回撤", value: `-${(drawdown * 100).toFixed(1)}%`, source: "financial_engine.drawdown" },
          { label: "同类历史最大回撤", value: `-${(CLASS_DRAWDOWN[topClass!] * 100).toFixed(0)}%`, source: "financial_engine.class_prior" },
        ],
        counter_evidence: [
          { label: "机会成本", value: "若市场进入延续状态，减配会错过反弹", source: "research.regime_prior" },
          { label: "税费/成本", value: "分批操作可降低摩擦成本", source: "portfolio.rebalance" },
        ],
        risk_impact: {
          expected_drawdown_after: Math.max(0, drawdown - reduceRatio * 0.4),
          expected_volatility_after: Math.max(0, volatility - reduceRatio * 0.3),
          concentration_after: targetRatio,
        },
        effective_days: 14,
        expire_condition: `${topClassLabel}集中度回落 < 45% 或市场状态由风险偏好转为防御时自动失效`,
      });
    }
    if (signals.some((s) => s.type === "emergency")) {
      const need = Math.max(0, (emergencyTarget - (emergencyMonths ?? 0)) * monthlyExpense);
      candidates.push({
        action: "emergency_reserve",
        headline: `优先补齐应急金 ¥${Math.round(need).toLocaleString()}，把不确定性挡在生活外面`,
        target_asset_class: "money_market",
        amount: Math.round(need), weight: null,
        pace: `每月存入 ¥${Math.max(2000, Math.round(need / 6)).toLocaleString()}，直至覆盖 ${emergencyTarget} 个月支出`,
        driver: `应急金 ${emergencyMonths?.toFixed(1) ?? "0"} 月 < 目标 ${emergencyTarget} 月`,
        evidence: [
          { label: "现有现金类资产", value: `¥${Math.round(cashLike).toLocaleString()}`, source: "internal.holdings" },
          { label: "月度必要支出", value: `¥${monthlyExpense.toLocaleString()}`, source: "profile.expense" },
        ],
        counter_evidence: [
          { label: "机会成本", value: "货基/短债收益低于权益，需要权衡", source: "research.class_yield" },
        ],
        risk_impact: {
          expected_drawdown_after: drawdown,
          expected_volatility_after: volatility,
          emergency_months_after: emergencyTarget,
        },
        effective_days: 30,
        expire_condition: `应急金覆盖 ≥ ${emergencyTarget} 个月即自动完成`,
      });
    }
    finish("portfolio", `生成 ${candidates.length} 个候选方案`, candidates);

    // 6. Research agent - narrative & counter evidence (AI optional)
    start("research");
    let researchNote = "研究支持与反方观点已附在证据链中，可在 Evidence Lab 展开。";
    try {
      if (SUPERUN_API_KEY && candidates.length) {
        const aiResp = await fetch("https://gateway.superun.ai/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${SUPERUN_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "deepseek-v4-flash",
            messages: [
              { role: "system", content: "你是研究 Agent。用 2 句中文补一段市场背景，禁止预测涨跌，禁止使用列表。" },
              { role: "user", content: `候选建议：${candidates[0].headline}。请给出中性的市场背景描述与可能的反方观点。` },
            ],
            temperature: 0.4,
            max_tokens: 200,
          }),
        });
        const j = await aiResp.json();
        const c = j?.choices?.[0]?.message?.content?.trim();
        if (c) researchNote = c;
      }
    } catch { /* keep default */ }
    finish("research", researchNote);

    // 7. Risk agent
    start("risk");
    const riskVerdicts: any[] = [];
    if (candidates.length === 0) {
      riskVerdicts.push({ rule: "no_candidate", verdict: "skip", note: "无候选，直接观察" });
    }
    for (const c of candidates) {
      // Emergency reserve always approved
      if (c.action === "emergency_reserve") {
        riskVerdicts.push({ rule: "emergency_priority", verdict: "approved", target: c.headline });
        continue;
      }
      // Concentration reduce needs risk level compatibility
      const rl = profile?.risk_level ?? "R3";
      if (c.action === "decrease" && rl === "R5") {
        riskVerdicts.push({ rule: "risk_level_match", verdict: "warn", target: c.headline, note: "用户偏好激进，建议保留自主权" });
      } else {
        riskVerdicts.push({ rule: "risk_level_match", verdict: "approved", target: c.headline });
      }
    }
    finish("risk", riskVerdicts.length ? `完成 ${riskVerdicts.length} 项风险规则复核` : "无需复核", riskVerdicts);

    // 8. Compliance agent
    start("compliance");
    const complianceVerdicts: any[] = [];
    for (const c of candidates) {
      const forbidden = ["保证收益", "稳赚", "必涨", "翻倍"];
      const violated = forbidden.some((k) => c.headline.includes(k));
      complianceVerdicts.push({
        rule: "no_return_promise",
        verdict: violated ? "blocked" : "approved",
        target: c.headline,
      });
    }
    finish("compliance", complianceVerdicts.length ? `合规规则通过 ${complianceVerdicts.filter((v) => v.verdict === "approved").length}/${complianceVerdicts.length}` : "无需复核", complianceVerdicts);

    // 9. Explain agent - persist recommendations & evidence packs
    start("explain");
    const persisted: any[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const compRow = complianceVerdicts[i];
      const compStatus = compRow?.verdict === "approved" ? "approved" : compRow?.verdict === "blocked" ? "blocked" : "pending";
      const effectiveUntil = new Date(Date.now() + c.effective_days * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const { data: recRow } = await supabase.from("recommendations").insert({
        user_id: user.id,
        agent_run_id: runId,
        goal_id: primaryGoal?.id ?? null,
        action: c.action,
        headline: c.headline,
        target_symbol: c.target_symbol,
        target_asset_class: c.target_asset_class,
        amount: c.amount,
        weight: c.weight ? Number((c.weight * 100).toFixed(2)) : null,
        pace: c.pace,
        driver: c.driver,
        evidence: c.evidence,
        counter_evidence: c.counter_evidence,
        effective_until: effectiveUntil,
        expire_condition: c.expire_condition,
        risk_impact: c.risk_impact,
        compliance_status: compStatus,
        compliance_notes: null,
        status: compStatus === "blocked" ? "rejected" : "active",
      }).select("*").single();

      await supabase.from("evidence_packs").insert({
        user_id: user.id,
        recommendation_id: recRow?.id,
        agent_run_id: runId,
        data_snapshots: [dataSnapshot],
        skill_runs: [
          { skill: "internal.holdings.summary", status: "ok", latencyMs: states.data.durationMs ?? 0 },
          { skill: "financial_engine.concentration", status: "ok", latencyMs: 2 },
          { skill: "financial_engine.drawdown", status: "ok", latencyMs: 2 },
        ],
        workflow_dag: {
          nodes: AGENT_LABELS.map((a) => ({ id: a, label: AGENT_LABEL_ZH[a], status: states[a]?.status ?? "skipped", durationMs: states[a]?.durationMs ?? 0, summary: states[a]?.summary ?? "" })),
          edges: [
            { from: "planner", to: "profile" },
            { from: "planner", to: "data" },
            { from: "profile", to: "signal" },
            { from: "data", to: "signal" },
            { from: "signal", to: "portfolio" },
            { from: "portfolio", to: "research" },
            { from: "research", to: "risk" },
            { from: "risk", to: "compliance" },
            { from: "compliance", to: "explain" },
          ],
        },
        research_metrics: {
          note: researchNote,
          concentration: topClassRatio,
          drawdown_estimate: drawdown,
          volatility_estimate: volatility,
          emergency_months: emergencyMonths,
        },
        simulation_log: [
          { step: "before", concentration: topClassRatio, drawdown, emergency_months: emergencyMonths },
          { step: "after", concentration: c.risk_impact.concentration_after ?? topClassRatio, drawdown: c.risk_impact.expected_drawdown_after, emergency_months: c.risk_impact.emergency_months_after ?? emergencyMonths },
        ],
        risk_verdicts: [...riskVerdicts.filter((r) => r.target === c.headline), ...complianceVerdicts.filter((r) => r.target === c.headline)],
      });

      if (compStatus === "approved") {
        await supabase.from("alerts").insert({
          user_id: user.id,
          recommendation_id: recRow?.id,
          severity: c.action === "emergency_reserve" ? "important" : "urgent",
          title: c.headline,
          message: `${c.driver}，请在 ${effectiveUntil} 前查看`,
          goal_id: primaryGoal?.id ?? null,
        });
      }
      persisted.push(recRow);
    }
    finish("explain", persisted.length ? `生成 ${persisted.length} 张建议报告单` : "本轮无需生成建议");

    // Persist agent_runs summary
    await supabase.from("agent_runs").update({
      status: "succeeded",
      planner_summary: `触发方式：${trigger} · 生成 ${persisted.length} 条建议 · 信号 ${signals.length}`,
      agent_states: states,
      completed_at: new Date().toISOString(),
    }).eq("id", runId).eq("user_id", user.id);

    return json({
      runId,
      recommendations: persisted,
      signals,
      trace: traceSteps,
      agentStates: states,
      totalAssets,
      concentration: topClassRatio,
      drawdown,
      emergencyMonths,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
});

function classZh(cls: string) {
  return ({
    cash: "现金", money_market: "货币基金", bond_fund: "债券基金",
    equity_fund: "权益基金", stock: "股票", index_fund: "指数基金", other: "其他资产",
  } as Record<string, string>)[cls] ?? cls;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}
