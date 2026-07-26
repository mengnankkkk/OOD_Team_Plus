import { ListChecks, Plus, RefreshCw, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WatchlistSummary as WatchlistSummaryType } from "@/services/watchlistService";

export function WatchlistToolbar(props: {
  lists: WatchlistSummaryType[];
  activeListId: string | null;
  checking: boolean;
  onSelectList: (id: string) => void;
  onManageLists: () => void;
  onCheck: () => void;
  onAdd: () => void;
}) {
  return (
    <section className="watchlist-toolbar" aria-label="持仓观测工具栏">
      <div className="watchlist-list-selector">
        <span><ListChecks className="size-4" />观察列表</span>
        <Select
          value={props.activeListId ?? undefined}
          onValueChange={props.onSelectList}
          disabled={!props.lists.length}
        >
          <SelectTrigger aria-label="当前观察列表">
            <SelectValue placeholder="选择观察列表" />
          </SelectTrigger>
          <SelectContent>
            {props.lists.map((list) => (
              <SelectItem key={list.id} value={list.id}>
                {list.name} · {list.itemCount}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="watchlist-toolbar-actions">
        <Button type="button" variant="outline" onClick={props.onManageLists}>
          <Settings2 className="size-4" />管理列表
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={props.onCheck}
          disabled={!props.activeListId || props.checking}
        >
          <RefreshCw className={`size-4 ${props.checking ? "animate-spin" : ""}`} />
          {props.checking ? "检查中" : "立即检查"}
        </Button>
        <Button type="button" onClick={props.onAdd} disabled={!props.activeListId}>
          <Plus className="size-4" />添加标的
        </Button>
      </div>
    </section>
  );
}
