import { access } from "node:fs/promises";

import { PandadataAdapter, hasActionablePandadata } from "@/server/advisor/pandadata";
import { getPandadataEnvironment } from "@/server/advisor/pandadata-environment";
import { compactDate, dateDaysAgo } from "@/server/advisor/date-utils";
import { DEMO_SEED_VERSION, DEMO_USER_ID } from "@/server/advisor/seed";
import type { AdvisorStore } from "@/server/advisor/store";
import { activeRuns } from "@/server/advisor/active-runs";
import { probeDeepSeekHealth } from "@/server/advisor/model-health";

export class SystemService {
  constructor(private readonly store: AdvisorStore) {}

  bootstrap() {
    const recommendations = this.store.listRecommendations();
    return {
      seedVersion: DEMO_SEED_VERSION,
      user: this.store.profile.getUser(DEMO_USER_ID),
      profile: this.store.profile.getProfile(DEMO_USER_ID),
      goals: this.store.profile.listGoals(DEMO_USER_ID),
      holdings: this.store.holdings.listHoldings(DEMO_USER_ID),
      watchlist: this.store.watchlist.list(DEMO_USER_ID),
      conversations: this.store.conversations.list(DEMO_USER_ID),
      recommendations,
      activeRunCount: activeRuns.size,
    };
  }

  async health() {
    const database = this.store.database.prepare("SELECT 1 AS ok").get() as { ok?: number } | undefined;
    const adapter = new PandadataAdapter();
    const [probe, model] = await Promise.all([
      adapter.fetch("get_stock_daily", {
        symbol: ["000001.SZ"],
        start_date: compactDate(dateDaysAgo(7)),
        end_date: compactDate(),
        fields: [],
      }),
      probeDeepSeekHealth(),
    ]);
    const pandadataEnvironment = getPandadataEnvironment();
    const pandadataReady = hasActionablePandadata(probe);
    const skillPath = process.env.PANDADATA_SKILL_ROOT?.trim() || ".codex/skills/pandadata-api";
    let skillPresent = false;
    try {
      await access(skillPath);
      skillPresent = true;
    } catch {
      skillPresent = false;
    }
    return {
      status: database?.ok === 1 && model.reachable && pandadataReady ? "OK" : "DEGRADED",
      components: {
        sqlite: { status: database?.ok === 1 ? "UP" : "DOWN" },
        model,
        pandadata: {
          configured: pandadataEnvironment.credentialsConfigured,
          credentialsConfigured: pandadataEnvironment.credentialsConfigured,
          usernameValid: pandadataEnvironment.usernameValid,
          reachable: probe.liveCallSucceeded,
          fresh: probe.liveDataFresh,
          contractValidated: probe.contractValidated,
          errorCode: probe.errorCode ?? null,
        },
        pandadataSkill: { present: skillPresent },
        fixtureFallback: { enabled: true, explicit: true },
      },
      activeRuns: activeRuns.size,
      seedVersion: DEMO_SEED_VERSION,
    };
  }

  reset() {
    for (const run of activeRuns.values()) run.controller.abort();
    activeRuns.clear();
    this.store.resetDemo();
    return {
      reset: this.store.recordDemoReset(DEMO_SEED_VERSION),
      bootstrap: this.bootstrap(),
    };
  }
}
