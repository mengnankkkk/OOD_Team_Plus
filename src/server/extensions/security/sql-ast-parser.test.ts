import { describe, expect, it } from "vitest";

import { validateSql } from "./sql-ast-parser";

describe("validateSql", () => {
  const tables = new Set(["portfolio_snapshots", "instruments"]);

  it("accepts a valid SELECT", () => {
    expect(validateSql("SELECT id FROM portfolio_snapshots", tables)).toEqual({
      valid: true,
      errors: [],
      statementType: "select",
    });
  });

  it("accepts a trailing statement terminator", () => {
    expect(validateSql("SELECT id FROM instruments;", tables).valid).toBe(true);
  });

  it("accepts whitelisted functions", () => {
    expect(validateSql("SELECT COUNT(*) FROM instruments", tables).valid).toBe(true);
  });

  it("rejects multiple statements", () => {
    const result = validateSql("SELECT 1; DROP TABLE users", tables);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Multiple statements not allowed");
  });

  it("rejects SQL comments", () => {
    const result = validateSql("SELECT 1 -- bypass", tables);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("SQL comments not allowed");
  });

  it("rejects table not in whitelist", () => {
    const result = validateSql("SELECT id FROM users", tables);

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("users");
  });

  it("rejects INSERT statement", () => {
    const result = validateSql("INSERT INTO instruments VALUES ('x')", tables);

    expect(result.valid).toBe(false);
  });

  it("rejects PRAGMA", () => {
    expect(validateSql("PRAGMA user_version", tables).valid).toBe(false);
  });

  it("rejects ATTACH DATABASE", () => {
    expect(validateSql("ATTACH DATABASE '/tmp/evil.db' AS evil", tables).valid).toBe(false);
  });

  it("rejects unapproved functions", () => {
    const result = validateSql("SELECT load_extension('evil') FROM instruments", tables);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Function not in whitelist: load_extension");
  });

  it("does not treat forbidden words inside literals as operations", () => {
    expect(validateSql("SELECT 'updated' FROM instruments", tables).valid).toBe(true);
  });
});
