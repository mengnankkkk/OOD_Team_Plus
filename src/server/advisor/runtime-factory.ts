import { DeterministicAdvisorRuntime } from "@/server/advisor/fallback-runtime";
import { MastraAdvisorAgentRuntime, type AdvisorAgentRuntime } from "@/server/advisor/agents";
import type { AdvisorStore } from "@/server/advisor/store";

export function createAdvisorAgentRuntime(store?: AdvisorStore): AdvisorAgentRuntime {
  return process.env.DEEPSEEK_API_KEY?.trim()
    ? new MastraAdvisorAgentRuntime()
    : new DeterministicAdvisorRuntime(store);
}
