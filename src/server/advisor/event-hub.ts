import type { AdvisorEvent } from "@/server/advisor/types";

type Listener = (event: AdvisorEvent) => void;

export class AdvisorEventHub {
  private readonly listeners = new Map<string, Set<Listener>>();

  subscribe(analysisId: string, listener: Listener) {
    const listeners = this.listeners.get(analysisId) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(analysisId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(analysisId);
    };
  }

  publish(event: AdvisorEvent) {
    for (const listener of this.listeners.get(event.analysisId) ?? []) listener(event);
  }
}

const globalHub = globalThis as typeof globalThis & { moneyWhispererAdvisorEventHub?: AdvisorEventHub };
export const advisorEventHub = globalHub.moneyWhispererAdvisorEventHub ?? new AdvisorEventHub();
if (process.env.NODE_ENV !== "production") globalHub.moneyWhispererAdvisorEventHub = advisorEventHub;
