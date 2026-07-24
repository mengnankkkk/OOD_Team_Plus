import { sb } from "@/services/supabaseClient";
import { supabase } from "@/integrations/supabase/client";
import type { AssetClass, Holding, HoldingInput } from "@/types/app/asset";

const mapRow = (row: any): Holding => ({
  id: row.id,
  userId: row.user_id,
  accountId: row.account_id,
  goalId: row.goal_id,
  symbol: row.symbol,
  name: row.name,
  assetClass: row.asset_class as AssetClass,
  industry: row.industry,
  quantity: Number(row.quantity ?? 0),
  costBasis: Number(row.cost_basis ?? 0),
  currentPrice: Number(row.current_price ?? 0),
  marketValue: Number(row.market_value ?? 0),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function listHoldings(userId: string, opts?: { page?: number; pageSize?: number }): Promise<Holding[]> {
  const page = opts?.page ?? 0;
  const size = opts?.pageSize ?? 100;
  const from = page * size;
  const to = from + size - 1;
  const { data, error } = await sb
    .from("holdings")
    .select("*")
    .eq("user_id", userId)
    .order("market_value", { ascending: false })
    .range(from, to);
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function createHolding(userId: string, input: HoldingInput): Promise<Holding> {
  const symbol = (input.symbol && input.symbol.trim()) || input.name.trim();
  const { data, error } = await sb
    .from("holdings")
    .insert({
      user_id: userId,
      account_id: input.accountId ?? null,
      goal_id: input.goalId ?? null,
      symbol,
      name: input.name.trim(),
      asset_class: input.assetClass,
      industry: input.industry ?? null,
      quantity: input.quantity,
      cost_basis: input.costBasis ?? 0,
      current_price: input.currentPrice,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function updateHolding(userId: string, id: string, changes: Partial<HoldingInput>): Promise<Holding> {
  const payload: Record<string, unknown> = {};
  if (changes.name !== undefined) payload.name = changes.name;
  if (changes.symbol !== undefined) payload.symbol = changes.symbol;
  if (changes.assetClass !== undefined) payload.asset_class = changes.assetClass;
  if (changes.industry !== undefined) payload.industry = changes.industry;
  if (changes.quantity !== undefined) payload.quantity = changes.quantity;
  if (changes.costBasis !== undefined) payload.cost_basis = changes.costBasis;
  if (changes.currentPrice !== undefined) payload.current_price = changes.currentPrice;
  if (changes.goalId !== undefined) payload.goal_id = changes.goalId;
  const { data, error } = await sb
    .from("holdings")
    .update(payload)
    .eq("user_id", userId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function deleteHolding(userId: string, id: string): Promise<void> {
  const { error } = await sb.from("holdings").delete().eq("user_id", userId).eq("id", id);
  if (error) throw error;
}

export async function bulkCreateHoldings(userId: string, inputs: HoldingInput[]): Promise<number> {
  if (!inputs.length) return 0;
  const rows = inputs.map((input) => ({
    user_id: userId,
    account_id: input.accountId ?? null,
    goal_id: input.goalId ?? null,
    symbol: (input.symbol && input.symbol.trim()) || input.name.trim(),
    name: input.name.trim(),
    asset_class: input.assetClass,
    industry: input.industry ?? null,
    quantity: input.quantity,
    cost_basis: input.costBasis ?? 0,
    current_price: input.currentPrice,
  }));
  const { data, error } = await sb.from("holdings").insert(rows).select("id");
  if (error) throw error;
  return (data ?? []).length;
}

export async function parseHoldingsCsv(csvText: string): Promise<HoldingInput[]> {
  const { data, error } = await supabase.functions.invoke("holdings-import", { body: { csv: csvText } });
  if (error) throw error;
  return (data as { holdings: HoldingInput[] })?.holdings ?? [];
}
