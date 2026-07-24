import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.56.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPERUN_API_KEY = Deno.env.get("SUPERUN_API_KEY")!;

const SYSTEM_PROMPT = `你是"财语（Money Whisperer）"里的顾问 Agent，工作是帮理财小白建立一份可靠的个人财务档案。

规则：
1. 只用简体中文，语气克制、专业、温暖，像资深理财顾问跟朋友聊天。
2. 每轮聚焦一个问题（收入、必要支出、负债、家庭责任、既有资产、生活目标、风险偏好、既往投资经历）。
3. 采集到关键数字时要"复述并确认"，例如"你说月入 2 万、每月必要支出约 1 万，我理解对吗？"。
4. 检测到"主观激进但客观承受能力不足"、"目标金额过大且时间过短"、"应急金不足"等矛盾时，先温和指出，再询问。
5. 当用户已提供收入、支出、负债、目标之一/家庭责任/风险偏好之一时，回复必须尾随一段可解析的 JSON 结构，格式：
<PROFILE_UPDATE>
{"monthlyIncome": 20000, "monthlyExpense": 10000, "liabilities": 0, "household": "单身独居", "riskLevel": "R3", "riskSubjective": "自认为进取", "riskCapacity": "承受回撤约 15%", "behaviorNotes": "计划三年买房"}
</PROFILE_UPDATE>
只写你确定的字段，不确定的字段不要写。riskLevel 值必须来自 R1/R2/R3/R4/R5。
6. 如果本轮没有可更新的字段，就不要输出 <PROFILE_UPDATE> 段。
7. 简明扼要，一次最多两个短句加一个问题。禁止给出投资建议或收益预测。禁止使用列表/emoji/markdown。
8. 用户说"完成/暂停/回头再聊"时，礼貌收尾并输出 <PROFILE_UPDATE>{"onboardingCompleted": true}</PROFILE_UPDATE>。`;

interface Span {
  id: string;
  name: string;
  label: string;
  kind: "tool" | "reasoning" | "io" | "llm";
  tool: string | null;
  input: unknown;
  output: unknown;
  startedAt: string;
  durationMs: number;
  status: "ok" | "error";
  note?: string;
}

interface Trace {
  id: string;
  startedAt: string;
  totalMs: number;
  model: string;
  spans: Span[];
  finalReply: string;
}

function newTracer(): { spans: Span[]; run: <T>(name: string, label: string, kind: Span["kind"], tool: string | null, input: unknown, fn: () => Promise<T>, previewOutput?: (out: T) => unknown, note?: string) => Promise<T> } {
  const spans: Span[] = [];
  const run = async <T>(name: string, label: string, kind: Span["kind"], tool: string | null, input: unknown, fn: () => Promise<T>, previewOutput?: (out: T) => unknown, note?: string): Promise<T> => {
    const startedAt = new Date().toISOString();
    const t0 = performance.now();
    const spanId = `${name}-${spans.length + 1}`;
    try {
      const out = await fn();
      const durationMs = Math.round(performance.now() - t0);
      spans.push({ id: spanId, name, label, kind, tool, input, output: previewOutput ? previewOutput(out) : out, startedAt, durationMs, status: "ok", note });
      return out;
    } catch (err) {
      const durationMs = Math.round(performance.now() - t0);
      spans.push({ id: spanId, name, label, kind, tool, input, output: { error: err instanceof Error ? err.message : String(err) }, startedAt, durationMs, status: "error", note });
      throw err;
    }
  };
  return { spans, run };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const traceStartedAt = new Date().toISOString();
  const traceStartTs = performance.now();

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);
    const jwt = authHeader.replace("Bearer ", "");
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: userInfo } = await supabase.auth.getUser();
    const user = userInfo.user;
    if (!user) return json({ error: "unauthorized" }, 401);

    const body = await req.json();
    const message: string = (body.message ?? "").toString().trim();
    if (!message) return json({ error: "empty message" }, 400);
    const sessionId: string = (body.sessionId ?? crypto.randomUUID()).toString();

    const { spans, run } = newTracer();
    const traceId = `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Span 1 —— 读历史对话（仅当前会话）
    const history = await run(
      "load_history",
      "读取当前会话对话",
      "tool",
      "database.select",
      { table: "onboarding_messages", filter: { user_id: user.id, session_id: sessionId }, order: "created_at asc", range: [0, 39] },
      async () => {
        const { data } = await supabase
          .from("onboarding_messages")
          .select("role, content")
          .eq("user_id", user.id)
          .eq("session_id", sessionId)
          .order("created_at", { ascending: true })
          .range(0, 39);
        return data ?? [];
      },
      (out) => ({ rowCount: out.length, preview: out.slice(-3).map((m: any) => ({ role: m.role, content: (m.content ?? "").slice(0, 60) })) }),
      "仅拉当前会话内的历史，避免跨会话上下文污染"
    );

    // Span 2 —— 读画像快照
    const profileRow = await run(
      "load_profile",
      "读取用户画像快照",
      "tool",
      "database.select",
      { table: "profiles", filter: { id: user.id }, maybeSingle: true },
      async () => {
        const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
        return data;
      },
      (out) => (out ? {
        displayName: out.display_name, age: out.age, monthlyIncome: out.monthly_income, monthlyExpense: out.monthly_expense,
        liabilities: out.liabilities, riskLevel: out.risk_level, onboardingCompleted: out.onboarding_completed,
      } : null),
      "把当前画像作为 system 侧上下文注入，避免顾问重复追问"
    );

    // Span 3 —— 组装 prompt
    const messages: any[] = [{ role: "system", content: SYSTEM_PROMPT }];
    const profileSummary = profileRow ? `【已知档案】${JSON.stringify({
      displayName: profileRow.display_name, age: profileRow.age, household: profileRow.household,
      monthlyIncome: profileRow.monthly_income, monthlyExpense: profileRow.monthly_expense, liabilities: profileRow.liabilities,
      riskLevel: profileRow.risk_level, riskSubjective: profileRow.risk_subjective, riskCapacity: profileRow.risk_capacity,
      behaviorNotes: profileRow.behavior_notes, onboardingCompleted: profileRow.onboarding_completed,
    })}` : "";
    if (profileSummary) messages.push({ role: "system", content: profileSummary });
    for (const h of history) messages.push({ role: h.role === "user" ? "user" : "assistant", content: h.content });
    messages.push({ role: "user", content: message });

    await run(
      "build_prompt",
      "组装 chat.completions 请求",
      "reasoning",
      null,
      { systemPromptChars: SYSTEM_PROMPT.length, hasProfile: Boolean(profileSummary), historyCount: history.length, userMessageChars: message.length },
      async () => ({ totalMessages: messages.length }),
      (out) => out,
      "拼装 system + 画像快照 + 历史轮次 + 当前用户输入"
    );

    // Span 4 —— 写入用户消息（先落库，避免云函数超时后丢失）
    await run(
      "persist_user_message",
      "持久化用户消息",
      "tool",
      "database.insert",
      { table: "onboarding_messages", row: { role: "user", session_id: sessionId, contentPreview: message.slice(0, 80) } },
      async () => {
        await supabase.from("onboarding_messages").insert({ user_id: user.id, role: "user", content: message, session_id: sessionId });
        return { ok: true };
      },
      (out) => out
    );

    // Span 5 —— 调用大模型（带备份模型）
    const modelChain = ["deepseek-v4-flash", "qwen3.6-plus", "superun-vision-flash"];

    const callGateway = async (model: string) => {
      const response = await fetch("https://gateway.superun.ai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${SUPERUN_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, temperature: 0.4, max_tokens: 500 }),
      });
      const httpStatus = response.status;
      const raw = await response.json();
      return { httpStatus, raw };
    };

    let winningReply = "";
    let winningModel: string | null = null;
    let winningRaw: any = null;

    for (const model of modelChain) {
      const { httpStatus, raw } = await run(
        `call_llm_${model.replace(/[^a-z0-9]/gi, "_")}`,
        `调用 superun AI · ${model}`,
        "llm",
        "https://gateway.superun.ai/chat/completions",
        { model, temperature: 0.4, max_tokens: 500, messagesCount: messages.length, lastUserMessage: message.slice(0, 120) },
        async () => await callGateway(model),
        (out: { httpStatus: number; raw: any }) => ({
          httpStatus: out.httpStatus,
          model: out.raw?.model,
          usage: out.raw?.usage,
          finishReason: out.raw?.choices?.[0]?.finish_reason,
          contentPreview: (out.raw?.choices?.[0]?.message?.content ?? "").slice(0, 260),
          gatewayError: out.raw?.error ?? null,
        }),
        `依次尝试 ${modelChain.join(" / ")}，任一模型返回非空内容即采纳`
      );

      const candidate = raw?.choices?.[0]?.message?.content ?? "";
      if (httpStatus === 200 && candidate.trim().length > 0) {
        winningReply = candidate;
        winningModel = model;
        winningRaw = raw;
        break;
      }
    }

    if (!winningReply) {
      winningReply = "AI 网关连续返回空内容，已将此次 trace 完整保存供排查。你可以稍后重试或直接在“我的”里手动录入基本信息。";
    }

    const aiData = winningRaw ?? { choices: [{ message: { content: winningReply } }] };
    let reply: string = winningReply;
    const chosenModel = winningModel ?? modelChain[0];

    // Span 6 —— 提取 <PROFILE_UPDATE>
    const extraction = await run(
      "parse_profile_update",
      "解析 <PROFILE_UPDATE> 结构化输出",
      "reasoning",
      null,
      { rawReplyChars: reply.length, containsTag: /<PROFILE_UPDATE>/.test(reply) },
      async () => {
        const match = reply.match(/<PROFILE_UPDATE>([\s\S]*?)<\/PROFILE_UPDATE>/);
        let parsed: Record<string, unknown> | null = null;
        if (match) {
          try { parsed = JSON.parse(match[1].trim()); } catch { parsed = null; }
          reply = reply.replace(match[0], "").trim();
        }
        return { parsed, matched: Boolean(match) };
      },
      (out) => out,
      "从回复末尾抠出可持久化字段"
    );

    const profileUpdate = extraction.parsed;

    // Span 7 —— 持久化顾问回复（附上 trace 元数据在最后写）
    // 拆两步以让 trace 完整包含 profile 落库 span
    // Span 8 —— 更新 profile 表
    if (profileUpdate) {
      await run(
        "persist_profile_update",
        "把画像变更写入 profiles",
        "tool",
        "database.update",
        { table: "profiles", filter: { id: user.id }, patch: profileUpdate },
        async () => {
          const payload: Record<string, unknown> = {};
          const map: Record<string, string> = {
            displayName: "display_name", age: "age", household: "household",
            monthlyIncome: "monthly_income", monthlyExpense: "monthly_expense", liabilities: "liabilities",
            emergencyTargetMonths: "emergency_target_months", riskLevel: "risk_level",
            riskSubjective: "risk_subjective", riskCapacity: "risk_capacity",
            behaviorNotes: "behavior_notes", onboardingCompleted: "onboarding_completed",
          };
          for (const [k, v] of Object.entries(profileUpdate)) {
            const col = map[k];
            if (col && v !== undefined && v !== null && v !== "") payload[col] = v;
          }
          if (Object.keys(payload).length) {
            await supabase.from("profiles").update(payload).eq("id", user.id);
            return { columnsUpdated: Object.keys(payload) };
          }
          return { columnsUpdated: [] };
        },
        (out) => out
      );
    }

    void aiData;

    const trace: Trace = {
      id: traceId,
      startedAt: traceStartedAt,
      totalMs: Math.round(performance.now() - traceStartTs),
      model: chosenModel,
      spans,
      finalReply: reply,
    };

    // Span final —— 持久化顾问消息（带 trace 元数据）
    await supabase.from("onboarding_messages").insert({
      user_id: user.id,
      role: "advisor",
      content: reply,
      metadata: { profileUpdate: profileUpdate ?? null, trace },
      session_id: sessionId,
    });

    return json({ reply, profileUpdate, trace, sessionId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}
