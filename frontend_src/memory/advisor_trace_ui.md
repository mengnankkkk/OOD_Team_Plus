---
name: advisor_trace_ui
description: 顾问 Agent 每轮回复下方挂一条可折叠的 trace 思维链，展示 span 链路、工具入参、返回 JSON 与最终 loop 回复。
type: project
---

顾问页面每次 AI 回复都必须显式展示"这次调用是怎么发生的"。

**Why:** 用户希望在 AI 顾问思考时看到对应的思维链 —— 这次 trace 的 span 执行链路、每一步调用的工具、发送的 input 参数、返回的 JSON、以及本轮 loop 循环最终恢复的回复；并且这段思维链可以点击缩放隐藏。

**How to apply:**
- Edge Function `advisor-chat` 内部维护一个 tracer（`newTracer()`），每个关键动作都用 `run(name, label, kind, tool, input, fn, previewOutput, note?)` 包住 —— 自动记录 startedAt / durationMs / status / input / output（可裁剪）。
- Span 类型分四类：`llm`（大模型推理）、`tool`（数据库或外部 API 调用）、`reasoning`（内部推理如 prompt 拼装、JSON 抽取）、`io`。
- 当前 span 列表：`load_history` → `load_profile` → `build_prompt` → `persist_user_message` → `call_llm`（gateway.superun.ai/chat/completions）→ `parse_profile_update` → `persist_profile_update`（仅在有更新时）。
- 云函数返回 `{ reply, profileUpdate, trace }`；`trace` 结构：`{ id, startedAt, totalMs, model, spans[], finalReply }`；同时把 trace 写入 `onboarding_messages.metadata.trace`，历史回看时也能展开。
- 前端 `src/components/desktop/AdvisorTrace.tsx` 是折叠组件：
  - 头部一行显示 trace id 尾号 / 步数 / 总耗时 / 模型；整体点一下切换展开收起。
  - 展开后每个 span 一行，可再单击展开 span 详情（input JSON / output JSON / duration / status / note）；JSON 块本身也可折叠。
  - 底部固定显示"本轮 loop 最终回复"色块，等同 `trace.finalReply`。
- 大对象要用 `previewOutput` 裁剪：LLM 完整响应只留 `model / usage / finish_reason / content 前 220 字`；历史 messages 只留最后 3 条并截断 60 字，避免 trace 体积炸掉 metadata 存储。
- 敏感字段不要放进 span input/output（例如原始密钥、用户 JWT）。
- 添加或改造新的 Edge Function（agent-workflow / holdings-import）时，如果想复用这种"思维链可视化"，直接把 tracer 移出去共用即可 —— 结构约定就是这份 SKILL 里的 TraceSpan / AdvisorTrace 类型。
