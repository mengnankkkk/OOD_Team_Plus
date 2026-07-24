import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
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
import { ArrowRight, Link2, Pencil, Plus, Trash2 } from "lucide-react";
import type {
  ForeignKeySortField,
  IsVisibleFilter,
  SemanticColumn,
  SemanticForeignKey,
  SemanticTable,
  SortOrder,
} from "@/types/app/semantic";
import { cn } from "@/lib/utils";
import { DataToolbar, type SortOption } from "@/components/desktop/DataToolbar";
import { DataPagination } from "@/components/desktop/DataPagination";
import { useTableSelection } from "@/hooks/useTableSelection";
import {
  setForeignKeys,
  useColumns,
  useForeignKeys,
  useTables,
} from "@/lib/mockSemanticStore";
import { nextId, nowIso } from "@/lib/mockSemanticData";

const SUB_NAV = [
  { path: "/assets/semantic/domains", label: "领域管理" },
  { path: "/assets/semantic/tables", label: "表管理" },
  { path: "/assets/semantic/foreign-keys", label: "外键管理" },
];

const SORT_OPTIONS: SortOption<ForeignKeySortField>[] = [
  { value: "updatedAt", label: "更新时间" },
  { value: "createdAt", label: "创建时间" },
  { value: "confidence", label: "置信度" },
];

const RELATION_TYPES = [
  { value: "many_to_one", label: "many-to-one 多对一" },
  { value: "one_to_many", label: "one-to-many 一对多" },
  { value: "one_to_one", label: "one-to-one 一对一" },
];

const SOURCE_TYPES = [
  { value: "manual", label: "manual 手工" },
  { value: "physical", label: "physical 物理外键" },
];

interface FormState {
  sourceTableId: string;
  sourceColumnId: string;
  targetTableId: string;
  targetColumnId: string;
  relationType: string;
  sourceType: string;
  confidence: string;
  physicalDescription: string;
  semanticDescription: string;
  isVisible: boolean;
}

const emptyForm: FormState = {
  sourceTableId: "",
  sourceColumnId: "",
  targetTableId: "",
  targetColumnId: "",
  relationType: "many_to_one",
  sourceType: "manual",
  confidence: "1",
  physicalDescription: "",
  semanticDescription: "",
  isVisible: true,
};

const tableLabel = (t: SemanticTable | undefined) =>
  t ? t.semanticName || t.physicalTableName : "?";
const columnLabel = (c: SemanticColumn | undefined) =>
  c ? c.semanticName || c.physicalColumnName : "?";

const SemanticForeignKeysPage = () => {
  const tables = useTables();
  const columns = useColumns();
  const fks = useForeignKeys();

  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [isVisible, setIsVisible] = useState<IsVisibleFilter>("all");
  const [sortBy, setSortBy] = useState<ForeignKeySortField>("updatedAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const selection = useTableSelection();

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [pendingDelete, setPendingDelete] = useState<SemanticForeignKey | null>(null);
  const [batchConfirm, setBatchConfirm] = useState(false);

  useEffect(() => {
    setPageNo(1);
  }, [keyword, isVisible, sortBy, sortOrder, pageSize]);

  const tableMap = useMemo(() => new Map(tables.map((t) => [t.id, t])), [tables]);
  const columnMap = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);

  // Re-derive names on the fly from current store data so edits to tables/columns
  // reflect in the FK page without having to update fk rows themselves.
  const enriched = useMemo<SemanticForeignKey[]>(
    () =>
      fks.map((fk) => ({
        ...fk,
        sourceTableName: fk.sourceTableName ?? tableLabel(tableMap.get(fk.sourceTableId)),
        sourceColumnName: fk.sourceColumnName ?? columnLabel(columnMap.get(fk.sourceColumnId)),
        targetTableName: fk.targetTableName ?? tableLabel(tableMap.get(fk.targetTableId)),
        targetColumnName: fk.targetColumnName ?? columnLabel(columnMap.get(fk.targetColumnId)),
      })),
    [fks, tableMap, columnMap],
  );

  const paged = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    let list = enriched.filter((fk) => {
      if (isVisible === "visible" && !fk.isVisible) return false;
      if (isVisible === "hidden" && fk.isVisible) return false;
      if (!kw) return true;
      const bag = [
        fk.sourceTableName,
        fk.sourceColumnName,
        fk.targetTableName,
        fk.targetColumnName,
        fk.relationType,
        fk.sourceType,
        fk.physicalDescription,
        fk.semanticDescription,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return bag.includes(kw);
    });
    list = [...list].sort((a, b) => {
      const av = (a as any)[sortBy] ?? "";
      const bv = (b as any)[sortBy] ?? "";
      if (typeof av === "number" && typeof bv === "number") {
        return sortOrder === "asc" ? av - bv : bv - av;
      }
      return sortOrder === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePageNo = Math.min(pageNo, totalPages);
    const offset = (safePageNo - 1) * pageSize;
    return { pageNo: safePageNo, pageSize, total, items: list.slice(offset, offset + pageSize) };
  }, [enriched, keyword, isVisible, sortBy, sortOrder, pageNo, pageSize]);

  const columnsFor = (tableId: string) => columns.filter((c) => c.tableId === tableId);

  const openNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
  };
  const openEdit = (row: SemanticForeignKey) => {
    setEditingId(row.id);
    setForm({
      sourceTableId: row.sourceTableId,
      sourceColumnId: row.sourceColumnId,
      targetTableId: row.targetTableId,
      targetColumnId: row.targetColumnId,
      relationType: row.relationType,
      sourceType: row.sourceType,
      confidence: String(row.confidence ?? 1),
      physicalDescription: row.physicalDescription ?? "",
      semanticDescription: row.semanticDescription ?? "",
      isVisible: row.isVisible,
    });
    setFormOpen(true);
  };

  const submit = () => {
    if (!form.sourceTableId || !form.sourceColumnId || !form.targetTableId || !form.targetColumnId) {
      toast.error("请选择源表/源字段/目标表/目标字段");
      return;
    }
    const now = nowIso();
    const payload = {
      sourceTableId: form.sourceTableId,
      sourceColumnId: form.sourceColumnId,
      targetTableId: form.targetTableId,
      targetColumnId: form.targetColumnId,
      relationType: form.relationType,
      sourceType: form.sourceType,
      confidence: Math.max(0, Math.min(1, Number(form.confidence) || 1)),
      physicalDescription: form.physicalDescription.trim() || null,
      semanticDescription: form.semanticDescription.trim() || null,
      isVisible: form.isVisible,
    };
    if (editingId) {
      setForeignKeys(
        fks.map((fk) => (fk.id === editingId ? { ...fk, ...payload, updatedAt: now } : fk)),
      );
      toast.success("外键已更新");
    } else {
      const created: SemanticForeignKey = {
        id: nextId("fk"),
        ...payload,
        sourceTableName: tableLabel(tableMap.get(form.sourceTableId)),
        sourceColumnName: columnLabel(columnMap.get(form.sourceColumnId)),
        targetTableName: tableLabel(tableMap.get(form.targetTableId)),
        targetColumnName: columnLabel(columnMap.get(form.targetColumnId)),
        createdAt: now,
        updatedAt: now,
      };
      setForeignKeys([created, ...fks]);
      toast.success("外键已创建");
    }
    setFormOpen(false);
  };

  const remove = () => {
    if (!pendingDelete) return;
    setForeignKeys(fks.filter((f) => f.id !== pendingDelete.id));
    toast.success("外键已删除");
    setPendingDelete(null);
  };

  const doBatchDelete = () => {
    const ids = new Set(selection.selectedIds);
    setForeignKeys(fks.filter((f) => !ids.has(f.id)));
    toast.success(`已删除 ${ids.size} 条外键`);
    selection.clear();
    setBatchConfirm(false);
  };

  const idsOnPage = paged.items.map((r) => r.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-md bg-primary/10 text-primary">
          <Link2 className="size-4" />
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
            <Button
              onClick={openNew}
              size="sm"
              className="h-9 gap-1"
              disabled={tables.length === 0 || columns.length === 0}
            >
              <Plus className="size-4" /> 新建外键
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
              <th className="px-3 py-2 text-left">源表 · 字段</th>
              <th className="px-3 py-2"></th>
              <th className="px-3 py-2 text-left">目标表 · 字段</th>
              <th className="px-3 py-2 text-left">关系类型</th>
              <th className="px-3 py-2 text-left">来源</th>
              <th className="px-3 py-2 text-left">置信度</th>
              <th className="px-3 py-2 text-left">可见</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {paged.items.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                  当前条件下没有外键。点击"新建外键"把两张表关联起来。
                </td>
              </tr>
            ) : (
              paged.items.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={selection.isSelected(row.id)}
                      onCheckedChange={() => selection.toggle(row.id)}
                      aria-label="选择"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{row.sourceTableName ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{row.sourceColumnName ?? "—"}</div>
                  </td>
                  <td className="px-1 py-2 text-muted-foreground">
                    <ArrowRight className="size-4" />
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{row.targetTableName ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{row.targetColumnName ?? "—"}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">{row.relationType}</td>
                  <td className="px-3 py-2 text-xs">{row.sourceType}</td>
                  <td className="px-3 py-2 text-xs">{(row.confidence * 100).toFixed(0)}%</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded-sm px-1.5 py-0.5 text-[11px]",
                        row.isVisible ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {row.isVisible ? "可见" : "隐藏"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "编辑外键" : "新建外键"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>源表</Label>
              <Select
                value={form.sourceTableId}
                onValueChange={(v) => setForm({ ...form, sourceTableId: v, sourceColumnId: "" })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择源表" />
                </SelectTrigger>
                <SelectContent>
                  {tables.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {tableLabel(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>源字段</Label>
              <Select
                value={form.sourceColumnId}
                onValueChange={(v) => setForm({ ...form, sourceColumnId: v })}
                disabled={!form.sourceTableId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="先选源表" />
                </SelectTrigger>
                <SelectContent>
                  {columnsFor(form.sourceTableId).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {columnLabel(c)} ({c.physicalColumnName})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>目标表</Label>
              <Select
                value={form.targetTableId}
                onValueChange={(v) => setForm({ ...form, targetTableId: v, targetColumnId: "" })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择目标表" />
                </SelectTrigger>
                <SelectContent>
                  {tables.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {tableLabel(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>目标字段</Label>
              <Select
                value={form.targetColumnId}
                onValueChange={(v) => setForm({ ...form, targetColumnId: v })}
                disabled={!form.targetTableId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="先选目标表" />
                </SelectTrigger>
                <SelectContent>
                  {columnsFor(form.targetTableId).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {columnLabel(c)} ({c.physicalColumnName})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>关系类型</Label>
              <Select value={form.relationType} onValueChange={(v) => setForm({ ...form, relationType: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RELATION_TYPES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>来源</Label>
              <Select value={form.sourceType} onValueChange={(v) => setForm({ ...form, sourceType: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_TYPES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>置信度 (0 ~ 1)</Label>
              <Input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={form.confidence}
                onChange={(e) => setForm({ ...form, confidence: e.target.value })}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium">对下游可见</p>
                <p className="text-xs text-muted-foreground">关闭后建议引擎不会走这条关系。</p>
              </div>
              <Switch checked={form.isVisible} onCheckedChange={(v) => setForm({ ...form, isVisible: v })} />
            </div>
            <div className="grid gap-1.5 md:col-span-2">
              <Label>物理描述</Label>
              <Textarea
                value={form.physicalDescription}
                onChange={(e) => setForm({ ...form, physicalDescription: e.target.value })}
                rows={2}
                placeholder="物理关联描述"
              />
            </div>
            <div className="grid gap-1.5 md:col-span-2">
              <Label>语义描述</Label>
              <Textarea
                value={form.semanticDescription}
                onChange={(e) => setForm({ ...form, semanticDescription: e.target.value })}
                rows={2}
                placeholder="订单买家关联用户"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              取消
            </Button>
            <Button onClick={submit}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定删除这条外键？</AlertDialogTitle>
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
            <AlertDialogTitle>确定删除已选中的 {selection.count} 条外键？</AlertDialogTitle>
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
    </div>
  );
};

export default SemanticForeignKeysPage;
