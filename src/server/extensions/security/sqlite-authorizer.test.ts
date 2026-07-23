import { describe, expect, it, vi } from "vitest";

vi.mock("better-sqlite3", () => ({ default: vi.fn() }));

import { ALLOWED_READ_TABLES, applyReadOnlyAuthorizer } from "./sqlite-authorizer";

type Authorizer = (
  action: number,
  arg1: string | null,
  arg2: string | null,
  databaseName: string | null,
  triggerName: string | null,
) => number;

describe("applyReadOnlyAuthorizer", () => {
  it("calls db.authorizer with a function", () => {
    const authorizer = vi.fn();
    const database = { authorizer };

    applyReadOnlyAuthorizer(database);

    expect(authorizer).toHaveBeenCalledWith(expect.any(Function));
  });

  it("allows SELECT and reads from whitelisted tables", () => {
    const callback = captureAuthorizer();

    expect(callback(21, null, null, null, null)).toBe(0);
    expect(callback(20, "portfolio_snapshots", "id", "main", null)).toBe(0);
    expect(callback(20, "PORTFOLIO_SNAPSHOTS", "id", "main", null)).toBe(0);
  });

  it("denies writes and reads from non-whitelisted tables", () => {
    const callback = captureAuthorizer();

    expect(callback(18, "users", null, "main", null)).toBe(1);
    expect(callback(20, "users", "password", "main", null)).toBe(1);
    expect(callback(19, "user_version", null, null, null)).toBe(1);
  });

  it("allows only whitelisted functions", () => {
    const callback = captureAuthorizer();

    expect(callback(31, null, "count", null, null)).toBe(0);
    expect(callback(31, null, "load_extension", null, null)).toBe(1);
  });

  it("accepts a custom table whitelist", () => {
    const callback = captureAuthorizer(new Set(["safe_view"]));

    expect(callback(20, "safe_view", "id", "main", null)).toBe(0);
    expect(callback(20, "portfolio_snapshots", "id", "main", null)).toBe(1);
  });
});

function captureAuthorizer(allowedTables: ReadonlySet<string> = ALLOWED_READ_TABLES): Authorizer {
  let callback: Authorizer | undefined;
  const database = {
    authorizer(authorizer: Authorizer): void {
      callback = authorizer;
    },
  };

  applyReadOnlyAuthorizer(database, allowedTables);
  if (!callback) throw new Error("Authorizer callback was not registered");
  return callback;
}
