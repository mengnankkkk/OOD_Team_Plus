import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

import { spawn } from "node:child_process";

import { callPandaData } from "@/server/extensions/pandadata/adapter";

function mockProcess(stdout: string, code = 0): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  child.stdout = new EventEmitter() as ChildProcessWithoutNullStreams["stdout"];
  child.stderr = new EventEmitter() as ChildProcessWithoutNullStreams["stderr"];

  queueMicrotask(() => {
    child.stdout.emit("data", Buffer.from(stdout));
    child.emit("close", code);
  });
  return child;
}

describe("callPandaData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects methods outside the whitelist", async () => {
    // @ts-expect-error Deliberately exercise the runtime trust boundary.
    await expect(callPandaData("drop_table", {})).rejects.toMatchObject({
      code: "PANDA_DATA_UNAVAILABLE",
      retryable: false,
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("spawns Python with method and serialized parameters", async () => {
    vi.mocked(spawn).mockReturnValue(mockProcess("[]"));

    const result = await callPandaData(
      "get_stock_daily",
      { symbol: ["000001.SZ"] },
      { pythonPath: "python-test" },
    );

    expect(result).toMatchObject({ data: [], method: "get_stock_daily" });
    expect(spawn).toHaveBeenCalledWith(
      "python-test",
      [expect.stringContaining("call_api.py"), "get_stock_daily", '{"symbol":["000001.SZ"]}'],
      expect.objectContaining({ env: process.env, timeout: 30_000 }),
    );
  });

  it("maps bridge failures to extension errors", async () => {
    vi.mocked(spawn).mockReturnValue(mockProcess('{"error":"missing credentials","retryable":false}', 1));

    await expect(callPandaData("get_fund_daily", {})).rejects.toMatchObject({
      code: "PANDA_DATA_UNAVAILABLE",
      message: "missing credentials",
      retryable: false,
    });
  });

  it("rejects invalid successful output", async () => {
    vi.mocked(spawn).mockReturnValue(mockProcess("not-json"));

    await expect(callPandaData("get_index_daily", {})).rejects.toMatchObject({
      code: "PANDA_DATA_UNAVAILABLE",
      message: "PandaData returned invalid JSON",
      retryable: true,
    });
  });
});
