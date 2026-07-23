import type { MastraDBMessage } from "@mastra/core/agent";
import { afterEach, describe, expect, it } from "vitest";

import { createMastraRuntime, runtime } from "@/mastra";
import { getDisplayHistory } from "@/server/chat/history";

const openRuntimes: ReturnType<typeof createMastraRuntime>[] = [];

function message(threadId: string, resourceId: string): MastraDBMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    createdAt: new Date(),
    threadId,
    resourceId,
    content: { format: 2, parts: [{ type: "text", text: "thread fact" }] },
  };
}

afterEach(async () => {
  await Promise.all(openRuntimes.splice(0).map(({ storage }) => storage.close()));
});

describe("Mastra runtime", () => {
  it("keeps one exported singleton and registers the supervisor", () => {
    expect(runtime.mastra.getAgent("supervisorAgent")).toBe(runtime.supervisorAgent);
    expect(runtime.supervisorAgent.id).toBe("supervisor-agent");
  });

  it("returns empty display history for a new session", async () => {
    await expect(
      getDisplayHistory({
        thread: crypto.randomUUID(),
        resource: crypto.randomUUID(),
      }),
    ).resolves.toEqual([]);
  });

  it("remembers a thread and isolates another thread", async () => {
    const local = createMastraRuntime();
    openRuntimes.push(local);
    const resourceId = crypto.randomUUID();
    const firstThread = crypto.randomUUID();
    const secondThread = crypto.randomUUID();

    await local.memory.saveThread({
      thread: {
        id: firstThread,
        title: "test thread",
        resourceId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await local.memory.saveThread({
      thread: {
        id: secondThread,
        title: "isolated thread",
        resourceId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await local.memory.saveMessages({
      messages: [message(firstThread, resourceId)],
    });

    const remembered = await local.memory.recall({
      threadId: firstThread,
      resourceId,
    });
    const isolated = await local.memory.recall({
      threadId: secondThread,
      resourceId,
    });

    expect(remembered.messages).toHaveLength(1);
    expect(isolated.messages).toHaveLength(0);
  });
});
