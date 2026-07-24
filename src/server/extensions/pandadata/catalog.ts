import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

const DateString = z.string().regex(/^\d{8}$/);
const Symbol = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);
const Fields = z.union([z.string(), z.array(z.string())]).optional();

export const PANDA_CONTRACTS = {
  get_stock_daily: z.object({ start_date: DateString, end_date: DateString, symbol: Symbol.optional(), fields: Fields, indicator: z.string().optional(), st: z.boolean().optional() }).strict(),
  get_fund_daily: z.object({ start_date: DateString, end_date: DateString, symbol: Symbol.optional(), fields: Fields }).strict(),
  get_index_daily: z.object({ start_date: DateString, end_date: DateString, symbol: Symbol.optional(), fields: Fields }).strict(),
  get_us_daily: z.object({ start_date: DateString, end_date: DateString, symbol: Symbol.optional(), fields: Fields }).strict(),
  get_hk_daily: z.object({ start_date: DateString, end_date: DateString, symbol: Symbol.optional(), fields: Fields }).strict(),
  get_stock_detail: z.object({ symbol: Symbol.optional(), fields: Fields, status: z.number().int().min(-1).max(1).optional() }).strict(),
  get_fund_detail: z.object({ symbol: Symbol.optional(), exchange: Symbol.optional(), type: Symbol.optional(), operation_mode: Symbol.optional(), etf_lof_type: Symbol.optional(), is_class_fund: z.union([z.number().int(), z.array(z.number().int())]).optional(), index_fund_type: Symbol.optional(), status: Symbol.optional(), fund_status: Symbol.optional(), fields: Fields }).strict(),
  get_index_detail: z.object({ symbol: Symbol.optional(), fields: Fields, status: z.number().int().min(-1).max(1).optional() }).strict(),
  get_index_indicator: z.object({ symbol: Symbol.optional(), start_date: DateString.optional(), end_date: DateString.optional(), fields: Fields }).strict(),
  get_fina_reports: z.object({ symbol: Symbol.optional(), start_quarter: z.string().regex(/^\d{4}q[1-4]$/), end_quarter: z.string().regex(/^\d{4}q[1-4]$/), date: DateString.optional(), is_latest: z.boolean().optional(), fields: Fields }).strict(),
} as const;

export type PandaDataMethod = keyof typeof PANDA_CONTRACTS;

export function validatePandaContract(method: PandaDataMethod, params: Record<string, unknown>): Record<string, unknown> {
  const parsed = PANDA_CONTRACTS[method].safeParse(params);
  if (!parsed.success) throw new Error(`PANDADATA_CONTRACT_INVALID: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export function getPandaContractExcerpt(method: PandaDataMethod): string {
  const skillRoot = resolvePandaSkillRoot();
  const index = readFileSync(path.join(skillRoot, "references", "method-index.md"), "utf8");
  const match = index.match(new RegExp("^\\\\| [^|]+ \\\\| [^|]+ \\\\| `" + method + "` \\\\| [^|]+ \\\\| (\\\\d+) \\\\|$", "m"));
  if (!match) throw new Error(`PANDADATA_CONTRACT_MISSING: ${method}`);
  const docs = readFileSync(path.join(skillRoot, "references", "api-docs.md"), "utf8").split(/\r?\n/);
  return docs.slice(Number(match[1]) - 1, Number(match[1]) + 110).join("\n");
}

export function resolvePandaSkillRoot(): string {
  const candidates = [
    path.join(/* turbopackIgnore: true */ process.cwd(), ".agents", "skills", "pandadata-api"),
    path.join(/* turbopackIgnore: true */ process.cwd(), ".codex", "skills", "pandadata-api"),
  ];
  const root = candidates.find((candidate) => {
    try {
      readFileSync(path.join(candidate, "SKILL.md"), "utf8");
      return true;
    } catch {
      return false;
    }
  });
  if (!root) throw new Error("PANDADATA_SKILL_MISSING: bundled pandadata-api skill was not found");
  return root;
}
