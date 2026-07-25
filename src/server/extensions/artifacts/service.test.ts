import { beforeEach, describe, expect, it } from "vitest";

import { TEST_USER_ID, seedAuthenticatedUser } from "@tests/helpers/auth";
import { getDatabase, isoNow } from "@/server/http/context";
import { buildFinancialReportMarkdown } from "@/server/extensions/advisor/service";

import { createArtifact, listArtifacts, previewArtifact } from "./service";

beforeEach(() => {
  seedAuthenticatedUser();
  const db = getDatabase();
  for (const table of ["message_artifacts", "generated_artifact_versions", "generated_artifacts", "messages", "conversation_sessions"]) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
  const now = isoNow();
  db.prepare("INSERT INTO conversation_sessions (id,user_id,title,status,created_at,updated_at) VALUES (?,?,?,'active',?,?)")
    .run("report-conversation", TEST_USER_ID, "资产深度报告", now, now);
  db.prepare("INSERT INTO messages (id,session_id,role,content,created_at) VALUES (?,?,'assistant',?,?)")
    .run("report-message", "report-conversation", "Agent 已完成组合诊断。", now);
  db.close();
});

describe("createArtifact", () => {
  it("stores a readable Chinese report and preserves the linked recommendation", () => {
    const created = createArtifact({
      userId: TEST_USER_ID,
      sessionId: "report-conversation",
      sourceMessageId: "report-message",
      artifactType: "MARKDOWN",
      title: "资产深度报告",
      recommendationId: "report-recommendation",
      markdownContent: [
        "# 资产深度报告",
        "",
        "## 先看结论",
        "",
        "**建议状态：** 谨慎参考",
        "**建议动作：** 停止加仓，先控制集中度",
        "",
        "| 证券代码 | 持仓名称 | 当前市值（元） | 浮动盈亏（元） | 组合占比 |",
        "| --- | --- | ---: | ---: | ---: |",
        "| 000001.SZ | 平安银行 | 1,110.00 | 20.00 | 83.79% |",
      ].join("\n"),
      sourceRows: [{ symbol: "000001.SZ", marketValue: "1110" }],
      sourceColumns: [{ name: "symbol" }, { name: "marketValue" }],
    });

    const preview = previewArtifact(TEST_USER_ID, created.artifactId) as { type: string; markdown?: string } | null;
    const summary = listArtifacts(TEST_USER_ID, 10)[0];

    expect(preview).toMatchObject({
      type: "MARKDOWN",
      markdown: expect.stringContaining("停止加仓，先控制集中度"),
    });
    expect(String(preview?.markdown)).not.toContain("DEGRADED");
    expect(String(preview?.markdown)).not.toContain("STOP_ADDING");
    expect(summary).toMatchObject({ recommendationId: "report-recommendation" });
  });
});

describe("buildFinancialReportMarkdown", () => {
  it("translates recommendation codes and explains the decision for beginners", () => {
    const markdown = buildFinancialReportMarkdown(
      "资产深度报告",
      [
        "建议状态：DEGRADED；建议动作：STOP_ADDING",
        "核心结论：当前应暂缓新增仓位并优先降低集中度",
        "用户画像与投资目标依据：风险等级：R5；投资期限：LONG；偏好资产：INDEX",
        "数据研究：已完成 3 个持仓的真实市场数据研究，状态为 LATEST_TRADING_DAY",
        "行情与技术观察：最新价格样本：37.05；行情证据：688256.SH=1225@2026-07-24 via get_stock_daily",
        "组合影响：新增标的会改变现金、集中度和压力损失",
        "风险复核：最大持仓权重 83.79%，HHI 0.7214",
        "合规结论：研究和模拟边界检查完成",
      ].join("\n"),
      [{ symbol: "688256.SH", name: "寒武纪", marketValue: "122500", unrealizedPnl: "72500", weightPercent: 83.79 }],
      {
        instrumentId: null,
        symbol: null,
        action: "STOP_ADDING",
        suitability: "MEDIUM",
        summary: "当前应暂缓新增仓位并优先降低集中度",
        confidence: "0.72",
        positionRange: [],
        firstPosition: null,
        addConditions: [],
        referenceRange: [],
        stopLoss: "",
        takeProfit: "",
        horizon: "MEDIUM",
        expiresAt: "",
        reasons: ["最大持仓权重偏高"],
        counterEvidence: ["执行前需要复核开盘价格"],
        risks: ["集中度过高会放大组合波动"],
        alternatives: [],
        invalidation: "持仓或用户资金用途变化时重新判断",
        compliance: { status: "DEGRADED", reasons: [], disclaimer: "仅供研究和模拟" },
        dataAsOf: "2026-07-25",
        provenance: {},
      },
      "DEGRADED",
    );

    expect(markdown).toContain("**建议状态：** 谨慎参考");
    expect(markdown).toContain("**建议动作：** 停止加仓，先控制集中度");
    expect(markdown).toContain("简单说，先不要继续买入占比已经偏高的持仓");
    expect(markdown).toContain("行情数据截至：2026年7月25日");
    expect(markdown).toContain("集中度指标为 0.7214");
    expect(markdown).toContain("风险等级：进取型");
    expect(markdown).toContain("投资期限：长线");
    expect(markdown).toContain("偏好资产：指数基金");
    expect(markdown).toContain("### 你的画像和目标");
    expect(markdown).toContain("### 组合事实");
    expect(markdown).toContain("### 行情与技术观察");
    expect(markdown).toContain("### 基本面与消息面");
    expect(markdown).toContain("### 多方证据");
    expect(markdown).toContain("### 空方证据");
    expect(markdown).toContain("### 为什么对应这个动作");
    expect(markdown).toContain("本次资产报告流程未执行基本面和消息面检索");
    expect(markdown).toContain("| 证券代码 | 持仓名称 | 当前市值（元） | 浮动盈亏（元） | 组合占比 |");
    expect(markdown).not.toContain("报告生成时读取到 1 项持仓快照");
    expect(markdown).not.toContain("最新价格样本");
    expect(markdown).not.toContain("行情证据：");
    expect(markdown).not.toContain("已完成 3 个持仓的真实市场数据研究");
    expect(markdown).not.toContain("## 数据与风险");
    expect(markdown).not.toContain("## 你还可以查看");
    expect(markdown).not.toContain("DEGRADED");
    expect(markdown).not.toContain("STOP_ADDING");
  });

  it("states the evidence gap instead of inventing market or profile support", () => {
    const markdown = buildFinancialReportMarkdown(
      "资产深度报告",
      "建议状态：BLOCKED；建议动作：WATCH\n核心结论：信息还不完整，暂不调整",
      [],
      null,
      "BLOCKED",
    );

    expect(markdown).toContain("本次未获得可用的用户画像和投资目标证据");
    expect(markdown).toContain("本次未获得可用的行情或技术面证据");
    expect(markdown).toContain("本次资产报告流程未执行基本面和消息面检索");
    expect(markdown).toContain("本次未获得可用的持仓明细");
    expect(markdown).not.toContain("## 数据与风险");
    expect(markdown).not.toContain("## 你还可以查看");
  });
});
