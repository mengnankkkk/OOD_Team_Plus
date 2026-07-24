import { beforeEach, describe, expect, it, vi } from "vitest";

const execFile = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile }));
vi.mock("node:util", () => ({ promisify: () => execFile }));

import { callPandaData } from "@/server/extensions/pandadata/adapter";

describe("callPandaData", () => {
  beforeEach(() => execFile.mockReset());

  it("rejects methods outside the documented contract catalog", async () => {
    await expect(callPandaData("drop_table" as never, {})).rejects.toMatchObject({
      code: "PANDA_DATA_UNAVAILABLE",
      retryable: false,
    });
    expect(execFile).not.toHaveBeenCalled();
  });

  it("rejects missing required date parameters before starting Python", async () => {
    await expect(callPandaData("get_stock_daily", { symbol: ["000001.SZ"] })).rejects.toMatchObject({
      code: "PANDA_DATA_UNAVAILABLE",
      retryable: false,
    });
    expect(execFile).not.toHaveBeenCalled();
  });

  it("runs dry-run before live call and reports data freshness separately", async () => {
    execFile
      .mockResolvedValueOnce({ stdout: JSON.stringify({ ok: true, dry_run: true }) })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ result: { data: [{ symbol: "000001.SZ", date: "20260724", close: 12.3 }] } }) });

    const result = await callPandaData("get_stock_daily", {
      symbol: ["000001.SZ"], start_date: "20260701", end_date: "20260724", fields: ["symbol", "date", "close"],
    }, { pythonPath: "python-test" });

    expect(result).toMatchObject({ contractValidated: true, dryRunSucceeded: true, liveCallSucceeded: true, fresh: true, asOfDate: "2026-07-24" });
    expect(execFile.mock.calls[0]?.[1]?.[0]).toMatch(/call_api\.py$/u);
    expect(execFile).toHaveBeenNthCalledWith(1, "python-test", expect.arrayContaining(["--dry-run"]), expect.any(Object));
    expect(execFile).toHaveBeenNthCalledWith(2, "python-test", expect.arrayContaining(["--no-setup"]), expect.any(Object));
  });

  it("does not treat successful dry-run as live data", async () => {
    execFile
      .mockResolvedValueOnce({ stdout: JSON.stringify({ ok: true, dry_run: true }) })
      .mockRejectedValueOnce({ stderr: "Runtime setup failed: missing credentials" });

    await expect(callPandaData("get_fund_daily", {
      symbol: ["510050.SH"], start_date: "20260701", end_date: "20260724", fields: [],
    })).rejects.toMatchObject({
      code: "PANDA_DATA_UNAVAILABLE",
      details: { category: "PANDADATA_AUTH_FAILED" },
      retryable: true,
    });
  });
});
