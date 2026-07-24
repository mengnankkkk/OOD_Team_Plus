import { NextResponse } from "next/server";
import { meta } from "@/server/http/context";

export async function GET() { return NextResponse.json({ data: { version: 1, questions: [
  { id: "q1", type: "SCENARIO", prompt: "如果组合短期下跌 20%，你会怎么做？", options: [{ value: "hold", label: "继续持有" }, { value: "reduce", label: "减仓" }, { value: "sell", label: "全部卖出" }] },
  { id: "q2", type: "HORIZON", prompt: "计划持有多久？", options: [{ value: "short", label: "短线" }, { value: "medium", label: "中线" }, { value: "long", label: "长线" }] },
  { id: "q3", type: "LOSS", prompt: "最大可接受回撤？", options: [{ value: "low", label: "10%以内" }, { value: "medium", label: "10%-30%" }, { value: "high", label: "30%以上" }] },
] }, meta: meta() }); }
