import { useEffect, useMemo, useState } from "react";
import { NavLink } from "@/features/frontend-migration/router";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { Database, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { DatasourceSortField, IsVisibleFilter, SemanticDatasource, SortOrder } from "@/types/app/semantic";
import { cn } from "@/lib/utils";
import { DataToolbar, type SortOption } from "@/components/desktop/DataToolbar";
import { DataPagination } from "@/components/desktop/DataPagination";
import { useTableSelection } from "@/hooks/useTableSelection";
import { setDatasources, useDatasources } from "@/lib/semanticStore";
import { nextId, nowIso } from "@/lib/semanticIds";
import { SemanticSyncDialog } from "@/components/desktop/SemanticSyncDialog";

const SUB_NAV = [
  { path: "/assets/semantic/datasources", label: "数据源管理" },
  { path: "/assets/semantic/domains", label: "领域管理" },
  { path: "/assets/semantic/tables", label: "表管理" },
  { path: "/assets/semantic/foreign-keys", label: "外键管理" },
];

const SORT_OPTIONS: SortOption<DatasourceSortField>[] = [
  { value: "updatedAt", label: "更新时间" },
  { value: "createdAt", label: "创建时间" },
  { value: "name", label: "数据源名称" },
];

const CONNECTION_TYPES = [
  { value: "sqlite", label: "SQLite" },
  { value: "libsql", label: "LibSQL" },
  { value: "jdbc", label: "JDBC" },
  { value: "api", label: "API" },
  { value: "manual", label: "Manual" },
];

interface FormState {
  datasourceKey: string;
  name: string;
  description: string;
  connectionType: string;
  schemaName: string;
  isVisible: boolean;
}

const emptyForm: FormState = {
  datasourceKey: "",
  name: "",
  description: "",
  connectionType: "sqlite",
  schemaName: "main",
  isVisible: true,
};

const SemanticDatasourcesPage = () => {
  const datasources = useDatasources();

  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [isVisible, setIsVisible] = useState<IsVisibleFilter>("all");
  const [sortBy, setSortBy] = useState<DatasourceSortField>("updatedAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const selection = useTableSelection();

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [pendingDelete, setPendingDelete] = useState<SemanticDatasource | null>(null);
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);

  useEffect(() => {
    setPageNo(1);
  }, [keyword, isVisible, sortBy, sortOrder, pageSize]);

  const paged = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    let list = datasources.filter((d) => {
      if (isVisible === "visible" && !d.isVisible) return false;
      if (isVisible === "hidden" && d.isVisible) return false;
      if (!kw) return true;
      return (
        d.datasourceKey.toLowerCase().includes(kw) ||
        d.name.toLowerCase().includes(kw) ||
        (d.description ?? "").toLowerCase().includes(kw)
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
  }, [datasources, pageNo, pageSize, keyword, isVisible, sortBy, sortOrder]);

  const openNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (row: SemanticDatasource) => {
    setEditingId(row.id);
    setForm({
      datasourceKey: row.datasourceKey,
      name: row.name,
      description: row.description ?? "",
      connectionType: row.connectionType,
      schemaName: row.schemaName ?? "",
      isVisible: row.isVisible,
    });
    setFormOpen(true);
  };

  const submit = () => {
    if (!editingId && !form.datasourceKey.trim()) {
      toast.error("Datasource key 不能为空");
      return;
    }
    if (!form.name.trim()) {
      toast.error("数据源名称不能为空");
      return;
    }
    const now = nowIso();
    if (editingId) {
      setDatasources(
        datasources.map((d) =>
          d.id === editingId
            ? {
                ...d,
                name: form.name.trim(),
                label: form.name.trim(),
                description: form.description.trim() || null,
                connectionType: form.connectionType,
                schemaName: form.schemaName.trim() || null,
                isVisible: form.isVisible,
                updatedAt: now,
              }
            : d,
        ),
      );
      toast.success("数据源已更新");
    } else {
      const key = form.datasourceKey.trim();
      const created: SemanticDatasource = {
        id: nextId("ds"),
        datasourceKey: key,
        key,
        name: form.name.trim(),
        label: form.name.trim(),
        description: form.description.trim() || null,
        connectionType: form.connectionType,
        schemaName: form.schemaName.trim() || null,
        isVisible: form.isVisible,
        syncStatus: "active",
        lastSyncedAt: null,
        tables: [],
        createdAt: now,
        updatedAt: now,
      };
      setDatasources([created, ...datasources]);
      toast.success("数据源已创建");
    }
    setFormOpen(false);
  };

  const remove = () => {
    if (!pendingDelete) return;
    setDatasources(datasources.filter((d) => d.id !== pendingDelete.id));
    toast.success("数据源已删除");
    setPendingDelete(null);
  };

  const doBatchDelete = () => {
    const ids = new Set(selection.selectedIds);
    setDatasources(datasources.filter((d) => !ids.has(d.id)));
    toast.success(`已删除 ${ids.size} 个数据源`);
    selection.clear();
    setBatchConfirm(false);
  };

  const idsOnPage = paged.items.map((r) => r.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-md bg-primary/10 text-primary">
          <Database className="size-4" />
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
            <Button variant="outline" size="sm" onClick={() => setSyncOpen(true)} className="h-9 gap-1">
              <RefreshCw className="size-4" /> 同步导入
            </Button>
            <Button onClick={openNew} size="sm" className="h-9 gap-1">
              <Plus className="size-4" /> 新建数据源
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
              <th className="px-4 py-2 text-left">数据源</th>
              <th className="px-4 py-2 text-left">Key</th>
              <th className="px-4 py-2 text-left">连接类型</th>
              <th className="px-4 py-2 text-left">Schema</th>
              <th className="px-4 py-2 text-left">可导入表</th>
              <th className="px-4 py-2 text-left">最近同步</th>
              <th className="px-4 py-2 text-left">可见</th>
              <th className="px-4 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {paged.items.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                  当前条件下没有数据源。可以清空关键字，或者点击"新建数据源"。
                </td>
              </tr>
            ) : (
              paged.items.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={selection.isSelected(row.id)}
                      onCheckedChange={() => selection.toggle(row.id)}
                      aria-label={`选择 ${row.name}`}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <div className="font-medium">{row.name}</div>
                    <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{row.description || "—"}</div>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{row.datasourceKey}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{row.connectionType}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{row.schemaName || "—"}</td>
                  <td className="px-4 py-2">
                    <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                      {row.tables.length} 张
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {row.lastSyncedAt ? new Date(row.lastSyncedAt).toLocaleString("zh-CN") : "尚未同步"}
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
                      <Button variant="ghost" size="icon" onClick={() => openEdit(row)} aria-label="编辑">
                        <Pencil className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setPendingDelete(row)} aria-label="删除">
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
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
            <DialogTitle>{editingId ? "编辑数据源" : "新建数据源"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>Datasource key</Label>
              <Input
                value={form.datasourceKey}
                onChange={(e) => setForm({ ...form, datasourceKey: e.target.value })}
                placeholder="local-sqlite"
                disabled={!!editingId}
              />
              {editingId ? <p className="text-xs text-muted-foreground">Key 已被表配置引用，编辑时保持不变。</p> : null}
            </div>
            <div className="grid gap-1.5">
              <Label>数据源名称</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Money Whisperer SQLite" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>连接类型</Label>
                <Select value={form.connectionType} onValueChange={(v) => setForm({ ...form, connectionType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CONNECTION_TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Schema</Label>
                <Input value={form.schemaName} onChange={(e) => setForm({ ...form, schemaName: e.target.value })} placeholder="main" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>描述</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="用于同步导入语义层元数据的数据源。" />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium">可用于同步导入</p>
                <p className="text-xs text-muted-foreground">关闭后同步弹窗不会优先展示该数据源。</p>
              </div>
              <Switch checked={form.isVisible} onCheckedChange={(v) => setForm({ ...form, isVisible: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>取消</Button>
            <Button onClick={submit}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定删除数据源"{pendingDelete?.name}"？</AlertDialogTitle>
            <AlertDialogDescription>删除后不会删除已导入的表和字段，但该数据源将不再用于后续同步。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={batchConfirm} onOpenChange={setBatchConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定删除已选中的 {selection.count} 个数据源？</AlertDialogTitle>
            <AlertDialogDescription>删除后不会删除已导入的表和字段，但这些数据源将不再用于后续同步。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={doBatchDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">全部删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SemanticSyncDialog open={syncOpen} onOpenChange={setSyncOpen} />
    </div>
  );
};

export default SemanticDatasourcesPage;
