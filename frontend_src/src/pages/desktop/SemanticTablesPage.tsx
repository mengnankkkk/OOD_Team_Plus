import { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Columns3, Layers, Pencil, Plus, RefreshCw, Table2, Trash2 } from "lucide-react";
import type { IsVisibleFilter, SemanticTable, SortOrder, TableSortField } from "@/types/app/semantic";
import { cn } from "@/lib/utils";
import { DataToolbar, type SortOption } from "@/components/desktop/DataToolbar";
import { DataPagination } from "@/components/desktop/DataPagination";
import { useTableSelection } from "@/hooks/useTableSelection";
import { SemanticSyncDialog } from "@/components/desktop/SemanticSyncDialog";
import { setTables, useDomains, useTables } from "@/lib/mockSemanticStore";
import { nextId, nowIso } from "@/lib/mockSemanticData";

const SUB_NAV = [
  { path: "/assets/semantic/domains", label: "领域管理" },
  { path: "/assets/semantic/tables", label: "表管理" },
  { path: "/assets/semantic/foreign-keys", label: "外键管理" },
];

const SORT_OPTIONS: SortOption<TableSortField>[] = [
  { value: "updatedAt", label: "更新时间" },
  { value: "createdAt", label: "创建时间" },
  { value: "physicalTableName", label: "物理表名" },
  { value: "semanticName", label: "语义名" },
];

interface FormState {
  domainId: string;
  datasourceKey: string;
  schemaName: string;
  physicalTableName: string;
  physicalDescription: string;
  semanticName: string;
  semanticDescription: string;
  isVisible: boolean;
}

const emptyForm: FormState = {
  domainId: "",
  datasourceKey: "main",
  schemaName: "public",
  physicalTableName: "",
  physicalDescription: "",
  semanticName: "",
  semanticDescription: "",
  isVisible: true,
};

const SemanticTablesPage = () => {
  const navigate = useNavigate();
  const domains = useDomains();
  const tables = useTables();

  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [isVisible, setIsVisible] = useState<IsVisibleFilter>("all");
  const [sortBy, setSortBy] = useState<TableSortField>("updatedAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [domainFilter, setDomainFilter] = useState<string>("all");

  const selection = useTableSelection();

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [pendingDelete, setPendingDelete] = useState<SemanticTable | null>(null);
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);

  useEffect(() => {
    setPageNo(1);
  }, [keyword, isVisible, sortBy, sortOrder, pageSize, domainFilter]);

  const domainMap = useMemo(() => new Map(domains.map((d) => [d.id, d])), [domains]);

  const paged = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    let list = tables.filter((t) => {
      if (domainFilter !== "all" && t.domainId !== domainFilter) return false;
      if (isVisible === "visible" && !t.isVisible) return false;
      if (isVisible === "hidden" && t.isVisible) return false;
      if (!kw) return true;
      return (
        t.physicalTableName.toLowerCase().includes(kw) ||
        (t.semanticName ?? "").toLowerCase().includes(kw) ||
        (t.physicalDescription ?? "").toLowerCase().includes(kw) ||
        (t.semanticDescription ?? "").toLowerCase().includes(kw)
      );
    });
    list = [...list].sort((a, b) => {
      const av = (a as any)[sortBy] ?? "";
      const bv = (b as any)[sortBy] ?? "";
      return sortOrder === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePageNo = Math.min(pageNo, totalPages);
    const offset = (safePageNo - 1) * pageSize;
    return { pageNo: safePageNo, pageSize, total, items: list.slice(offset, offset + pageSize) };
  }, [tables, domainFilter, keyword, isVisible, sortBy, sortOrder, pageNo, pageSize]);

  const openNew = () => {
    setEditingId(null);
    setForm({
      ...emptyForm,
      domainId: domainFilter !== "all" ? domainFilter : domains[0]?.id ?? "",
    });
    setFormOpen(true);
  };
  const openEdit = (row: SemanticTable) => {
    setEditingId(row.id);
    setForm({
      domainId: row.domainId,
      datasourceKey: row.datasourceKey ?? "",
      schemaName: row.schemaName ?? "",
      physicalTableName: row.physicalTableName,
      physicalDescription: row.physicalDescription ?? "",
      semanticName: row.semanticName ?? "",
      semanticDescription: row.semanticDescription ?? "",
      isVisible: row.isVisible,
    });
    setFormOpen(true);
  };

  const submit = () => {
    if (!form.domainId) {
      toast.error("请选择所属领域");
      return;
    }
    if (!form.physicalTableName.trim()) {
      toast.error("物理表名不能为空");
      return;
    }
    const now = nowIso();
    if (editingId) {
      setTables(
        tables.map((t) =>
          t.id === editingId
            ? {
                ...t,
                domainId: form.domainId,
                datasourceKey: form.datasourceKey.trim() || null,
                schemaName: form.schemaName.trim() || null,
                physicalTableName: form.physicalTableName.trim(),
                physicalDescription: form.physicalDescription.trim() || null,
                semanticName: form.semanticName.trim() || null,
                semanticDescription: form.semanticDescription.trim() || null,
                isVisible: form.isVisible,
                updatedAt: now,
              }
            : t,
        ),
      );
      toast.success("表已更新");
    } else {
      const created: SemanticTable = {
        id: nextId("tbl"),
        domainId: form.domainId,
        datasourceKey: form.datasourceKey.trim() || null,
        schemaName: form.schemaName.trim() || null,
        physicalTableName: form.physicalTableName.trim(),
        physicalDescription: form.physicalDescription.trim() || null,
        semanticName: form.semanticName.trim() || null,
        semanticDescription: form.semanticDescription.trim() || null,
        isVisible: form.isVisible,
        syncStatus: "active",
        createdAt: now,
        updatedAt: now,
      };
      setTables([created, ...tables]);
      toast.success("表已创建");
    }
    setFormOpen(false);
  };

  const remove = () => {
    if (!pendingDelete) return;
    setTables(tables.filter((t) => t.id !== pendingDelete.id));
    toast.success("表已删除");
    setPendingDelete(null);
  };

  const doBatchDelete = () => {
    const ids = new Set(selection.selectedIds);
    setTables(tables.filter((t) => !ids.has(t.id)));
    toast.success(`已删除 ${ids.size} 张表`);
    selection.clear();
    setBatchConfirm(false);
  };

  const idsOnPage = paged.items.map((r) => r.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-md bg-primary/10 text-primary">
          <Table2 className="size-4" />
        </div>
        <div>
          <p className="eyebrow">资产 · 语义层</p>
          <h1 className="text-2xl font-semibold tracking-tight">语义层管理</h1>
        </div>
      </div>

      <nav className="flex items-center gap-1 rounded-md border border-border bg-card p-1 text-sm">
        {SUB_NAV.map((n) => (
          <NavLink
            key={n.path}
            to={n.path}
            className={({ isActive }) =>
              cn(
                "rounded-sm px-3 py-1.5 transition-colors",
                isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )
            }
          >
            {n.label}
          </NavLink>
        ))}
      </nav>

      <div className="flex flex-wrap items-center gap-3">
        <Label className="text-sm text-muted-foreground">按领域筛选</Label>
        <Select value={domainFilter} onValueChange={setDomainFilter}>
          <SelectTrigger className="h-9 w-52">
            <SelectValue placeholder="全部领域" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部领域</SelectItem>
            {domains.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataToolbar
        keyword={keyword}
        onKeywordChange={setKeyword}
        isVisible={isVisible}
        onIsVisibleChange={setIsVisible}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        sortOrder={sortOrder}
        onSortOrderChange={setSortOrder}
        sortOptions={SORT_OPTIONS}
        actions={
          <>
            {selection.count > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBatchConfirm(true)}
                className="h-9 gap-1 border-destructive/50 text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-4" /> 批量删除 ({selection.count})
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSyncOpen(true)}
              className="h-9 gap-1"
            >
              <RefreshCw className="size-4" /> 同步
            </Button>
            <Button onClick={openNew} size="sm" className="h-9 gap-1">
              <Plus className="size-4" /> 新建表
            </Button>
          </>
        }
      />

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-10 px-3 py-2">
                <Checkbox
                  checked={
                    selection.allSelected(idsOnPage)
                      ? true
                      : selection.someSelected(idsOnPage)
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={() => selection.toggleAll(idsOnPage)}
                  aria-label="全选"
                />
              </th>
              <th className="px-4 py-2 text-left">物理表</th>
              <th className="px-4 py-2 text-left">语义名</th>
              <th className="px-4 py-2 text-left">领域</th>
              <th className="px-4 py-2 text-left">Schema</th>
              <th className="px-4 py-2 text-left">同步状态</th>
              <th className="px-4 py-2 text-left">可见</th>
              <th className="px-4 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {paged.items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  当前条件下没有表。可以清空关键字，或者点击"同步"从数据源批量导入。
                </td>
              </tr>
            ) : (
              paged.items.map((row) => {
                const missing = row.syncStatus === "missing";
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-t border-border",
                      missing && "bg-muted/40 opacity-60",
                    )}
                  >
                    <td className="px-3 py-2">
                      <Checkbox
                        checked={selection.isSelected(row.id)}
                        onCheckedChange={() => selection.toggle(row.id)}
                        aria-label={`选择 ${row.physicalTableName}`}
                      />
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{row.physicalTableName}</td>
                    <td className="px-4 py-2 font-medium">{row.semanticName || "—"}</td>
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-1 rounded-sm bg-muted/60 px-1.5 py-0.5 text-[11px]">
                        <Layers className="size-3" /> {domainMap.get(row.domainId)?.name ?? "?"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{row.schemaName || "—"}</td>
                    <td className="px-4 py-2">
                      {missing ? (
                        <Badge variant="outline" className="border-muted-foreground/40 text-muted-foreground">
                          missing
                        </Badge>
                      ) : (
                        <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                          {row.syncStatus === "active" ? "活跃" : row.syncStatus}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={cn(
                          "rounded-sm px-1.5 py-0.5 text-[11px]",
                          row.isVisible ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                        )}
                      >
                        {row.isVisible ? "可见" : "隐藏"}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1"
                          onClick={() => navigate(`/assets/semantic/tables/${row.id}/columns`)}
                        >
                          <Columns3 className="size-4" /> 字段
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(row)} aria-label="编辑">
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setPendingDelete(row)}
                          aria-label="删除"
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <DataPagination
        pageNo={paged.pageNo}
        pageSize={pageSize}
        total={paged.total}
        onPageChange={setPageNo}
        onPageSizeChange={setPageSize}
      />

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "编辑表" : "新建表"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>所属领域</Label>
              <Select value={form.domainId} onValueChange={(v) => setForm({ ...form, domainId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="选择领域" />
                </SelectTrigger>
                <SelectContent>
                  {domains.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {domains.length === 0 && (
                <p className="text-xs text-destructive">还没有领域，请先到"领域管理"新建一个。</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Datasource key</Label>
                <Input
                  value={form.datasourceKey}
                  onChange={(e) => setForm({ ...form, datasourceKey: e.target.value })}
                  placeholder="main"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Schema</Label>
                <Input
                  value={form.schemaName}
                  onChange={(e) => setForm({ ...form, schemaName: e.target.value })}
                  placeholder="public"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>物理表名</Label>
              <Input
                value={form.physicalTableName}
                onChange={(e) => setForm({ ...form, physicalTableName: e.target.value })}
                placeholder="orders"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>物理表描述</Label>
              <Textarea
                value={form.physicalDescription}
                onChange={(e) => setForm({ ...form, physicalDescription: e.target.value })}
                rows={2}
                placeholder="订单物理表"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>语义名</Label>
              <Input
                value={form.semanticName}
                onChange={(e) => setForm({ ...form, semanticName: e.target.value })}
                placeholder="订单主表"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>语义描述</Label>
              <Textarea
                value={form.semanticDescription}
                onChange={(e) => setForm({ ...form, semanticDescription: e.target.value })}
                rows={2}
                placeholder="记录交易生命周期"
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium">对下游可见</p>
                <p className="text-xs text-muted-foreground">关闭后建议引擎不会引用这张表。</p>
              </div>
              <Switch checked={form.isVisible} onCheckedChange={(v) => setForm({ ...form, isVisible: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              取消
            </Button>
            <Button onClick={submit} disabled={domains.length === 0}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              确定删除表"{pendingDelete?.semanticName || pendingDelete?.physicalTableName}"？
            </AlertDialogTitle>
            <AlertDialogDescription>删除后仅影响 mock 状态，页面刷新会回到初始 fixture 数据。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={remove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={batchConfirm} onOpenChange={setBatchConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定删除已选中的 {selection.count} 张表？</AlertDialogTitle>
            <AlertDialogDescription>删除后仅影响 mock 状态，页面刷新会回到初始 fixture 数据。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={doBatchDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              全部删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SemanticSyncDialog open={syncOpen} onOpenChange={setSyncOpen} />
    </div>
  );
};

export default SemanticTablesPage;
