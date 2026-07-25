import { useState } from "react";
import { Archive, ArchiveRestore, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreateWatchlist,
  useDeleteWatchlist,
  useUpdateWatchlist,
} from "@/hooks/useWatchlists";
import type { WatchlistSummary } from "@/services/watchlistService";

type EditorState = {
  mode: "create" | "edit";
  item: WatchlistSummary | null;
  name: string;
  description: string;
};

export function WatchlistManagerDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeLists: WatchlistSummary[];
  archivedLists: WatchlistSummary[];
}) {
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WatchlistSummary | null>(null);
  const createMutation = useCreateWatchlist();
  const updateMutation = useUpdateWatchlist();
  const deleteMutation = useDeleteWatchlist();
  const saving = createMutation.isPending || updateMutation.isPending;

  const save = async () => {
    if (!editor?.name.trim()) {
      toast.error("请填写列表名称");
      return;
    }
    try {
      if (editor.mode === "create") {
        await createMutation.mutateAsync({
          name: editor.name.trim(),
          description: nullable(editor.description),
        });
        toast.success("观察列表已创建");
      } else if (editor.item) {
        await updateMutation.mutateAsync({
          item: editor.item,
          patch: {
            name: editor.name.trim(),
            description: nullable(editor.description),
          },
        });
        toast.success("列表信息已更新");
      }
      setEditor(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "列表保存失败");
    }
  };

  const changeStatus = async (item: WatchlistSummary) => {
    try {
      await updateMutation.mutateAsync({
        item,
        patch: { status: item.status === "active" ? "ARCHIVED" : "ACTIVE" },
      });
      toast.success(item.status === "active" ? "列表已归档" : "列表已恢复");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "列表状态更新失败");
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    try {
      await deleteMutation.mutateAsync(pendingDelete);
      toast.success(`已删除列表「${pendingDelete.name}」`);
      setPendingDelete(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "列表删除失败");
    }
  };

  return (
    <>
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <DialogContent className="watchlist-manager-dialog max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>管理观察列表</DialogTitle>
            <DialogDescription>新建、改名、归档、恢复或删除观察列表。</DialogDescription>
          </DialogHeader>

          <div className="watchlist-manager-toolbar">
            <Button
              type="button"
              onClick={() => setEditor({ mode: "create", item: null, name: "", description: "" })}
            >
              <Plus className="size-4" />新建列表
            </Button>
          </div>

          {editor ? (
            <div className="watchlist-manager-editor">
              <div className="space-y-2">
                <Label htmlFor="watchlist-list-name">列表名称</Label>
                <Input
                  id="watchlist-list-name"
                  value={editor.name}
                  onChange={(event) => setEditor((current) => current ? { ...current, name: event.target.value } : null)}
                  maxLength={100}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="watchlist-list-description">列表说明</Label>
                <Textarea
                  id="watchlist-list-description"
                  value={editor.description}
                  onChange={(event) => setEditor((current) => current ? { ...current, description: event.target.value } : null)}
                  maxLength={500}
                />
              </div>
              <div className="watchlist-manager-editor-actions">
                <Button type="button" variant="ghost" onClick={() => setEditor(null)}>取消</Button>
                <Button type="button" onClick={() => void save()} disabled={saving}>
                  {saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
                  {editor.mode === "create" ? "创建列表" : "保存列表"}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="watchlist-manager-groups">
            <ListGroup
              title="活动列表"
              items={props.activeLists}
              onEdit={(item) => setEditor({
                mode: "edit",
                item,
                name: item.name,
                description: item.description ?? "",
              })}
              onStatusChange={(item) => void changeStatus(item)}
              onDelete={setPendingDelete}
            />
            <ListGroup
              title="已归档"
              items={props.archivedLists}
              onEdit={(item) => setEditor({
                mode: "edit",
                item,
                name: item.name,
                description: item.description ?? "",
              })}
              onStatusChange={(item) => void changeStatus(item)}
              onDelete={setPendingDelete}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除观察列表？</AlertDialogTitle>
            <AlertDialogDescription>
              「{pendingDelete?.name}」包含 {pendingDelete?.itemCount ?? 0} 个活动条目和
              {" "}{pendingDelete?.activeConditionCount ?? 0} 条活动规则。删除后条目会移除、规则会暂停，历史提醒仍保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()} className="bg-destructive text-destructive-foreground">
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ListGroup(props: {
  title: string;
  items: WatchlistSummary[];
  onEdit: (item: WatchlistSummary) => void;
  onStatusChange: (item: WatchlistSummary) => void;
  onDelete: (item: WatchlistSummary) => void;
}) {
  return (
    <section className="watchlist-manager-group">
      <h3>{props.title}</h3>
      {props.items.length ? props.items.map((item) => (
        <div key={item.id} className="watchlist-manager-row">
          <div>
            <strong>{item.name}</strong>
            <span>{item.description ?? "无列表说明"}</span>
            <small>{item.itemCount} 个标的 · {item.activeConditionCount} 条规则 · {item.unreadAlertCount} 条未读</small>
          </div>
          <div>
            {item.status === "active" ? (
              <Button type="button" variant="ghost" size="icon" aria-label={`归档 ${item.name}`} onClick={() => props.onStatusChange(item)}>
                <Archive className="size-4" />
              </Button>
            ) : (
              <Button type="button" variant="ghost" size="icon" aria-label={`恢复 ${item.name}`} onClick={() => props.onStatusChange(item)}>
                <ArchiveRestore className="size-4" />
              </Button>
            )}
            <Button type="button" variant="ghost" size="icon" aria-label={`编辑 ${item.name}`} onClick={() => props.onEdit(item)}>
              <Pencil className="size-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" aria-label={`删除 ${item.name}`} onClick={() => props.onDelete(item)}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      )) : <p className="watchlist-manager-empty">暂无列表</p>}
    </section>
  );
}

function nullable(value: string): string | null {
  return value.trim() || null;
}
