import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPragma, mockClose, mockExec, mockDatabase, mockMkdirSync } = vi.hoisted(() => ({
  mockPragma: vi.fn().mockReturnThis(),
  mockClose: vi.fn(),
  mockExec: vi.fn(),
  mockDatabase: function MockDatabase(this: unknown) {
    return {
      pragma: mockPragma,
      close: mockClose,
      exec: mockExec,
    };
  },
  mockMkdirSync: vi.fn(),
}));

vi.mock("better-sqlite3", () => ({
  default: vi.fn(mockDatabase),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    mkdirSync: mockMkdirSync,
  };
});

import { getDbClient } from "./client.runtime";

describe("getDbClient", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.stubEnv("DB_PATH", ":memory:");
  });

  it("calls pragma with foreign_keys = ON", () => {
    getDbClient();
    expect(mockPragma).toHaveBeenCalledWith("foreign_keys = ON");
  });

  it("calls pragma with journal_mode = WAL", () => {
    getDbClient();
    expect(mockPragma).toHaveBeenCalledWith("journal_mode = WAL");
  });

  it("calls pragma with synchronous = NORMAL", () => {
    getDbClient();
    expect(mockPragma).toHaveBeenCalledWith("synchronous = NORMAL");
  });

  it("calls pragma with busy_timeout = 5000", () => {
    getDbClient();
    expect(mockPragma).toHaveBeenCalledWith("busy_timeout = 5000");
  });
});
