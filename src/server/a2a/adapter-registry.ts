import type { CapabilityAdapter, CapabilityId } from "./contracts";
import { runAdvisorCapability } from "./capabilities/advisor";
import { runDebateCapability } from "./capabilities/debate";
import {
  cancelSimulationCapability,
  runSimulationCapability,
} from "./capabilities/simulation";
import {
  cancelResearchCapability,
  runResearchCapability,
} from "./capabilities/research";

export const capabilityAdapters: Record<CapabilityId, CapabilityAdapter> = {
  chief_advisor_conversation: { run: runAdvisorCapability },
  debate_mode: { run: runDebateCapability },
  scenario_simulation: {
    run: runSimulationCapability,
    cancel: cancelSimulationCapability,
  },
  research_search: {
    run: runResearchCapability,
    cancel: cancelResearchCapability,
  },
};
