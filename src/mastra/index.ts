import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";

import { createSupervisorAgent } from "@/mastra/agents/supervisor";

export function createMastraRuntime() {
  const storage = new LibSQLStore({
    id: "money-whisperer-memory",
    url: ":memory:",
  });
  const memory = new Memory({ storage });
  const supervisorAgent = createSupervisorAgent(memory);
  const mastra = new Mastra({
    storage,
    agents: { supervisorAgent },
  });

  return { mastra, memory, storage, supervisorAgent };
}

export type MastraRuntime = ReturnType<typeof createMastraRuntime>;

const globalRuntime = globalThis as typeof globalThis & {
  moneyWhispererRuntime?: MastraRuntime;
};

export const runtime =
  globalRuntime.moneyWhispererRuntime ?? createMastraRuntime();

if (process.env.NODE_ENV !== "production") {
  globalRuntime.moneyWhispererRuntime = runtime;
}

export const { mastra, memory, supervisorAgent } = runtime;
