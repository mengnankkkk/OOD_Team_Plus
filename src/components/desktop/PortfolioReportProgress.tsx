"use client";

import { AlertTriangle, CheckCircle2, LoaderCircle, MessageSquareText, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

type PortfolioReportProgressProps = {
  status: "RUNNING" | "COMPLETED" | "FAILED";
  message: string;
  onRetry: () => void;
  onOpenConversation?: () => void;
};

export default function PortfolioReportProgress({
  status,
  message,
  onRetry,
  onOpenConversation,
}: PortfolioReportProgressProps) {
  const Icon = status === "RUNNING" ? LoaderCircle : status === "COMPLETED" ? CheckCircle2 : AlertTriangle;
  const title = status === "RUNNING" ? "Agent 正在生成资产报告" : status === "COMPLETED" ? "资产报告已生成" : "资产报告生成失败";

  return (
    <section className="paper-card mt-6 flex flex-col gap-4 border-l-4 border-l-foreground p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <Icon className={`mt-0.5 size-5 shrink-0 ${status === "RUNNING" ? "animate-spin" : status === "FAILED" ? "text-destructive" : "text-primary"}`} />
        <div className="min-w-0">
          <p className="font-semibold">{title}</p>
          <p className="mt-1 break-words text-sm leading-6 text-muted-foreground">{message}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {status === "COMPLETED" && onOpenConversation ? (
          <Button variant="outline" size="sm" onClick={onOpenConversation}><MessageSquareText />查看对应对话</Button>
        ) : null}
        {status === "FAILED" ? (
          <Button variant="outline" size="sm" onClick={onRetry}><RefreshCw />重新生成</Button>
        ) : null}
      </div>
    </section>
  );
}
