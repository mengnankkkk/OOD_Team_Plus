"use client";

import { useEffect, useState } from "react";
import { FileText, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type GeneratePortfolioReportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  holdingCount: number;
  dataTimeLabel: string;
  generating: boolean;
  onGenerate: (focus: string) => Promise<void>;
};

export default function GeneratePortfolioReportDialog({
  open,
  onOpenChange,
  holdingCount,
  dataTimeLabel,
  generating,
  onGenerate,
}: GeneratePortfolioReportDialogProps) {
  const [focus, setFocus] = useState("");

  useEffect(() => {
    if (!open && !generating) setFocus("");
  }, [generating, open]);

  const submit = async () => {
    if (generating || holdingCount === 0) return;
    await onGenerate(focus);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!generating) onOpenChange(next); }}>
      <DialogContent className="max-w-xl rounded-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileText className="size-5" />生成资产深度报告</DialogTitle>
          <DialogDescription>
            多 Agent 将基于当前持仓、画像、目标和可用行情生成 Markdown 报告。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 border-y border-border py-4 text-sm sm:grid-cols-3">
            <div><p className="text-xs text-muted-foreground">报告范围</p><p className="mt-1 font-semibold">全部持仓</p></div>
            <div><p className="text-xs text-muted-foreground">持仓数量</p><p className="mt-1 font-semibold">{holdingCount} 笔</p></div>
            <div><p className="text-xs text-muted-foreground">数据状态</p><p className="mt-1 font-semibold">{dataTimeLabel}</p></div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="portfolio-report-focus">关注点（可选）</Label>
              <span className="font-mono text-xs text-muted-foreground">{focus.length}/500</span>
            </div>
            <Textarea
              id="portfolio-report-focus"
              rows={5}
              maxLength={500}
              value={focus}
              onChange={(event) => setFocus(event.target.value)}
              placeholder="例如：重点分析行业集中度、最大回撤和未来三个月的观察条件"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={generating}>取消</Button>
          <Button onClick={() => void submit()} disabled={generating || holdingCount === 0}>
            {generating ? <LoaderCircle className="animate-spin" /> : <FileText />}
            {generating ? "Agent 分析中" : "开始生成"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
