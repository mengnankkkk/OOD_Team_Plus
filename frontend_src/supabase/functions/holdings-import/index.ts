import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform",
};

const SUPERUN_API_KEY = Deno.env.get("SUPERUN_API_KEY")!;

const SYSTEM = `你负责把用户上传的持仓 CSV 或粘贴的持仓明细，解析成结构化 JSON。

输出格式（严格 JSON，不要任何解释）：
{
  "holdings": [
    {
      "name": "标的名称（原文即可）",
      "symbol": "代码（可为空字符串）",
      "assetClass": "cash|money_market|bond_fund|equity_fund|stock|index_fund|other",
      "industry": "行业分类（权益类必填，其他可为 null）",
      "quantity": 数字,
      "costBasis": 单位成本或总成本，如无则 0,
      "currentPrice": 当前价格或净值，如无请合理估算
    }
  ]
}

规则：
1. 表头可能是中文或英文，字段错位、大小写混乱、单位（元/万元）不统一，你要智能纠正。
2. 若同一标的有多行，合并成一行并累加数量。
3. 若某行明显是标题、汇总或注释，跳过。
4. 若无法判断资产类别，用 other，并把不确定原因写进 industry 字段。
5. 数字字段一律返回数值类型；缺失字段用 0 或 null，不要漏字段。
6. 只返回 JSON，不要 markdown fences，不要说话。`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const csv: string = (body.csv ?? "").toString().trim();
    if (!csv) return json({ error: "empty csv" }, 400);
    const truncated = csv.slice(0, 8000);

    const response = await fetch("https://gateway.superun.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${SUPERUN_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `请把下面的持仓明细解析成 JSON：\n\n${truncated}` },
        ],
        temperature: 0.1,
        max_tokens: 2500,
      }),
    });
    const aiData = await response.json();
    console.log("[holdings-import] gateway raw:", JSON.stringify(aiData).slice(0, 400));
    let content: string = aiData?.choices?.[0]?.message?.content ?? "";
    content = content.trim();
    if (content.startsWith("```")) {
      content = content.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
    }

    let holdings: any[] = [];
    if (content) {
      try {
        const parsed = JSON.parse(content);
        holdings = Array.isArray(parsed?.holdings) ? parsed.holdings : [];
      } catch {
        const match = content.match(/\{[\s\S]*\}/);
        if (match) {
          try { holdings = JSON.parse(match[0])?.holdings ?? []; } catch { holdings = []; }
        }
      }
    }

    // Deterministic fallback when the AI is unavailable or empty
    if (!holdings.length) {
      holdings = heuristicParse(truncated);
    }
    if (!holdings.length) {
      return json({ holdings: [], warning: aiData?.error?.message ?? "无法解析该内容，请改用手工录入" });
    }
    return json({ holdings });
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

function heuristicParse(text: string): any[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const splitLine = (l: string) => l.split(/[,\t，｜|]/).map((c) => c.trim());
  const header = splitLine(lines[0]).map((h) => h.toLowerCase());

  const findIdx = (keywords: string[]) => header.findIndex((h) => keywords.some((k) => h.includes(k)));
  const idxName = findIdx(["名称", "name", "标的"]);
  const idxSymbol = findIdx(["代码", "symbol", "code"]);
  const idxClass = findIdx(["类别", "class", "类型"]);
  const idxQty = findIdx(["数量", "份额", "quantity", "amount"]);
  const idxPrice = findIdx(["单价", "净值", "price", "价格"]);
  const idxIndustry = findIdx(["行业", "industry", "sector"]);
  const idxCost = findIdx(["成本", "cost"]);

  if (idxName < 0) return [];

  const classMap: Record<string, string> = {
    "权益": "equity_fund", "股票": "stock", "混合": "equity_fund",
    "债券": "bond_fund", "债": "bond_fund",
    "指数": "index_fund",
    "货币": "money_market",
    "现金": "cash", "存款": "cash",
  };
  const mapClass = (raw: string): string => {
    const s = (raw ?? "").toString();
    for (const [k, v] of Object.entries(classMap)) if (s.includes(k)) return v;
    if (/fund/i.test(s)) return "equity_fund";
    return "other";
  };

  const rows: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    if (!cells[idxName]) continue;
    const name = cells[idxName];
    const qty = idxQty >= 0 ? Number(cells[idxQty]?.replace(/[^0-9.-]/g, "") || 0) : 0;
    const price = idxPrice >= 0 ? Number(cells[idxPrice]?.replace(/[^0-9.-]/g, "") || 0) : 0;
    if (!qty && !price) continue;
    rows.push({
      name,
      symbol: idxSymbol >= 0 ? cells[idxSymbol] ?? "" : "",
      assetClass: mapClass(idxClass >= 0 ? cells[idxClass] : ""),
      industry: idxIndustry >= 0 ? cells[idxIndustry] || null : null,
      quantity: qty,
      currentPrice: price,
      costBasis: idxCost >= 0 ? Number(cells[idxCost]?.replace(/[^0-9.-]/g, "") || 0) : 0,
    });
  }
  return rows;
}
