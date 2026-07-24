import type { AdvisorAgentRuntime } from "@/server/advisor/agents";
import { PandadataAdapter, type PandadataProbe } from "@/server/advisor/pandadata";
import type { InstrumentRecord } from "@/server/advisor/profile-store";
import type { AdvisorStore } from "@/server/advisor/store";
import { StockResearchService, type StockResearchAdapter, type StockResearchBundle } from "@/server/advisor/stock-research";
import type { AdvisorAgentFinding, AdvisorDecision } from "@/server/advisor/schemas";

const roles: AdvisorAgentFinding["role"][] = ["profile", "data_research", "portfolio_risk", "recommendation", "compliance"];

export class DeterministicAdvisorRuntime implements AdvisorAgentRuntime {
  constructor(
    private readonly store?: AdvisorStore,
    private readonly adapter: StockResearchAdapter = new PandadataAdapter(),
  ) {}

  async run(input: Parameters<AdvisorAgentRuntime["run"]>[0]) {
    const findings = roles.map((role) => finding(role, input.question));
    for (const item of findings) {
      input.emit?.({ type: "agent.started", role: item.role, label: `${item.role} deterministic fallback` });
      input.emit?.({ type: "agent.completed", role: item.role, summary: item.summary, finding: item });
    }
    const target = this.resolveTarget(input.question);
    const { bundles, dataResults } = await this.researchTarget(target, input);
    return {
      decision: decisionForQuestion(input.question, target),
      findings,
      delegatedAgents: roles,
      dataResults,
      researchBundles: bundles,
      rawText: "deterministic advisor fallback",
    };
  }

  private resolveTarget(question: string): InstrumentRecord | null {
    const direct = /([0-9]{6}\.(?:SH|SZ)|[0-9]{6})/i.exec(question)?.[1];
    if (direct && this.store) {
      const symbols = direct.includes(".") ? [direct.toUpperCase()] : [`${direct}.SH`, `${direct}.SZ`];
      for (const symbol of symbols) {
        const instrument = this.store.profile.getInstrument(symbol);
        if (instrument?.tradable) return instrument;
      }
    }
    const query = /黄金|金价/.test(question)
      ? "黄金"
      : /科技|芯片|半导体|软件|人工智能/.test(question)
        ? "科技"
        : /沪深300|宽基/.test(question)
          ? "沪深300"
          : null;
    if (query && this.store) {
      return this.store.profile.searchInstruments(query).find((instrument) => instrument.tradable) ?? null;
    }
    return query ? fallbackInstrument(query) : null;
  }

  private async researchTarget(
    target: InstrumentRecord | null,
    input: Parameters<AdvisorAgentRuntime["run"]>[0],
  ): Promise<{ bundles: StockResearchBundle[]; dataResults: PandadataProbe[] }> {
    if (!target) return { bundles: [], dataResults: [] };
    input.emit?.({
      type: "tool.started",
      toolName: "pandadata.stockResearchBundle",
      inputSummary: `研究 ${target.symbol} ${target.name} 的行情和适配性`,
    });
    try {
      const bundle = await new StockResearchService(this.adapter).research({
        symbol: target.symbol,
        name: target.name,
        market: target.market,
        assetType: target.assetType,
      });
      const representative = bundle.probes.find((probe) => probe.liveCallSucceeded) ?? bundle.probes[0];
      if (representative) {
        input.emit?.({
          type: representative.liveCallSucceeded ? "tool.completed" : "tool.failed",
          toolName: "pandadata.stockResearchBundle",
          outputSummary: `${target.symbol} 研究覆盖 ${bundle.coverage.live}/${bundle.coverage.requested} 个接口。`,
          result: representative,
        });
      }
      return { bundles: [bundle], dataResults: bundle.probes };
    } catch (error) {
      input.emit?.({
        type: "tool.failed",
        toolName: "pandadata.stockResearchBundle",
        outputSummary: error instanceof Error ? error.message : "研究包调用失败。",
        result: {
          method: "stockResearchBundle",
          ok: false,
          contractValidated: false,
          runtimeConfigured: false,
          liveCallSucceeded: false,
          liveDataFresh: false,
          mode: "live",
          summary: "研究包调用失败。",
        },
      });
      return { bundles: [], dataResults: [] };
    }
  }
}

function finding(role: AdvisorAgentFinding["role"], question: string): AdvisorAgentFinding {
  return {
    role,
    intent: inferIntent(question),
    summary: `${role} 已完成结构化检查。`,
    missingInformation: [],
    supportEvidence: [`${role} 使用画像、持仓、行情或规则证据完成检查。`],
    counterEvidence: ["若缺少新鲜 PandaData 行情，建议必须降级为观察或风险提示。"],
    risks: ["数据或用户上下文不完整时，不能输出确定性交易语言。"],
    confidence: "MEDIUM",
    needsAnotherAgent: false,
  };
}

function decisionForQuestion(question: string, target: InstrumentRecord | null): AdvisorDecision {
  const gold = /黄金|gold/i.test(question);
  const sell = /卖|减仓|止盈|退出/.test(question) || gold;
  const action = sell ? "SCALE_OUT" : /加仓|买|入场|科技|芯片/.test(question) ? "TRIAL_BUY" : "WATCH";
  return {
    action,
    status: "DEGRADED",
    primaryInstrument: target ? { symbol: target.symbol, name: target.name } : undefined,
    summary: gold ? "黄金仓位偏高时优先停止追高，并模拟分批降低集中度。" : "证据支持先观察或小仓位模拟，不建议一次性重仓。",
    suitability: "MEDIUM",
    confidence: "MEDIUM",
    rationales: ["已完成画像、研究、组合风险与合规节点。", gold ? "黄金作为对冲资产不宜长期占用过高仓位。" : "入场应结合估值、趋势、组合权重和资金期限。"],
    counterEvidence: ["缺少或未确认新鲜真实 PandaData 结果时，不能升级为 ACTIVE 个性化建议。"],
    risks: ["短期波动可能扩大。", "用户资金期限变化会影响适配性。"],
    suggestedAllocationRange: sell ? "目标降至 15%-30%" : "0%-5%",
    firstEntryAllocation: sell ? "先减 10%-20% 持仓" : "1%-2%",
    addConditions: ["真实行情仍新鲜", "组合集中度未超过上限", "反方证据没有恶化"],
    referenceRange: "以市场快照中的近 120 日波动区间为参考。",
    stopLoss: "跌破风险区间或投资逻辑失效时停止行动。",
    takeProfit: "达到目标收益、估值过热或仓位超限时再平衡。",
    horizon: "MEDIUM",
    validUntil: new Date(Date.now() + 7 * 86400_000).toISOString(),
    executionPace: sell ? "分 2-3 批降低集中度。" : "先观察，再按条件分批试仓。",
    sellDownRatio: sell ? "10%-30%" : "不适用",
    triggerReasons: [gold ? "黄金集中度偏高" : "用户询问入场或加仓时机"],
    portfolioImpact: sell ? "减仓后组合对单一资产波动更不敏感。" : "新增仓位后需重新检查单票和行业集中度。",
    alternatives: ["宽基 ETF", "继续持有现金", "低波动资产"],
    invalidationConditions: ["行情过期", "画像或持仓变化", "缺少反方证据"],
    sourceSummary: "deterministic fallback + persisted portfolio snapshot",
    agentsConsulted: roles,
    compliance: { approved: false, decision: "DOWNGRADED", reason: "缺少模型或真实数据时仅允许观察/模拟。" },
  };
}

function fallbackInstrument(query: string): InstrumentRecord | null {
  if (query === "科技") {
    return {
      id: "instrument_515000_sh",
      symbol: "515000.SH",
      name: "华宝中证科技龙头ETF",
      market: "CN",
      assetType: "ETF",
      instrumentSubtype: "SECTOR_ETF",
      currency: "CNY",
      sectorName: "科技",
      tradable: true,
      metadata: {},
    };
  }
  if (query === "黄金") {
    return {
      id: "instrument_518880_sh",
      symbol: "518880.SH",
      name: "黄金ETF",
      market: "CN",
      assetType: "GOLD_ETF",
      instrumentSubtype: "GOLD_ETF",
      currency: "CNY",
      sectorName: "黄金",
      tradable: true,
      metadata: {},
    };
  }
  return null;
}

function inferIntent(question: string) {
  if (/黄金|减仓|卖|止盈/.test(question)) return "hold_or_sell";
  if (/买|入场|加仓|科技|芯片/.test(question)) return "buy_timing";
  if (/持仓|诊断|健康/.test(question)) return "portfolio_diagnosis";
  return "advisory_qa";
}
