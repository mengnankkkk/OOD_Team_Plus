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
import {
  getColumns,
  getDomains,
  getTables,
  setColumns,
  setDomains,
  setTables,
  useDomains,
} from "@/lib/mockSemanticStore";
import { nextId, nowIso } from "@/lib/mockSemanticData";
import type { SemanticColumn, SemanticDomain, SemanticTable, SyncCounter } from "@/types/app/semantic";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CREATE_NEW = "__create__";
const empty = (): SyncCounter => ({ created: 0, updated: 0, missing: 0, skipped: 0 });

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

  const submit = () => {
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
    // Fake async so the UI feedback feels realistic
    window.setTimeout(() => {
      try {
        const now = nowIso();
        const counters = { domain: empty(), tables: empty(), columns: empty() };

        // Domain upsert
        const currentDomains = getDomains();
        let dom = currentDomains.find((d) => d.name === domainName);
        if (dom) {
          counters.domain.updated += 1;
          setDomains(
            currentDomains.map((d) =>
              d.id === dom!.id
                ? { ...d, description: `来自数据源 ${datasource.label}`, updatedAt: now }
                : d,
            ),
          );
        } else {
          const created: SemanticDomain = {
            id: nextId("dom"),
            name: domainName,
            description: `来自数据源 ${datasource.label}`,
            isVisible: true,
            createdAt: now,
            updatedAt: now,
          };
          dom = created;
          counters.domain.created += 1;
          setDomains([created, ...currentDomains]);
        }
        const domainId = dom.id;

        // Tables upsert
        const incomingTableNames = new Set(
          datasource.tables
            .filter((t) => selectedTables.has(t.physicalTableName))
            .map((t) => t.physicalTableName),
        );
        let currentTables = getTables();
        const existingInScope = currentTables.filter(
          (t) => t.domainId === domainId && t.datasourceKey === datasource.key,
        );
        const tableIdByName = new Map<string, string>();

        // upsert incoming
        for (const inTbl of datasource.tables.filter((t) =>
          selectedTables.has(t.physicalTableName),
        )) {
          const existing = existingInScope.find(
            (t) => t.physicalTableName === inTbl.physicalTableName,
          );
          if (existing) {
            const nextStatus = existing.syncStatus === "missing" ? "active" : existing.syncStatus;
            currentTables = currentTables.map((t) =>
              t.id === existing.id
                ? {
                    ...t,
                    physicalDescription: inTbl.physicalDescription ?? t.physicalDescription,
                    semanticName: inTbl.semanticName ?? t.semanticName,
                    semanticDescription: inTbl.semanticDescription ?? t.semanticDescription,
                    isVisible: inTbl.isVisible ?? t.isVisible,
                    schemaName: datasource.schemaName ?? t.schemaName,
                    syncStatus: nextStatus,
                    updatedAt: now,
                  }
                : t,
            );
            tableIdByName.set(inTbl.physicalTableName, existing.id);
            counters.tables.updated += 1;
          } else {
            const created: SemanticTable = {
              id: nextId("tbl"),
              domainId,
              datasourceKey: datasource.key,
              schemaName: datasource.schemaName,
              physicalTableName: inTbl.physicalTableName,
              physicalDescription: inTbl.physicalDescription ?? null,
              semanticName: inTbl.semanticName ?? null,
              semanticDescription: inTbl.semanticDescription ?? null,
              isVisible: inTbl.isVisible ?? true,
              syncStatus: "active",
              createdAt: now,
              updatedAt: now,
            };
            currentTables = [created, ...currentTables];
            tableIdByName.set(inTbl.physicalTableName, created.id);
            counters.tables.created += 1;
          }
        }

        // Mark missing in scope
        if (markMissing) {
          for (const existing of existingInScope) {
            if (!incomingTableNames.has(existing.physicalTableName)) {
              if (existing.syncStatus !== "missing") {
                currentTables = currentTables.map((t) =>
                  t.id === existing.id ? { ...t, syncStatus: "missing", updatedAt: now } : t,
                );
                counters.tables.missing += 1;
              } else {
                counters.tables.skipped += 1;
              }
            }
          }
        }
        setTables(currentTables);

        // Columns upsert per synced table
        let currentColumns = getColumns();
        for (const inTbl of datasource.tables.filter((t) =>
          selectedTables.has(t.physicalTableName),
        )) {
          const tableId = tableIdByName.get(inTbl.physicalTableName);
          if (!tableId) continue;
          const existingCols = currentColumns.filter((c) => c.tableId === tableId);
          const incomingColNames = new Set(inTbl.columns.map((c) => c.physicalColumnName));
          for (const inCol of inTbl.columns) {
            const existing = existingCols.find(
              (c) => c.physicalColumnName === inCol.physicalColumnName,
            );
            if (existing) {
              const nextStatus = existing.syncStatus === "missing" ? "active" : existing.syncStatus;
              currentColumns = currentColumns.map((c) =>
                c.id === existing.id
                  ? {
                      ...c,
                      ordinalPosition: inCol.ordinalPosition ?? c.ordinalPosition,
                      dataType: inCol.dataType ?? c.dataType,
                      isNullable: inCol.isNullable ?? c.isNullable,
                      isPrimaryKey: inCol.isPrimaryKey ?? c.isPrimaryKey,
                      defaultValue: inCol.defaultValue ?? c.defaultValue,
                      physicalDescription: inCol.physicalDescription ?? c.physicalDescription,
                      semanticName: inCol.semanticName ?? c.semanticName,
                      semanticDescription: inCol.semanticDescription ?? c.semanticDescription,
                      businessType: inCol.businessType ?? c.businessType,
                      exampleValues: inCol.exampleValues ?? c.exampleValues,
                      isVisible: inCol.isVisible ?? c.isVisible,
                      syncStatus: nextStatus,
                      updatedAt: now,
                    }
                  : c,
              );
              counters.columns.updated += 1;
            } else {
              const created: SemanticColumn = {
                id: nextId("col"),
                tableId,
                physicalColumnName: inCol.physicalColumnName,
                ordinalPosition: inCol.ordinalPosition ?? null,
                dataType: inCol.dataType ?? null,
                isNullable: inCol.isNullable ?? true,
                isPrimaryKey: inCol.isPrimaryKey ?? false,
                defaultValue: inCol.defaultValue ?? null,
                physicalDescription: inCol.physicalDescription ?? null,
                semanticName: inCol.semanticName ?? null,
                semanticDescription: inCol.semanticDescription ?? null,
                businessType: inCol.businessType ?? null,
                exampleValues: inCol.exampleValues ?? [],
                isVisible: inCol.isVisible ?? true,
                syncStatus: "active",
                createdAt: now,
                updatedAt: now,
              };
              currentColumns = [created, ...currentColumns];
              counters.columns.created += 1;
            }
          }
          if (markMissing) {
            for (const existing of existingCols) {
              if (!incomingColNames.has(existing.physicalColumnName)) {
                if (existing.syncStatus !== "missing") {
                  currentColumns = currentColumns.map((c) =>
                    c.id === existing.id ? { ...c, syncStatus: "missing", updatedAt: now } : c,
                  );
                  counters.columns.missing += 1;
                } else {
                  counters.columns.skipped += 1;
                }
              }
            }
          }
        }
        setColumns(currentColumns);

        const c = (label: string, x: SyncCounter) =>
          `${label} 新增 ${x.created} · 更新 ${x.updated} · 缺失 ${x.missing} · 跳过 ${x.skipped}`;
        toast.success(
          `同步完成 · ${c("领域", counters.domain)} / ${c("表", counters.tables)} / ${c("字段", counters.columns)}`,
        );
        onOpenChange(false);
      } finally {
        setSubmitting(false);
      }
    }, 300);
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
