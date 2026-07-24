import type { SearchFilters, SearchResult } from "./web-adapter";
import fs from "node:fs";
import path from "node:path";

export async function searchKnowledgeBase(query: string, filters: SearchFilters = {}): Promise<SearchResult[]> {
  const root = path.resolve(process.cwd(), "docs");
  if (!fs.existsSync(root)) return [];
  const terms = query.toLowerCase().split(/\s+/u).filter(Boolean);
  const results: SearchResult[] = [];
  for (const file of walkMarkdown(root).slice(0, 100)) {
    const text = fs.readFileSync(file, "utf8");
    const lower = text.toLowerCase();
    if (!terms.some((term) => lower.includes(term))) continue;
    const index = Math.max(0, lower.indexOf(terms[0] ?? ""));
    results.push({ title: path.basename(file), url: `kb://${path.relative(root, file).replaceAll("\\", "/")}`, snippet: text.slice(index, index + 500).replace(/\s+/gu, " ").trim(), source: "KNOWLEDGE_BASE" });
  }
  return results.slice(0, Math.min(Math.max(filters.limit ?? 5, 1), 20));
}

function walkMarkdown(directory: string): string[] { const files: string[] = []; for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const full = path.join(directory, entry.name); if (entry.isDirectory()) files.push(...walkMarkdown(full)); else if (/\.md$/iu.test(entry.name)) files.push(full); } return files; }
