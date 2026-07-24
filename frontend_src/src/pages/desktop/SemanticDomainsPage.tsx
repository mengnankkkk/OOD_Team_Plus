import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import { Layers, Pencil, Plus, Trash2 } from "lucide-react";
import type { DomainSortField, IsVisibleFilter, SemanticDomain, SortOrder } from "@/types/app/semantic";
import { cn } from "@/lib/utils";
import { DataToolbar, type SortOption } from "@/components/desktop/DataToolbar";
import { DataPagination } from "@/components/desktop/DataPagination";
import { useTableSelection } from "@/hooks/useTableSelection";
import { setDomains, useDomains } from "@/lib/mockSemanticStore";
import { nextId, nowIso } from "@/lib/mockSemanticData";

const SUB_NAV = [
  { path: "/assets/semantic/domains", label: "领域管理" },
  { path: "/assets/semantic/tables", label: "表管理" },
  { path: "/assets/semantic/foreign-keys", label: "外键管理" },
];

const SORT_OPTIONS: SortOption<DomainSortField>[] = [
  { value: "updatedAt", label: "更新时间" },
  { value: "createdAt", label: "创建时间" },
  { value: "name", label: "领域名称" },
];

interface FormState {
  name: string;
  description: string;
  isVisible: boolean;
}

const emptyForm: FormState = { name: "", description: "", isVisible: true };

const SemanticDomainsPage = () => {
  const domains = useDomains();

  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [isVisible, setIsVisible] = useState<IsVisibleFilter>("all");
  const [sortBy, setSortBy] = useState<DomainSortField>("updatedAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const selection = useTableSelection();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SemanticDomain | null>(null);
  const [batchConfirm, setBatchConfirm] = useState(false);

  useEffect(() => {
    setPageNo(1);
  }, [keyword, isVisible, sortBy, sortOrder, pageSize]);

  const paged = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    let list = domains.filter((d) => {
      if (isVisible === "visible" && !d.isVisible) return false;
      if (isVisible === "hidden" && d.isVisible) return false;
      if (!kw) return true;
      return d.name.toLowerCase().includes(kw) || (d.description ?? "").toLowerCase().includes(kw);
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
  }, [domains, pageNo, pageSize, keyword, isVisible, sortBy, sortOrder]);

  const openNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
  };
  const openEdit = (row: SemanticDomain) => {
    setEditingId(row.id);
    setForm({ name: row.name, description: row.description ?? "", isVisible: row.isVisible });
    setFormOpen(true);
  };

  const submit = () => {
    if (!form.name.trim()) {
      toast.error("领域名称不能为空");
      return;
    }
    const now = nowIso();
    if (editingId) {
      setDomains(
        domains.map((d) =>
          d.id === editingId
            ? { ...d, name: form.name.trim(), description: form.description.trim() || null, isVisible: form.isVisible, updatedAt: now }
            : d,
        ),
      );
      toast.success("领域已更新");
    } else {
      const created: SemanticDomain = {
        id: nextId("dom"),
        name: form.name.trim(),
        description: form.description.trim() || null,
        isVisible: form.isVisible,
        createdAt: now,
        updatedAt: now,
      };
      setDomains([created, ...domains]);
      toast.success("领域已创建");
    }
    setFormOpen(false);
  };

  const remove = () => {
    if (!pendingDelete) return;
    setDomains(domains.filter((d) => d.id !== pendingDelete.id));
    toast.success("领域已删除");
    setPendingDelete(null);
  };

  const doBatchDelete = () => {
    const ids = new Set(selection.selectedIds);
    setDomains(domains.filter((d) => !ids.has(d.id)));
    toast.success(`已删除 ${ids.size} 个领域`);
    selection.clear();
    setBatchConfirm(false);
  };

  const idsOnPage = paged.items.map((r) => r.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-md bg-primary/10 text-primary">
          <Layers className="size-4" />
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
            <Button onClick={openNew} size="sm" className="h-9 gap-1">
              <Plus className="size-4" /> 新建领域
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
              <th className="px-4 py-2 text-left">名称</th>
              <th className="px-4 py-2 text-left">描述</th>
              <th className="px-4 py-2 text-left">可见</th>
              <th className="px-4 py-2 text-left">更新时间</th>
              <th className="px-4 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {paged.items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  没有匹配的领域。清空关键字或点击"新建领域"来开始。
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
                  <td className="px-4 py-2 font-medium">{row.name}</td>
                  <td className="px-4 py-2 text-muted-foreground">{row.description || "—"}</td>
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
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {new Date(row.updatedAt).toLocaleString("zh-CN")}
                  </td>
                  <td className="px-4 py-2">
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "编辑领域" : "新建领域"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>领域名称</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例如：交易 / 用户 / 营销"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>描述</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="这个领域包含哪些表、承担什么业务？"
                rows={3}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium">对下游可见</p>
                <p className="text-xs text-muted-foreground">关闭后建议引擎不会引用这个领域下的模型。</p>
              </div>
              <Switch
                checked={form.isVisible}
                onCheckedChange={(v) => setForm({ ...form, isVisible: v })}
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
            <AlertDialogTitle>确定删除领域"{pendingDelete?.name}"？</AlertDialogTitle>
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
            <AlertDialogTitle>确定删除已选中的 {selection.count} 个领域？</AlertDialogTitle>
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

export default SemanticDomainsPage;
