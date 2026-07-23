import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "src/**/*.test.ts"],
    // better-sqlite3 is a native addon — must run in vmForks, not threads
    pool: "vmForks",
    maxWorkers: 1,
    fileParallelism: false,
  },
});
