import { describe, expect, it } from "vitest";

import {
  classifyLiveCallError,
  latestRows,
  summarizeLiveCallError,
} from "@/server/advisor/pandadata-runtime";

describe("Pandadata runtime errors", () => {
  it("classifies a missing DuckDB Parquet dependency as an SDK dependency issue", () => {
    const error = new Error("响应是 Parquet 格式，但 DuckDB 库未安装。请安装: pip install duckdb");

    expect(classifyLiveCallError(error)).toBe("PANDADATA_SDK_MISSING");
    expect(summarizeLiveCallError(error)).toContain("DuckDB");
  });

  it("keeps the newest market rows when Pandadata returns descending dates", () => {
    expect(latestRows([
      { date: "20260724", close: 1.3 },
      { date: "20260723", close: 1.2 },
      { date: "20260722", close: 1.1 },
    ], 2)).toEqual([
      { date: "20260723", close: 1.2 },
      { date: "20260724", close: 1.3 },
    ]);
  });
});
