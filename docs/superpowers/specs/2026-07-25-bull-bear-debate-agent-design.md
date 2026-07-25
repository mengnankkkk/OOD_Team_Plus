# Money Whisperer 多空 Battle Agent 设计

## 1. 文档目标

本文定义 Money Whisperer 顾问页的“多空 Battle”Agent 能力。目标是在现有理财顾问 Agent 架构上，为理财小白提供一个可参与的投资辩论房间：

1. 用户可以围绕某个标的、组合动作或投资假设开启辩论。
2. 看多方和看空方基于同一份数据源与证据板分别组织最强观点。
3. 用户既可以保持中立提问，也可以自由站队参与多方或空方。
4. 双方 Agent 必须回应用户观点、质询对方，并暴露证据缺口。
5. 裁判 Agent 每轮用小白能听懂的语言总结证据天平、争议焦点和下一步。

本文重点覆盖后端 Agent、LLM 编排、状态机、结构化契约、SSE 事件和合规边界。前端由独立实现方完成，本文只提供前端对接契约。

## 2. 产品定位

多空 Battle 不是报告生成器，也不是情绪化吵架工具，而是一个“可参与的投资判断训练场”。

目标用户是理财小白，因此体验重点是：

- 让用户敢问、敢站队，不因为术语门槛退场。
- 把用户的朴素直觉升级为可检验的投资假设。
- 让看多与看空 Agent 用证据互相压力测试。
- 由裁判把争论翻译成“我现在还缺什么信息”和“下一步该怎么验证”。
- 保持投资建议的模拟属性，不输出真实交易指令。

## 3. 技术定位

第一版采用 **C-lite** 架构：

- 有独立的 debate session、round 和 turn 状态。
- 复用现有用户画像、持仓、PandaData、Evidence Pack、SSE 和发布门。
- 新增 Battle 专用 Agent 角色，但不推翻当前 Chief Advisor 架构。
- LLM 负责辩论策略、观点组织、反驳、追问和裁判总结。
- 规则只做事实边界、结构化输出和合规护栏。

不在第一版实现：

- 多用户观战、投票或排行榜。
- 长周期积分和辩论胜率系统。
- 真实交易、券商连接或自动下单。
- 完整自治 Agent 网络。第一版仍由服务端 Orchestrator 控制回合生命周期。

## 4. 核心原则

### 4.1 LLM 发挥空间

多空 Battle 必须充分发挥 LLM Agent 的能力：

- Orchestrator 由 LLM 判断本轮焦点，例如估值、趋势、回撤、仓位、持有期限或用户心理偏差。
- Bull Advocate 主动寻找最强看多路径，不靠固定规则枚举观点。
- Bear Advocate 主动寻找多方假设中最脆弱的位置，进行压力测试。
- Judge 综合证据质量、逻辑完整度、用户目标、风险适配性和回应质量给出总结。
- 用户站队时，己方 Agent 负责把用户观点补强成更专业但仍易懂的表达。

### 4.2 规则只做边界

服务端规则只负责：

- 所有方共享同一份 Evidence Board，不能各编各的数据。
- 市场数据、持仓、画像和风险指标以工具和数据库为准。
- 模型输出必须通过 Zod schema，方便前端渲染和审计。
- 数据过期、画像缺失、证据不足或合规失败时，不得升级为明确行动建议。
- 不暴露隐藏推理链，只展示可公开的发言、证据和总结。

### 4.3 小白友好

多空双方可以有立场，但不能攻击用户。裁判必须把争论翻译成自然语言：

- 少用术语，必要术语必须解释。
- 不把“跌多了”直接等同于“便宜了”。
- 不把“看多有道理”直接等同于“应该买”。
- 每轮都给用户可继续参与的追问建议。

## 5. Agent 角色

### 5.1 Debate Orchestrator

职责：

- 创建和推进 debate session。
- 识别用户身份：中立提问者、站多方、站空方。
- 判断用户本轮意图：提问、站队、质询、补证据、要求总结。
- 决定本轮需要哪些 Agent 发言。
- 判断是否需要补充数据或重新读取 Evidence Board。
- 生成本轮 `roundFocus` 和推荐发言顺序。

Orchestrator 可以使用 LLM 生成回合计划，但服务端负责执行计划和落库。

### 5.2 Evidence Agent

职责：

- 读取用户画像、目标、持仓、组合快照和历史对话。
- 调用 PandaData 或其他数据工具获取行情、估值、事件和数据新鲜度。
- 将事实、计算结果、未知项和证据质量写入 Evidence Board。
- 标记用户补充信息的来源为 `user_claim`，不得伪装成外部事实。

Evidence Agent 不输出投资立场，只输出共同事实。

### 5.3 Bull Advocate

职责：

- 从共同事实中选择最有利的看多论证路径。
- 在用户站多方时，先帮用户把朴素观点补强成更严谨的投资假设。
- 提出看多论点、支持证据、触发条件、对空方最关键反驳。
- 主动承认对多方不利的核心风险。
- 用小白能听懂的语言说明“如果要看多，需要相信什么假设”。

Bull Advocate 不得绕过证据板编造利好，也不得直接输出“必须买入”。

### 5.4 Bear Advocate

职责：

- 从共同事实中选择最有利的看空或谨慎论证路径。
- 在用户站空方时，先帮用户把担忧补强成更严谨的风险假设。
- 提出看空论点、风险证据、无效条件、对多方最关键反驳。
- 主动承认对空方不利的核心反证。
- 用小白能听懂的语言说明“如果要谨慎，需要担心什么假设”。

Bear Advocate 不得把风险提示扩大成恐吓，也不得直接输出“必须卖出”。

### 5.5 Debate Judge

职责：

- 复述用户本轮真实主张。
- 归纳多方最强点和空方最强点。
- 判断双方是否正面回应用户问题。
- 判断当前证据天平：多方略强、空方略强、暂时打平或证据不足。
- 输出下一轮最有价值的追问。
- 输出合规边界和行动限制。

Judge 是教学型裁判，不是交易裁判。它可以给出证据倾向，但不能把倾向直接升级为交易指令。

### 5.6 Chief Advisor

职责：

- 在辩论结束或用户要求行动方案时，将 Battle 结果交给现有顾问发布门。
- 结合用户画像、组合风险、数据新鲜度和合规结果输出最终模拟建议。
- 保证多空任一方都不能直接绕过发布门生成 `ACTIVE` 建议。

## 6. 用户参与模式

### 6.1 中立提问者

默认身份。用户像主持人或投资人一样提出问题：

```text
这个 ETF 最近跌了，我现在能不能加仓？
```

推荐流程：

1. Orchestrator 判断辩题和焦点。
2. Evidence Agent 准备共同事实。
3. Bull Advocate 先给看多观点。
4. Bear Advocate 给看空观点。
5. 双方各指出对方一个薄弱点。
6. Judge 总结并给下一轮追问按钮。

### 6.2 自由站队参与者

用户可以在任何一轮切换到多方或空方：

```text
我站多方，我觉得已经跌得够多了。
```

站多方流程：

1. Bull Advocate 先复述用户观点。
2. Bull Advocate 将观点升级为可检验假设。
3. Bear Advocate 反驳该假设中最脆弱的部分。
4. Bull Advocate 回应一次。
5. Judge 评价用户观点被补强后的证据质量。

站空方流程对称。

### 6.3 点名质询

用户可以点名质询一方：

```text
空方，你说趋势不好，有什么数据支持？
```

流程：

1. 被质询方先回答。
2. 对方指出回答是否回避问题。
3. Judge 判断是否正面回答，并给出下一轮追问。

### 6.4 补充证据或个人约束

用户可以补充：

```text
我只打算拿两周，而且最多亏 5%。
```

流程：

1. Evidence Agent 将该信息写为 `user_claim`。
2. Orchestrator 判断是否需要重开焦点。
3. Bull 和 Bear 必须基于新约束调整观点。
4. Judge 说明新信息如何改变证据天平。

## 7. 辩论状态模型

### 7.1 Debate Session

```typescript
interface DebateSession {
  id: string;
  userId: string;
  conversationId: string;
  rootAgentRunId: string;
  motion: string;
  targetInstrumentId?: string;
  targetSymbol?: string;
  userDebateRole: "neutral" | "bull" | "bear";
  status: "active" | "waiting_for_user" | "completed" | "blocked" | "cancelled";
  currentRoundIndex: number;
  evidenceBoardId?: string;
  createdAt: string;
  updatedAt: string;
}
```

### 7.2 Debate Round

```typescript
interface DebateRound {
  id: string;
  debateSessionId: string;
  roundIndex: number;
  roundFocus: string;
  userIntent:
    | "ask_both"
    | "support_bull"
    | "support_bear"
    | "challenge_bull"
    | "challenge_bear"
    | "ask_judge"
    | "provide_evidence";
  status: "running" | "waiting_for_user" | "completed" | "blocked";
  judgeSummary?: DebateJudgement;
  createdAt: string;
  completedAt?: string;
}
```

### 7.3 Debate Turn

```typescript
interface DebateTurn {
  id: string;
  debateSessionId: string;
  debateRoundId: string;
  speaker: "user" | "bull" | "bear" | "judge" | "orchestrator" | "evidence";
  stance: "bull" | "bear" | "neutral";
  turnType:
    | "opening"
    | "support"
    | "rebuttal"
    | "cross_examination"
    | "answer"
    | "judge_summary"
    | "evidence_update";
  content: string;
  publicSummary: string;
  structuredPayloadJson: string;
  createdAt: string;
}
```

### 7.4 Debate Argument

```typescript
interface DebateArgument {
  id: string;
  debateTurnId: string;
  stance: "bull" | "bear";
  claim: string;
  plainLanguage: string;
  evidenceRefs: string[];
  counterEvidenceRefs: string[];
  assumption: string;
  confidence: number;
  vulnerability: string;
}
```

### 7.5 Debate Judgement

```typescript
interface DebateJudgement {
  userClaim: string;
  bullStrongestPoint: string;
  bearStrongestPoint: string;
  keyDisagreement: string;
  responseQuality: {
    bull: "direct" | "partial" | "evasive" | "not_applicable";
    bear: "direct" | "partial" | "evasive" | "not_applicable";
  };
  evidenceTilt: "bull_slightly_stronger" | "bear_slightly_stronger" | "balanced" | "insufficient_evidence";
  confidence: number;
  whyNotFinal: string;
  suggestedNextPrompts: string[];
  complianceNote: string;
}
```

## 8. LLM 输出契约

### 8.1 Orchestrator Plan

```typescript
interface DebateRoundPlan {
  userDebateRole: "neutral" | "bull" | "bear";
  userIntent: DebateRound["userIntent"];
  motion: string;
  roundFocus: string;
  requiredAgents: Array<"evidence" | "bull" | "bear" | "judge" | "chief_advisor">;
  speakingOrder: Array<"evidence" | "bull" | "bear" | "judge">;
  needsFreshData: boolean;
  reasonForFocus: string;
}
```

Orchestrator 的 schema 只约束字段，不限制它如何判断焦点。

### 8.2 Advocate Speech

```typescript
interface AdvocateSpeech {
  stance: "bull" | "bear";
  headline: string;
  directResponseToUser: string;
  arguments: DebateArgument[];
  strongestAttackOnOpponent: string;
  admittedWeakness: string;
  questionForOpponent: string;
  plainLanguageSummary: string;
  suggestedUserFollowUp: string;
}
```

### 8.3 Judge Summary

Judge 输出使用 `DebateJudgement`，同时保留一段自然语言 `publicSummary`。前端可优先展示自然语言，再折叠结构化字段。

## 9. 回合执行流程

### 9.1 开启辩论

```text
POST /api/v1/debates
  -> validate input
  -> create debate_session
  -> create root agent_run(type='debate_agent')
  -> Orchestrator 生成首轮计划
  -> Evidence Agent 获取共同事实
  -> Bull/Bear 公开发言
  -> Judge 首轮总结
  -> return debateSessionId, roundId, streamUrl
```

### 9.2 继续辩论

```text
POST /api/v1/debates/:id/turns
  -> persist user turn
  -> Orchestrator 判断用户身份和本轮意图
  -> 如果用户补证据，先更新 Evidence Board
  -> 按 speakingOrder 调用相关 Agent
  -> Judge 总结本轮
  -> 如果用户要求行动方案，交给 Chief Advisor 发布门
```

### 9.3 结束辩论

用户可以要求：

- `让裁判最终总结`
- `给我一个保守模拟方案`
- `生成建议卡`
- `结束辩论`

此时流程进入 `Chief Advisor`，将 debate session 中的多空证据、裁判总结和未解决问题作为输入，复用现有发布门输出模拟建议或阻断原因。

## 10. 裁判总结设计

裁判每轮必须覆盖以下内容，但表达可由 LLM 自由组织：

1. **用户本轮主张**：用一句白话复述用户真实意思。
2. **多方最强点**：说明多方最有证据的一点。
3. **空方最强点**：说明空方最值得警惕的一点。
4. **关键冲突点**：指出双方真正分歧，例如估值修复、趋势确认、持有期限或回撤承受力。
5. **回应质量**：判断双方有没有正面回答用户。
6. **证据天平**：只能输出多方略强、空方略强、暂时打平或证据不足。
7. **为什么不是最终结论**：说明还缺什么数据或个人约束。
8. **下一轮追问建议**：给 2 到 3 个小白能直接点的追问。
9. **合规边界**：提醒这是模拟和研究，不是交易指令。

裁判禁止输出：

- “多方赢，所以应该买入。”
- “空方赢，所以必须卖出。”
- “确定会上涨/下跌。”
- “保证收益”或类似承诺。

## 11. Evidence Board

Battle 使用现有 evidence_items、tool_calls、skill_runs 和 market_snapshots，同时增加 Debate 维度的引用。

证据分类：

- `market_fact`：来自 PandaData 或其他行情源。
- `portfolio_fact`：来自用户持仓和组合快照。
- `profile_fact`：来自用户画像和目标。
- `user_claim`：用户在辩论中补充的事实或主张。
- `agent_inference`：多空方或裁判基于事实做出的解释。
- `missing_data`：影响判断但缺失的信息。

多空方都必须基于同一份 Evidence Board。若一方提出新事实，必须通过 Evidence Agent 标记来源和质量。

## 12. API 草案

### 12.1 创建辩论

```http
POST /api/v1/debates
Idempotency-Key: <key>

{
  "conversationId": "conversation_x",
  "message": "我现在要不要加仓 510300？",
  "targetSymbol": "510300.OF",
  "initialUserRole": "neutral",
  "outputMode": "BATTLE"
}
```

响应：

```json
{
  "data": {
    "debateSessionId": "debate_x",
    "roundId": "debate_round_x",
    "analysis": {
      "analysisId": "analysis_x",
      "type": "DEBATE",
      "status": "RUNNING",
      "streamUrl": "/api/v1/debates/debate_x/events"
    }
  }
}
```

### 12.2 继续辩论

```http
POST /api/v1/debates/:id/turns
Idempotency-Key: <key>

{
  "content": "我站多方，我觉得跌这么多说明已经便宜了。",
  "userRole": "bull"
}
```

### 12.3 查询辩论

```http
GET /api/v1/debates/:id
GET /api/v1/debates/:id/rounds
GET /api/v1/debates/:id/evidence-pack
```

## 13. SSE 事件

新增事件：

- `debate.started`
- `debate.round.started`
- `debate.evidence.started`
- `debate.evidence.completed`
- `debate.agent.started`
- `debate.agent.completed`
- `debate.speech.delta`
- `debate.turn.completed`
- `debate.judge.started`
- `debate.judge.completed`
- `debate.round.completed`
- `debate.blocked`

事件 payload 必须包含：

- `debateSessionId`
- `roundId`
- `speaker`
- `stance`
- `turnType`
- `publicSummary`
- `analysisId`

隐藏推理和完整内部 prompt 不进入 SSE。

## 14. 与现有架构的关系

需要复用：

- `agent_runs`：根 debate run 和各子 Agent run。
- `agent_run_events`：事件流和回放。
- `evidence_items` 与 `evidence_source_links`：证据引用。
- `tool_calls`、`skill_runs`、`pandadata_probes`：数据工具审计。
- `recommendations`：只有 Chief Advisor 发布门通过后才生成建议卡。
- `runChiefAdvisor` 的结构化模型调用方式。
- `enforcePublicationStatus` 的发布门原则。

建议新增：

- `debate_sessions`
- `debate_rounds`
- `debate_turns`
- `debate_arguments`
- `debate_judgements`

第一版可以先不把所有 debate 字段拆成强关系表，也可以将 `structured_payload_json` 存在 `debate_turns` 中，但必须保留可迁移到结构化表的字段设计。

## 15. 错误与降级

### 15.1 数据不可用

- 辩论可以继续，但 Evidence Agent 必须标记数据不可用。
- Judge 必须将证据天平标记为 `insufficient_evidence` 或明确说明数据缺口。
- 不得生成 `ACTIVE` 建议。

### 15.2 模型输出不合格

- 单个 Advocate 输出不合格时，可以重试一次。
- 重试失败时，该方本轮标记为 `failed`，Judge 必须说明该方未完成有效发言。
- 如果 Judge 输出失败，本轮不能完成，需要返回可重试错误。

### 15.3 用户输入模糊

- Orchestrator 可以将本轮转为澄清回合。
- Bull/Bear 不应在辩题不清时强行辩论。
- Judge 可以输出“本轮无法判定，因为辩题还没有说清”。

### 15.4 合规风险

- 若用户要求确定收益、内幕消息、代操作或真实交易，Debate Orchestrator 必须转入合规拒绝或安全解释。
- Bull/Bear 不参与违法或不合规方向的辩论。
- Judge 输出安全替代问题，例如“可以讨论风险和模拟方案，但不能承诺收益或代下单”。

## 16. 测试要求

### 16.1 单元测试

- Orchestrator 能识别中立、站多方、站空方、质询和补证据。
- Bull/Bear 输出必须符合 schema。
- Judge 输出必须包含证据天平、回应质量和下一轮追问。
- 数据不可用时不会生成可执行建议。
- 用户补充约束会进入 Evidence Board 并影响下一轮。

### 16.2 集成测试

- 创建辩论后能生成 session、round、turn 和 agent_runs。
- 用户站多方后，流程为己方补强、对方反驳、己方回应、裁判总结。
- 用户点名质询空方时，空方先答，多方反驳，裁判判断回应质量。
- SSE 能按顺序输出 round、speech、judge 和 completed 事件。
- Evidence Pack 能展示多空双方论点和引用证据。

### 16.3 回归测试

- 现有普通顾问对话不受 Battle 模式影响。
- 现有 recommendation 发布门仍然生效。
- 没有 DeepSeek API Key 时不能伪造成功 Battle。
- PandaData 配置缺失时能返回证据不足的辩论结果，但不生成 ACTIVE 建议。

## 17. 第一阶段验收标准

第一阶段完成后，应满足：

1. 用户可以从顾问页开启一场多空 Battle。
2. 用户可以中立提问，也可以站多方或空方。
3. 看多方和看空方每轮都能基于同一份证据发表不同立场。
4. 用户质询任一方时，被质询方必须先回应。
5. 裁判每轮都能总结用户观点、双方最强点、证据天平和下一轮追问。
6. 所有公开发言、证据、工具调用和裁判总结可追溯。
7. Battle 结果可以交给现有 Chief Advisor 发布门生成模拟建议或阻断原因。
8. 不暴露隐藏推理，不输出真实交易指令，不承诺收益。

## 18. 建议实现顺序

1. 增加 Battle 领域类型和 Zod schema。
2. 增加 Debate Agent service，先支持同步执行单轮。
3. 接入 Mastra specialist：Bull、Bear、Judge、Orchestrator。
4. 接入 Evidence Agent，复用现有 PandaData 与持仓上下文。
5. 增加 debate session、round、turn 持久化。
6. 增加 SSE 事件和 evidence-pack 输出。
7. 支持继续辩论和用户站队。
8. 接入 Chief Advisor 发布门生成最终模拟建议。

