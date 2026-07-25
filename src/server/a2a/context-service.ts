/* eslint-disable max-lines */

import Decimal from "decimal.js";

import {
  A2APublicError,
  ExternalGoalSchema,
  ExternalPortfolioSchema,
  ExternalProfileSchema,
  capabilityFamily,
  type A2AContextView,
  type CapabilityId,
  type ExternalGoal,
  type ExternalPortfolio,
  type ExternalProfile,
} from "./contracts";
import {
  resolveExternalPortfolio,
  type ResolvedExternalHolding,
} from "./external-market-data";
import { createId, getDatabase, isoNow, parseJson } from "@/server/http/context";

type ContextRow = {
  id: string;
  external_client_id: string;
  execution_user_id: string;
  primary_capability: CapabilityId;
  status: A2AContextView["status"];
  profile_json: string;
  goals_json: string;
  portfolio_input_json: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
};

type ResolvedPortfolio = {
  cash: string;
  holdings: ResolvedExternalHolding[];
  dataAsOf: string;
};

export async function createA2AContext(input: {
  externalClientId: string;
  capabilityId: CapabilityId;
  requestedContextId?: string;
  profile?: ExternalProfile;
  goals?: ExternalGoal[];
  portfolio?: ExternalPortfolio;
  resolvePortfolio?: (portfolio: ExternalPortfolio) => Promise<ResolvedPortfolio>;
}): Promise<{ contextId: string; executionUserId: string; portfolioSnapshotId: string | null }> {
  const profile = ExternalProfileSchema.parse(input.profile ?? {});
  const goals = (input.goals ?? []).map((goal) => ExternalGoalSchema.parse(goal));
  const portfolio = input.portfolio ? ExternalPortfolioSchema.parse(input.portfolio) : null;
  const resolved = portfolio
    ? await (input.resolvePortfolio ?? resolveExternalPortfolio)(portfolio)
    : null;
  const contextId = input.requestedContextId?.trim() || createId("a2a_context");
  const executionUserId = createId("a2a_exec");
  const now = isoNow();
  const expiresAt = new Date(Date.parse(now) + 30 * 86_400_000).toISOString();
  const db = getDatabase();
  let snapshotId: string | null = null;
  try {
    const transaction = db.transaction(() => {
      db.prepare(`INSERT INTO users
        (id,username,username_normalized,password_hash,display_name,role,status,force_password_change,created_at,updated_at,row_version)
        VALUES (?,NULL,NULL,NULL,'A2A External Context','USER','ACTIVE',0,?,?,1)`).run(
        executionUserId,
        now,
        now,
      );
      db.prepare(`INSERT INTO a2a_contexts
        (id,external_client_id,execution_user_id,primary_capability,status,profile_json,goals_json,portfolio_input_json,created_at,updated_at,expires_at)
        VALUES (?,?,?,?,'ACTIVE',?,?,?,?,?,?)`).run(
        contextId,
        input.externalClientId,
        executionUserId,
        input.capabilityId,
        JSON.stringify(profile),
        JSON.stringify(goals),
        JSON.stringify(portfolio ?? {}),
        now,
        now,
        expiresAt,
      );
      persistProfile(db, executionUserId, profile, now);
      persistGoals(db, executionUserId, goals, now);
      if (resolved) snapshotId = persistPortfolio(db, contextId, executionUserId, resolved, now);
    });
    transaction();
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed: a2a_contexts.id")) {
      throw new A2APublicError("CONTEXT_ALREADY_EXISTS", 409, "Context already exists");
    }
    throw error;
  } finally {
    db.close();
  }
  return { contextId, executionUserId, portfolioSnapshotId: snapshotId };
}

export function getA2AContext(externalClientId: string, contextId: string): A2AContextView | null {
  const db = getDatabase();
  try {
    const row = db.prepare(`SELECT * FROM a2a_contexts
      WHERE id=? AND external_client_id=? AND deleted_at IS NULL`).get(
      contextId,
      externalClientId,
    ) as ContextRow | undefined;
    if (!row) return null;
    const snapshot = db.prepare(`SELECT id FROM portfolio_snapshots
      WHERE user_id=? AND portfolio_id=? ORDER BY created_at DESC LIMIT 1`).get(
      row.execution_user_id,
      portfolioId(row.id),
    ) as { id?: string } | undefined;
    const rawPortfolio = parseJson<Record<string, unknown>>(row.portfolio_input_json, {});
    return {
      id: row.id,
      externalClientId: row.external_client_id,
      executionUserId: row.execution_user_id,
      primaryCapability: row.primary_capability,
      status: row.status,
      profile: ExternalProfileSchema.parse(parseJson(row.profile_json, {})),
      goals: ExternalGoalSchema.array().parse(parseJson(row.goals_json, [])),
      portfolioInput: Object.keys(rawPortfolio).length
        ? ExternalPortfolioSchema.parse(rawPortfolio)
        : null,
      portfolioSnapshotId: snapshot?.id ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
    };
  } finally {
    db.close();
  }
}

export function getA2AContextOwner(contextId: string): string | null {
  const db = getDatabase();
  try {
    const row = db.prepare("SELECT external_client_id FROM a2a_contexts WHERE id=?")
      .get(contextId) as { external_client_id?: string } | undefined;
    return row?.external_client_id ?? null;
  } finally {
    db.close();
  }
}

export function requireA2AContext(externalClientId: string, contextId: string): A2AContextView {
  const context = getA2AContext(externalClientId, contextId);
  if (!context) throw new A2APublicError("CONTEXT_NOT_FOUND", 404, "Context not found");
  if (context.status === "EXPIRED" || Date.parse(context.expiresAt) <= Date.now()) {
    throw new A2APublicError("CONTEXT_EXPIRED", 410, "Context has expired");
  }
  return context;
}

export function requireCompatibleA2AContext(
  externalClientId: string,
  contextId: string,
  requestedCapability: CapabilityId,
): A2AContextView {
  const context = requireA2AContext(externalClientId, contextId);
  if (capabilityFamily(context.primaryCapability) !== capabilityFamily(requestedCapability)) {
    throw new A2APublicError(
      "CONTEXT_CAPABILITY_MISMATCH",
      409,
      "CONTEXT_CAPABILITY_MISMATCH",
    );
  }
  return context;
}

function persistProfile(
  db: ReturnType<typeof getDatabase>,
  userId: string,
  profile: ExternalProfile,
  now: string,
): void {
  if (!Object.keys(profile).length) return;
  db.prepare(`INSERT INTO user_profiles
    (id,user_id,risk_level,investment_amount_decimal,horizon,max_drawdown_decimal,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'completed',?,?)`).run(
    createId("profile"),
    userId,
    profile.riskLevel ?? null,
    profile.investmentAmount ?? null,
    profile.horizon ?? null,
    profile.maxDrawdown ?? null,
    now,
    now,
  );
}

function persistGoals(
  db: ReturnType<typeof getDatabase>,
  userId: string,
  goals: ExternalGoal[],
  now: string,
): void {
  for (const goal of goals) {
    db.prepare(`INSERT INTO goals
      (id,user_id,name,target_amount_decimal,target_date,horizon,priority,asset_preference,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'active',?,?)`).run(
      createId("goal"),
      userId,
      goal.name,
      goal.targetAmount,
      goal.targetDate ?? null,
      goal.horizon,
      goal.priority,
      goal.assetPreference ?? null,
      now,
      now,
    );
  }
}

function persistPortfolio(
  db: ReturnType<typeof getDatabase>,
  contextId: string,
  userId: string,
  portfolio: ResolvedPortfolio,
  now: string,
): string {
  const snapshotId = createId("portfolio_snapshot");
  const values = portfolio.holdings.map((holding) => new Decimal(holding.quantity).mul(holding.price));
  const total = values.reduce((sum, value) => sum.add(value), new Decimal(0));
  db.prepare(`INSERT INTO portfolio_snapshots
    (id,user_id,portfolio_id,cash_decimal,total_market_value_decimal,data_quality,source_statuses_json,as_of,created_at)
    VALUES (?,?,?,?,?,'complete',?,?,?)`).run(
    snapshotId,
    userId,
    portfolioId(contextId),
    portfolio.cash,
    total.toString(),
    JSON.stringify([{ source: "PANDADATA", status: "SUCCEEDED", dataAsOf: portfolio.dataAsOf }]),
    portfolio.dataAsOf,
    now,
  );
  portfolio.holdings.forEach((holding, index) => {
    const marketValue = values[index];
    const unrealizedPnl = marketValue.sub(new Decimal(holding.quantity).mul(holding.cost));
    const weightBps = total.isZero() ? 0 : marketValue.div(total).mul(10_000).round().toNumber();
    db.prepare(`INSERT INTO holding_snapshots
      (id,portfolio_snapshot_id,instrument_id,quantity_decimal,cost_decimal,price_decimal,market_value_decimal,unrealized_pnl_decimal,weight_bps,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      createId("holding_snapshot"),
      snapshotId,
      holding.instrumentId,
      holding.quantity,
      holding.cost,
      holding.price,
      marketValue.toString(),
      unrealizedPnl.toString(),
      weightBps,
      now,
    );
  });
  return snapshotId;
}

function portfolioId(contextId: string): string {
  return `a2a:${contextId}`;
}
