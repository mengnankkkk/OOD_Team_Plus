import { existsSync, writeFileSync } from "node:fs";

import {
  createExternalClientIdempotently,
  rotateExternalClientTokenIdempotently,
} from "../../src/server/a2a/client-idempotency-service";
import type { A2ACapability } from "../../src/server/a2a/contracts";

type WorkerConfig = {
  operation: "create" | "rotate";
  actorUserId: string;
  idempotencyKey: string;
  readyPath: string;
  releasePath: string;
  clientId?: string;
  input?: {
    name: string;
    capabilities: A2ACapability[];
    rateLimitPerMinute: number;
  };
};

void main();

async function main(): Promise<void> {
  const config = parseConfig(process.argv[2]);
  writeFileSync(config.readyPath, String(process.pid), { flag: "wx" });
  await waitForRelease(config.releasePath);

  const responseMeta = {
    requestId: `worker-${process.pid}`,
    apiVersion: "v1",
    generatedAt: new Date().toISOString(),
  };
  if (config.operation === "create") {
    const result = createExternalClientIdempotently(
      config.actorUserId,
      requireCreateInput(config),
      { key: config.idempotencyKey, responseMeta },
    );
    const response = result.kind === "live"
      ? {
          pid: process.pid,
          kind: result.kind,
          clientId: result.value.client.id,
          hasToken: Boolean(result.value.token),
        }
      : {
          pid: process.pid,
          kind: result.kind,
          clientId: replayClientId(result.response),
          hasToken: false,
        };
    process.stdout.write(`${JSON.stringify(response)}\n`);
    return;
  }

  const result = rotateExternalClientTokenIdempotently(
    config.actorUserId,
    requireClientId(config),
    { key: config.idempotencyKey, responseMeta },
  );
  const response = result.kind === "live"
    ? {
        pid: process.pid,
        kind: result.kind,
        tokenPrefix: result.value.tokenPrefix,
        hasToken: Boolean(result.value.token),
      }
    : {
        pid: process.pid,
        kind: result.kind,
        tokenPrefix: replayTokenPrefix(result.response),
        hasToken: false,
      };
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function parseConfig(value: string | undefined): WorkerConfig {
  if (!value) throw new Error("Worker configuration is required");
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as WorkerConfig;
}

function requireCreateInput(config: WorkerConfig) {
  if (!config.input) throw new Error("Create input is required");
  return config.input;
}

function requireClientId(config: WorkerConfig): string {
  if (!config.clientId) throw new Error("Client id is required");
  return config.clientId;
}

function replayClientId(response: unknown): string {
  return String((response as { data?: { client?: { id?: unknown } } }).data?.client?.id ?? "");
}

function replayTokenPrefix(response: unknown): string {
  return String((response as { data?: { tokenPrefix?: unknown } }).data?.tokenPrefix ?? "");
}

async function waitForRelease(releasePath: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!existsSync(releasePath)) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for release barrier");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
