export type ActiveRun = {
  controller: AbortController;
  promise: Promise<unknown>;
};

const globalRuns = globalThis as typeof globalThis & { moneyWhispererActiveRuns?: Map<string, ActiveRun> };
export const activeRuns = globalRuns.moneyWhispererActiveRuns ?? new Map<string, ActiveRun>();
if (process.env.NODE_ENV !== "production") globalRuns.moneyWhispererActiveRuns = activeRuns;
