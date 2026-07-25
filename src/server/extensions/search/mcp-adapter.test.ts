import { afterEach, describe, expect, it, vi } from "vitest";

import { searchMCP } from "./mcp-adapter";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("searchMCP", () => {
  it("normalizes Firecrawl data.web results", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
    vi.stubEnv("FIRECRAWL_SEARCH_URL", "https://firecrawl.test/search");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: {
        web: [{
          title: "公司业绩公告",
          url: "https://example.com/earnings",
          description: "公司发布最新业绩公告。",
        }],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(searchMCP("公司业绩", { limit: 3 })).resolves.toEqual([{
      title: "公司业绩公告",
      url: "https://example.com/earnings",
      snippet: "公司发布最新业绩公告。",
      source: "MCP",
    }]);
  });

  it("parses MCP content that contains JSON search results", async () => {
    vi.stubEnv("MCP_SEARCH_URL", "https://mcp.test/search");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      content: [{
        type: "text",
        text: JSON.stringify({
          results: [{
            title: "行业新闻",
            link: "https://example.com/news",
            summary: "行业需求出现变化。",
          }],
        }),
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(searchMCP("行业新闻", { limit: 3 })).resolves.toEqual([{
      title: "行业新闻",
      url: "https://example.com/news",
      snippet: "行业需求出现变化。",
      source: "MCP",
    }]);
  });

  it("reports configuration errors instead of turning them into empty evidence", async () => {
    await expect(searchMCP("基本面")).rejects.toThrow("MCP_NOT_CONFIGURED");
  });
});
