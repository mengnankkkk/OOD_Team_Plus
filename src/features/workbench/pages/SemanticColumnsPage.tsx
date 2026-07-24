import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "@/features/frontend-migration/router";
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
import { ArrowLeft, Columns3, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import type { ColumnSortField, IsVisibleFilter, SemanticColumn, SortOrder } from "@/types/app/semantic";
import { cn } from "@/lib/utils";
import { DataToolbar, type SortOption } from "@/components/desktop/DataToolbar";
import { DataPagination } from "@/components/desktop/DataPagination";
import { useTableSelection } from "@/hooks/useTableSelection";
import { setColumns, useColumns, useTables } from "@/lib/semanticStore";
import { nextId, nowIso } from "@/lib/semanticIds";

const DATA_TYPES = ["bigint", "integer", "numeric", "text", "varchar", "boolean", "timestamptz", "date", "jsonb", "uuid"];
const BUSINESS_TYPES = [
  { value: "", label: "未设置" },
  { value: "id", label: "标识 id" },
  { value: "user_id", label: "用户 id" },
  { value: "money", label: "金额" },
  { value: "quantity", label: "数量" },
  { value: "timestamp", label: "时间戳" },
  { value: "category", label: "分类" },
  { value: "status", label: "状态枚举" },
  { value: "text", label: "文本" },
];

const SORT_OPTIONS: SortOption<ColumnSortField>[] = [
  { value: "ordinalPosition", label: "字段顺序" },
  { value: "updatedAt", label: "更新时间" },
  { value: "createdAt", label: "创建时间" },
  { value: "physicalColumnName", label: "物理字段名" },
  { value: "semanticName", label: "语义名" },
];

interface FormState {
  physicalColumnName: string;
  ordinalPosition: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  defaultValue: string;
  physicalDescription: string;
  semanticName: string;
  semanticDescription: string;
  businessType: string;
  exampleValues: string;
  isVisible: boolean;
}

const emptyForm: FormState = {
  physicalColumnName: "",
  ordinalPosition: "",
  dataType: "text",
  isNullable: true,
  isPrimaryKey: false,
  defaultValue: "",
  physicalDescription: "",
  semanticName: "",
  semanticDescription: "",
  businessType: "",
  exampleValues: "",
  isVisible: true,
};

const SemanticColumnsPage = () => {
  const { tableId = "" } = useParams<{ tableId: string }>();
  const navigate = useNavigate();
  const tables = useTables();
  const allColumns = useColumns();
  const table = tables.find((t) => t.id === tableId) ?? null;

  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [isVisible, setIsVisible] = useState<IsVisibleFilter>("all");
  const [sortBy, setSortBy] = useState<ColumnSortField>("ordinalPosition");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");

  const selection = useTableSelection();

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [pendingDelete, setPendingDelete] = useState<SemanticColumn | null>(null);
  const [batchConfirm, setBatchConfirm] = useState(false);

  useEffect(() => {
    setPageNo(1);
  }, [keyword, isVisible, sortBy, sortOrder, pageSize]);

  const paged = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    let list = allColumns.filter((c) => {
      if (c.tableId !== tableId) return false;
      if (isVisible === "visible" && !c.isVisible) return false;
      if (isVisible === "hidden" && c.isVisible) return false;
      if (!kw) return true;
      return (
        c.physicalColumnName.toLowerCase().includes(kw) ||
        (c.semanticName ?? "").toLowerCase().includes(kw) ||
        (c.physicalDescription ?? "").toLowerCase().includes(kw) ||
        (c.semanticDescription ?? "").toLowerCase().includes(kw)
      );
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
  }, [allColumns, tableId, keyword, isVisible, sortBy, sortOrder, pageNo, pageSize]);

  const openNew = () => {
    setEditingId(null);
    setForm({ ...emptyForm, ordinalPosition: String(paged.total + 1) });
    setFormOpen(true);
  };
  const openEdit = (row: SemanticColumn) => {
    setEditingId(row.id);
    setForm({
      physicalColumnName: row.physicalColumnName,
      ordinalPosition: row.ordinalPosition !== null ? String(row.ordinalPosition) : "",
      dataType: row.dataType ?? "text",
      isNullable: row.isNullable,
      isPrimaryKey: row.isPrimaryKey,
      defaultValue: row.defaultValue ?? "",
      physicalDescription: row.physicalDescription ?? "",
      semanticName: row.semanticName ?? "",
      semanticDescription: row.semanticDescription ?? "",
      businessType: row.businessType ?? "",
      exampleValues: row.exampleValues.join(", "),
      isVisible: row.isVisible,
    });
    setFormOpen(true);
  };

  const submit = () => {
    if (!form.physicalColumnName.trim()) {
      toast.error("物理字段名不能为空");
      return;
    }
    const now = nowIso();
    const payload = {
      physicalColumnName: form.physicalColumnName.trim(),
      ordinalPosition: form.ordinalPosition ? Number(form.ordinalPosition) : null,
      dataType: form.dataType || null,
      isNullable: form.isNullable,
      isPrimaryKey: form.isPrimaryKey,
      defaultValue: form.defaultValue.trim() || null,
      physicalDescription: form.physicalDescription.trim() || null,
      semanticName: form.semanticName.trim() || null,
      semanticDescription: form.semanticDescription.trim() || null,
      businessType: form.businessType || null,
      exampleValues: form.exampleValues.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      isVisible: form.isVisible,
    };
    if (editingId) {
      setColumns(allColumns.map((c) => (c.id === editingId ? { ...c, ...payload, updatedAt: now } : c)));
      toast.success("字段已更新");
    } else {
      const created: SemanticColumn = {
        id: nextId("col"),
        tableId,
        ...payload,
        syncStatus: "active",
        createdAt: now,
        updatedAt: now,
      };
      setColumns([created, ...allColumns]);
      toast.success("字段已新增");
    }
    setFormOpen(false);
  };

  const remove = () => {
    if (!pendingDelete) return;
    setColumns(allColumns.filter((c) => c.id !== pendingDelete.id));
    toast.success("字段已删除");
    setPendingDelete(null);
  };

  const doBatchDelete = () => {
    const ids = new Set(selection.selectedIds);
    setColumns(allColumns.filter((c) => !ids.has(c.id)));
    toast.success(`已删除 ${ids.size} 个字段`);
    selection.clear();
    setBatchConfirm(false);
  };

  const idsOnPage = paged.items.map((r) => r.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" className="gap-1" onClick={() => navigate("/assets/semantic/tables")}>
          <ArrowLeft className="size-4" /> 返回表管理
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-md bg-primary/10 text-primary">
          <Columns3 className="size-4" />
        </div>
        <div>
          <p className="eyebrow">资产 · 语义层 · 表管理 · 字段管理</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {table ? (
              <>
                {table.semanticName || table.physicalTableName}
                <span className="ml-2 font-mono text-sm text-muted-foreground">({table.physicalTableName})</span>
              </>
            ) : (
              "字段管理"
            )}
          </h1>
        </div>
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
            <Button onClick={openNew} size="sm" className="h-9 gap-1" disabled={!table}>
              <Plus className="size-4" /> 新增字段
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
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">物理字段</th>
              <th className="px-3 py-2 text-left">类型</th>
              <th className="px-3 py-2 text-left">主键</th>
              <th className="px-3 py-2 text-left">语义名</th>
              <th className="px-3 py-2 text-left">业务类型</th>
              <th className="px-3 py-2 text-left">同步状态</th>
              <th className="px-3 py-2 text-left">可见</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {paged.items.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                  当前条件下没有字段。点击"新增字段"或去表管理执行同步。
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
                        aria-label={`选择 ${row.physicalColumnName}`}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{row.ordinalPosition ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.physicalColumnName}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {row.dataType}
                      {row.isNullable ? "" : " · not null"}
                    </td>
                    <td className="px-3 py-2">
                      {row.isPrimaryKey ? (
                        <span className="inline-flex items-center gap-1 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                          <KeyRound className="size-3" /> PK
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-medium">{row.semanticName || "—"}</td>
                    <td className="px-3 py-2 text-xs">{row.businessType || "—"}</td>
                    <td className="px-3 py-2">
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "编辑字段" : "新增字段"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>物理字段名</Label>
              <Input
                value={form.physicalColumnName}
                onChange={(e) => setForm({ ...form, physicalColumnName: e.target.value })}
                placeholder="buyer_id"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>顺序 (ordinal_position)</Label>
              <Input
                type="number"
                value={form.ordinalPosition}
                onChange={(e) => setForm({ ...form, ordinalPosition: e.target.value })}
                placeholder="1"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>数据类型</Label>
              <Select value={form.dataType} onValueChange={(v) => setForm({ ...form, dataType: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATA_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>默认值</Label>
              <Input
                value={form.defaultValue}
                onChange={(e) => setForm({ ...form, defaultValue: e.target.value })}
                placeholder="null"
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium">允许 NULL</p>
                <p className="text-xs text-muted-foreground">物理字段的 nullable 语义。</p>
              </div>
              <Switch checked={form.isNullable} onCheckedChange={(v) => setForm({ ...form, isNullable: v })} />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium">主键</p>
                <p className="text-xs text-muted-foreground">是否是主键或组合主键的一部分。</p>
              </div>
              <Switch
                checked={form.isPrimaryKey}
                onCheckedChange={(v) => setForm({ ...form, isPrimaryKey: v })}
              />
            </div>
            <div className="grid gap-1.5 md:col-span-2">
              <Label>物理字段描述</Label>
              <Textarea
                value={form.physicalDescription}
                onChange={(e) => setForm({ ...form, physicalDescription: e.target.value })}
                rows={2}
                placeholder="买家用户 ID"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>语义名</Label>
              <Input
                value={form.semanticName}
                onChange={(e) => setForm({ ...form, semanticName: e.target.value })}
                placeholder="买家ID"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>业务类型</Label>
              <Select
                value={form.businessType || "__unset"}
                onValueChange={(v) => setForm({ ...form, businessType: v === "__unset" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择业务类型" />
                </SelectTrigger>
                <SelectContent>
                  {BUSINESS_TYPES.map((b) => (
                    <SelectItem key={b.value || "__unset"} value={b.value || "__unset"}>
                      {b.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5 md:col-span-2">
              <Label>语义描述</Label>
              <Textarea
                value={form.semanticDescription}
                onChange={(e) => setForm({ ...form, semanticDescription: e.target.value })}
                rows={2}
                placeholder="订单买家用户 ID"
              />
            </div>
            <div className="grid gap-1.5 md:col-span-2">
              <Label>示例值（逗号分隔）</Label>
              <Input
                value={form.exampleValues}
                onChange={(e) => setForm({ ...form, exampleValues: e.target.value })}
                placeholder="10001, 10002"
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3 md:col-span-2">
              <div>
                <p className="text-sm font-medium">对下游可见</p>
                <p className="text-xs text-muted-foreground">关闭后建议引擎不会使用这个字段。</p>
              </div>
              <Switch checked={form.isVisible} onCheckedChange={(v) => setForm({ ...form, isVisible: v })} />
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
            <AlertDialogTitle>
              确定删除字段"{pendingDelete?.semanticName || pendingDelete?.physicalColumnName}"？
            </AlertDialogTitle>
            <AlertDialogDescription>删除后将同步更新 SQLite 语义层配置，此操作不可撤销。</AlertDialogDescription>
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
            <AlertDialogTitle>确定删除已选中的 {selection.count} 个字段？</AlertDialogTitle>
            <AlertDialogDescription>删除后将同步更新 SQLite 语义层配置，此操作不可撤销。</AlertDialogDescription>
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

export default SemanticColumnsPage;
