import { readFileSync } from "node:fs";
import path from "node:path";

const fallbackMethods = [
  "get_trade_cal", "get_prev_trade_date", "get_last_trade_date", "get_trade_list",
  "get_stock_daily", "get_stock_rt_daily", "get_stock_daily_pre", "get_stock_daily_post",
  "get_stock_min", "get_stock_rt_min", "get_concept_list", "get_concept_constituents",
  "get_stock_detail", "get_index_detail", "get_industry_constituents", "get_industry_detail",
  "get_stock_industry", "get_index_daily", "get_index_min", "get_index_weights", "get_index_indicator",
  "get_lhb_list", "get_lhb_detail", "get_margin", "get_hsgt_hold", "get_investor_activity",
  "get_restricted_list", "get_repurchase", "get_holder_count", "get_top_holders", "get_block_trade",
  "get_share_float", "get_stock_dividend", "get_stock_split", "get_stock_cash_dividend",
  "get_stock_dividend_amount", "get_stock_private_placement", "get_stock_allotment",
  "get_stock_status_over_allotment", "get_stock_competitor_information", "get_stock_intermediary_information",
  "get_stock_rela_party_trans", "get_stock_pledge", "get_stock_pledge_stat",
  "get_stock_shareholder_change", "get_fina_forecast", "get_fina_performance", "get_fina_reports",
  "get_audit_opinion", "get_future_daily", "get_future_daily_post", "get_future_min", "get_future_detail",
  "get_future_dominant", "get_option_detail", "get_option_underlying_detail", "get_option_exercise",
  "get_option_static", "get_option_daily", "get_option_spot_market", "get_option_implied_volatility",
  "get_option_underlying_volatility", "get_option_risk_indicators", "get_factor", "get_adj_factor",
  "get_hk_daily", "get_us_daily", "get_hk_detail", "get_us_detail", "get_macro_detail",
  "get_macro_cal", "get_macro_cal_info", "get_macro_cal_config", "get_fund_detail", "get_fund_daily",
  "get_fund_daily_post", "get_fund_daily_pre", "get_fund_etf_cr_limits", "get_fund_etf_cr_net",
  "get_fund_etf_constituents", "get_fund_etf_cr",
] as const;

const documentedOnlyMethods = new Set([
  "get_cumu_guarantee", "get_investor_brief_detail", "get_investor_brief_qa",
  "get_stock_csrc_approval", "get_stock_disclosure_date", "get_stock_equity_illegal",
  "get_stock_equity_nature", "get_stock_equity_placard", "get_stock_issuer_credit_rating",
  "get_stock_litigation_arbitration", "get_stock_material_contract", "get_stock_preferred_detail",
  "get_stock_preferred_dividend", "get_stock_preferred_placement", "get_stock_preferred_rating",
  "get_stock_preferred_shares", "get_stock_preferred_trading",
]);

export type PandadataMethodDescriptor = {
  name: string;
  category: string;
  section: string;
  summary: string;
  docsLine?: number;
  endpoint?: string;
  sdkExported: boolean;
};

export const pandadataMethodCatalog = loadPandadataCatalog();
export const pandadataMethodWhitelist = pandadataMethodCatalog
  .filter((method) => method.sdkExported)
  .map((method) => method.name);

export function isPandadataMethodAllowed(method: string) {
  return pandadataMethodWhitelist.includes(method) && !documentedOnlyMethods.has(method);
}

export function getPandadataMethodContract(method: string) {
  const descriptor = pandadataMethodCatalog.find((item) => item.name === method);
  if (!descriptor) return null;
  const skillRoot = process.env.PANDADATA_SKILL_ROOT?.trim() || path.join(process.cwd(), ".codex/skills/pandadata-api");
  try {
    const docs = readFileSync(path.join(skillRoot, "references", "api-docs.md"), "utf8").split(/\r?\n/);
    const start = Math.max(0, (descriptor.docsLine ?? 1) - 1);
    return {
      allowed: isPandadataMethodAllowed(method),
      descriptor,
      excerpt: docs.slice(start, start + 110).join("\n").slice(0, 12_000),
    };
  } catch {
    return {
      allowed: isPandadataMethodAllowed(method),
      descriptor,
      excerpt: "本地接口文档暂不可读，请先使用 pandadataCatalog 或检查 Skill 安装。",
    };
  }
}

function loadPandadataCatalog(): PandadataMethodDescriptor[] {
  const skillRoot = process.env.PANDADATA_SKILL_ROOT?.trim() || path.join(process.cwd(), ".codex/skills/pandadata-api");
  try {
    const endpoints = JSON.parse(
      readFileSync(path.join(skillRoot, "references", "api_catalog.json"), "utf8"),
    ) as Record<string, string>;
    const index = readFileSync(path.join(skillRoot, "references", "method-index.md"), "utf8");
    const descriptors = new Map<string, PandadataMethodDescriptor>();
    const linePattern = /^\| ([^|]+) \| ([^|]+) \| `([^`]+)` \| ([^|]+) \| (\d+) \|$/gm;
    for (const match of index.matchAll(linePattern)) {
      const [, category, section, name, summary, docsLine] = match;
      descriptors.set(name, {
        name,
        category: category.trim(),
        section: section.trim(),
        summary: summary.trim(),
        docsLine: Number(docsLine),
        endpoint: endpoints[name],
        sdkExported: !documentedOnlyMethods.has(name),
      });
    }
    for (const [name, endpoint] of Object.entries(endpoints)) {
      if (descriptors.has(name)) continue;
      descriptors.set(name, {
        name,
        category: "Pandadata",
        section: "未分类",
        summary: "Pandadata 数据接口",
        endpoint,
        sdkExported: !documentedOnlyMethods.has(name),
      });
    }
    for (const name of fallbackMethods) {
      if (descriptors.has(name)) continue;
      descriptors.set(name, {
        name,
        category: "Pandadata",
        section: "兼容方法",
        summary: "Pandadata 数据接口",
        sdkExported: !documentedOnlyMethods.has(name),
      });
    }
    return Array.from(descriptors.values());
  } catch {
    return fallbackMethods.map((name) => ({
      name,
      category: "Pandadata",
      section: "兼容方法",
      summary: "Pandadata 数据接口",
      sdkExported: !documentedOnlyMethods.has(name),
    }));
  }
}
