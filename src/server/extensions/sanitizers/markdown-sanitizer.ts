const MAX_MARKDOWN_BYTES = 1024 * 1024; // 1 MiB

export interface MarkdownSanitizeResult {
  valid: boolean;
  sanitized?: string;
  errors: string[];
}

export function sanitizeMarkdown(rawMarkdown: string): MarkdownSanitizeResult {
  if (typeof rawMarkdown !== "string") {
    return { valid: false, errors: ["Markdown must be a string"] };
  }

  if (Buffer.byteLength(rawMarkdown, "utf8") > MAX_MARKDOWN_BYTES) {
    return { valid: false, errors: ["Markdown exceeds 1 MiB limit"] };
  }

  if (/\[.*?\]\(javascript:/i.test(rawMarkdown)) {
    return { valid: false, errors: ["javascript: links are not allowed"] };
  }

  const withoutHtml = rawMarkdown.replace(/<[^>]*>/g, "");
  const sanitized = withoutHtml.replace(/\[([^\]]*)\]\((?!https?:\/\/)([^)]*)\)/g, "[$1](#)");

  return { valid: true, sanitized, errors: [] };
}

export { MAX_MARKDOWN_BYTES };
