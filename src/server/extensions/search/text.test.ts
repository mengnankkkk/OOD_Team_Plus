import { describe, expect, it } from "vitest";

import { sanitizeResearchText } from "./text";

describe("sanitizeResearchText", () => {
  it("removes markdown tables, image placeholders and raw headings from search snippets", () => {
    const value = sanitizeResearchText(
      "## 688256 实时股价 暂无内容；寒武纪688256-|||||今开- |昨收- |最高价- |最低价- |动态市盈率- |市净率- | ![](#) 最新新闻：公司将发布业绩公告。",
    );

    expect(value).not.toContain("|");
    expect(value).not.toContain("![](#)");
    expect(value).not.toContain("##");
    expect(value).not.toContain("今开-");
    expect(value).toContain("行情字段暂无完整数据");
    expect(value).toContain("最新新闻");
  });
});
