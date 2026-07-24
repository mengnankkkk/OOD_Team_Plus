import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "src/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
  },
});
