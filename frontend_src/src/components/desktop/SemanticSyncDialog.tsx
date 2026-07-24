import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { MOCK_DATASOURCES, getMockDatasource } from "@/lib/mockDatasources";
import { reloadSemanticLayer, useDomains } from "@/lib/mockSemanticStore";
import { syncSemanticLayer } from "@/services/semanticService";
import type { SyncCounter } from "@/types/app/semantic";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CREATE_NEW = "__create__";

export function SemanticSyncDialog({ open, onOpenChange }: Props) {
  const domains = useDomains();
  const [datasourceKey, setDatasourceKey] = useState<string>(MOCK_DATASOURCES[0]?.key ?? "");
  const [domainSel, setDomainSel] = useState<string>(CREATE_NEW);
  const [newDomainName, setNewDomainName] = useState("");
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [markMissing, setMarkMissing] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDomainSel(domains[0]?.id ?? CREATE_NEW);
  }, [open, domains]);

  const datasource = useMemo(() => getMockDatasource(datasourceKey), [datasourceKey]);

  useEffect(() => {
    if (!datasource) {
      setSelectedTables(new Set());
      return;
    }
    setSelectedTables(new Set(datasource.tables.map((t) => t.physicalTableName)));
  }, [datasourceKey, datasource]);

  const toggleTable = (name: string) => {
    setSelectedTables((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const submit = async () => {
    if (!datasource) {
      toast.error("请选择数据源");
      return;
    }
    if (selectedTables.size === 0) {
      toast.error("请至少勾选一张待同步的表");
      return;
    }
    const domainName =
      domainSel === CREATE_NEW
        ? newDomainName.trim()
        : domains.find((d) => d.id === domainSel)?.name ?? "";
    if (!domainName) {
      toast.error(domainSel === CREATE_NEW ? "请填写新领域名称" : "请选择目标领域");
      return;
    }

    setSubmitting(true);
    try {
      const result = await syncSemanticLayer({
        datasourceKey: datasource.key,
        schemaName: datasource.schemaName,
        domain: {
          name: domainName,
          description: `来自数据源 ${datasource.label}`,
          isVisible: true,
        },
        tables: datasource.tables.filter((t) => selectedTables.has(t.physicalTableName)),
        markMissing,
      });
      await reloadSemanticLayer();

      const c = (label: string, x: SyncCounter) =>
        `${label} 新增 ${x.created} · 更新 ${x.updated} · 缺失 ${x.missing} · 跳过 ${x.skipped ?? 0}`;
      toast.success(
        `同步完成 · ${c("领域", result.domain)} / ${c("表", result.tables)} / ${c("字段", result.columns)}`,
      );
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error?.message ?? "同步失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="size-4 text-primary" />
            从数据源同步元数据
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>1. 数据源</Label>
            <Select value={datasourceKey} onValueChange={setDatasourceKey}>
              <SelectTrigger>
                <SelectValue placeholder="选择数据源" />
              </SelectTrigger>
              <SelectContent>
                {MOCK_DATASOURCES.map((d) => (
                  <SelectItem key={d.key} value={d.key}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {datasource && (
              <p className="text-xs text-muted-foreground">
                {datasource.description} · schema「{datasource.schemaName}」 · 共 {datasource.tables.length} 张物理表
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label>2. 目标领域</Label>
            <Select value={domainSel} onValueChange={setDomainSel}>
              <SelectTrigger>
                <SelectValue placeholder="选择或新建" />
              </SelectTrigger>
              <SelectContent>
                {domains.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
                <SelectItem value={CREATE_NEW}>+ 新建领域</SelectItem>
              </SelectContent>
            </Select>
            {domainSel === CREATE_NEW && (
              <Input
                value={newDomainName}
                onChange={(e) => setNewDomainName(e.target.value)}
                placeholder="新领域名称，例如：交易 / 用户 / 分析"
                className="mt-1"
              />
            )}
          </div>

          <div className="grid gap-1.5">
            <Label>3. 待同步的物理表（{selectedTables.size} / {datasource?.tables.length ?? 0}）</Label>
            <div className="max-h-56 overflow-y-auto rounded-md border border-border">
              {datasource?.tables.map((t) => (
                <label
                  key={t.physicalTableName}
                  className="flex cursor-pointer items-center gap-3 border-b border-border/60 px-3 py-2 text-sm last:border-b-0 hover:bg-muted/40"
                >
                  <Checkbox
                    checked={selectedTables.has(t.physicalTableName)}
                    onCheckedChange={() => toggleTable(t.physicalTableName)}
                  />
                  <div className="flex-1">
                    <p className="font-mono text-xs text-muted-foreground">{t.physicalTableName}</p>
                    <p className="font-medium">{t.semanticName || t.physicalTableName}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{t.columns.length} 列</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium">标记缺失（markMissing）</p>
              <p className="text-xs text-muted-foreground">
                本次没勾选、但库里已存在的表 / 字段会被标为 <code>missing</code>（不删除）。
              </p>
            </div>
            <Switch checked={markMissing} onCheckedChange={setMarkMissing} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" /> 同步中…
              </>
            ) : (
              "开始同步"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
