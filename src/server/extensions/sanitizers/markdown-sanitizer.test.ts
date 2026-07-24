import { describe, expect, it } from "vitest";

import { MAX_MARKDOWN_BYTES, sanitizeMarkdown } from "./markdown-sanitizer";

describe("sanitizeMarkdown", () => {
  it("strips HTML tags", () => {
    const result = sanitizeMarkdown("# Title <script>alert(1)</script> body");

    expect(result.valid).toBe(true);
    expect(result.sanitized).toBe("# Title alert(1) body");
  });

  it("rejects javascript links", () => {
    const result = sanitizeMarkdown("[click](javascript:alert(1))");

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("javascript: links are not allowed");
  });

  it("accepts valid markdown", () => {
    const result = sanitizeMarkdown("[Docs](https://example.com) **bold**");

    expect(result.valid).toBe(true);
    expect(result.sanitized).toBe("[Docs](https://example.com) **bold**");
  });

  it("rejects content larger than 1 MiB", () => {
    const result = sanitizeMarkdown("x".repeat(MAX_MARKDOWN_BYTES + 1));

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Markdown exceeds 1 MiB limit");
  });
});
