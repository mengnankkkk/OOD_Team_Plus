import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  getPandadataMethodContract,
  isPandadataMethodAllowed,
  PandadataAdapter,
  type PandadataProbe,
} from "@/server/advisor/pandadata";
import { StockResearchService, type StockResearchAdapter, type StockResearchBundle } from "@/server/advisor/stock-research";

export type AdvisorToolEvent =
  | { type: "agent.started"; role: "profile" | "data_research" | "portfolio_risk" | "recommendation" | "compliance"; label: string }
  | { type: "agent.completed"; role: "profile" | "data_research" | "portfolio_risk" | "recommendation" | "compliance"; summary: string; finding?: unknown }
  | { type: "tool.started"; toolName: string; inputSummary: string }
  | { type: "tool.completed"; toolName: string; outputSummary: string; result: PandadataProbe }
  | { type: "tool.failed"; toolName: string; outputSummary: string; result: PandadataProbe };

type QueryAdapter = StockResearchAdapter;

export function createPandadataQueryTool(
  adapter: QueryAdapter,
  dataResults: PandadataProbe[],
  emit?: (event: AdvisorToolEvent) => void,
) {
  return createTool({
    id: "pandadata-query",
    description: "调用 pandadata-api Skill 的任意已验证 SDK 数据接口。必须先选择准确方法和参数，不得猜测字段。",
    inputSchema: z.object({
      method: z.string().refine(isPandadataMethodAllowed, "方法未通过 panda_data 0.0.12 可调用性校验。"),
      params: z.record(z.string(), z.unknown()),
      purpose: z.string().trim().min(1).max(240),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    execute: async (input) => {
      emit?.({ type: "tool.started", toolName: `pandadata.${input.method}`, inputSummary: input.purpose });
      const result = await adapter.fetch(input.method, input.params);
      dataResults.push(result);
      emit?.({
        type: result.liveCallSucceeded ? "tool.completed" : "tool.failed",
        toolName: `pandadata.${input.method}`,
        outputSummary: result.summary,
        result,
      });
      return result as unknown as Record<string, unknown>;
    },
  });
}

export function createStockResearchTool(
  adapter: QueryAdapter,
  dataResults: PandadataProbe[],
  researchBundles: StockResearchBundle[],
  emit?: (event: AdvisorToolEvent) => void,
) {
  return createTool({
    id: "pandadata-stock-research-bundle",
    description: "为单只股票获取行情、估值、基本面、行业、事件、资金和量化因子研究包，适合个股推荐和适配性筛选。",
    inputSchema: z.object({
      symbol: z.string().trim().min(1).max(40),
      name: z.string().trim().max(120).optional(),
      market: z.string().default("CN"),
      startDate: z.string().regex(/^[0-9]{8}$/).optional(),
      endDate: z.string().regex(/^[0-9]{8}$/).optional(),
      methods: z.array(z.string().refine(isPandadataMethodAllowed)).max(40).optional(),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    execute: async (input) => {
      emit?.({
        type: "tool.started",
        toolName: "pandadata.stockResearchBundle",
        inputSummary: `研究 ${input.symbol} 的行情、估值、财务、事件和资金数据`,
      });
      const bundle = await new StockResearchService(adapter).research(input);
      researchBundles.push(bundle);
      dataResults.push(...bundle.probes);
      const result = toModelBundle(bundle);
      const representativeProbe = bundle.probes.find((probe) => probe.liveCallSucceeded) ?? bundle.probes[0];
      if (representativeProbe) {
        emit?.({
          type: representativeProbe.liveCallSucceeded ? "tool.completed" : "tool.failed",
          toolName: "pandadata.stockResearchBundle",
          outputSummary: `${bundle.symbol} 研究包完成，数据质量 ${bundle.dataQuality}，覆盖 ${bundle.methods.length} 个接口。`,
          result: representativeProbe,
        });
      }
      return result;
    },
  });
}

export function createPandadataCatalogTool() {
  return createTool({
    id: "pandadata-catalog",
    description: "搜索当前 pandadata-api Skill 中的全部可调用方法、数据域、用途和文档位置，供 Agent 选择准确的数据源。",
    inputSchema: z.object({
      query: z.string().trim().max(120).optional(),
      limit: z.number().int().min(1).max(60).default(30),
    }),
    outputSchema: z.object({
      methods: z.array(z.string()),
      matches: z.array(z.object({
        name: z.string(),
        category: z.string(),
        section: z.string(),
        summary: z.string(),
        docsLine: z.number().optional(),
        endpoint: z.string().optional(),
        sdkExported: z.boolean(),
      })),
      count: z.number(),
      totalSdkMethods: z.number(),
    }),
    execute: async ({ query, limit }) => {
      const adapter = new PandadataAdapter();
      const matches = adapter.catalog(query).slice(0, limit);
      return {
        methods: matches.map((method) => method.name),
        matches,
        count: matches.length,
        totalSdkMethods: adapter.methods().length,
      };
    },
  });
}

export function createPandadataContractTool() {
  return createTool({
    id: "pandadata-contract",
    description: "读取指定 PandaData 方法的本地 Skill 契约、参数和返回字段说明。真实调用前必须使用它确认方法和参数。",
    inputSchema: z.object({
      method: z.string().trim().refine((value) => Boolean(getPandadataMethodContract(value)), "方法不在本地 Pandadata 目录中。"),
    }),
    outputSchema: z.object({
      allowed: z.boolean(),
      descriptor: z.object({
        name: z.string(),
        category: z.string(),
        section: z.string(),
        summary: z.string(),
        docsLine: z.number().optional(),
        endpoint: z.string().optional(),
        sdkExported: z.boolean(),
      }),
      excerpt: z.string(),
    }),
    execute: async ({ method }) => {
      const contract = getPandadataMethodContract(method);
      if (!contract) throw new Error("PANDADATA_METHOD_NOT_FOUND");
      return contract;
    },
  });
}

function toModelBundle(bundle: StockResearchBundle) {
  return {
    symbol: bundle.symbol,
    name: bundle.name,
    exchange: bundle.exchange,
    source: bundle.source,
    dataQuality: bundle.dataQuality,
    dataAsOf: bundle.dataAsOf,
    methods: bundle.methods,
    unavailableMethods: bundle.unavailableMethods,
    market: bundle.market,
    valuation: bundle.valuation,
    fundamentals: bundle.fundamentals,
    industry: bundle.industry,
    events: bundle.events.slice(-8),
    capitalAndFactors: bundle.capitalAndFactors,
    coverage: bundle.coverage,
    supportEvidence: bundle.supportEvidence,
    counterEvidence: bundle.counterEvidence,
  };
}
