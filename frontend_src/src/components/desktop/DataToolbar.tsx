import { useEffect, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { IsVisibleFilter, SortOrder } from "@/types/app/semantic";

export interface SortOption<T extends string> {
  value: T;
  label: string;
}

interface DataToolbarProps<Sort extends string> {
  keyword: string;
  onKeywordChange: (kw: string) => void;
  isVisible: IsVisibleFilter;
  onIsVisibleChange: (v: IsVisibleFilter) => void;
  sortBy: Sort;
  onSortByChange: (v: Sort) => void;
  sortOrder: SortOrder;
  onSortOrderChange: (v: SortOrder) => void;
  sortOptions: SortOption<Sort>[];
  actions?: ReactNode;
  className?: string;
}

export function DataToolbar<Sort extends string>({
  keyword,
  onKeywordChange,
  isVisible,
  onIsVisibleChange,
  sortBy,
  onSortByChange,
  sortOrder,
  onSortOrderChange,
  sortOptions,
  actions,
  className,
}: DataToolbarProps<Sort>) {
  const [localKw, setLocalKw] = useState(keyword);

  useEffect(() => {
    setLocalKw(keyword);
  }, [keyword]);

  useEffect(() => {
    if (localKw === keyword) return;
    const t = window.setTimeout(() => onKeywordChange(localKw), 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localKw]);

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="relative min-w-[220px] flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={localKw}
          onChange={(e) => setLocalKw(e.target.value)}
          placeholder="搜索关键字…"
          className="h-9 pl-8"
        />
      </div>

      <Select value={isVisible} onValueChange={(v) => onIsVisibleChange(v as IsVisibleFilter)}>
        <SelectTrigger className="h-9 w-[120px]">
          <SelectValue placeholder="显示状态" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部</SelectItem>
          <SelectItem value="visible">仅显示</SelectItem>
          <SelectItem value="hidden">仅隐藏</SelectItem>
        </SelectContent>
      </Select>

      <Select value={sortBy} onValueChange={(v) => onSortByChange(v as Sort)}>
        <SelectTrigger className="h-9 w-[150px]">
          <SelectValue placeholder="排序字段" />
        </SelectTrigger>
        <SelectContent>
          {sortOptions.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={sortOrder} onValueChange={(v) => onSortOrderChange(v as SortOrder)}>
        <SelectTrigger className="h-9 w-[90px]">
          <SelectValue placeholder="顺序" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="desc">降序</SelectItem>
          <SelectItem value="asc">升序</SelectItem>
        </SelectContent>
      </Select>

      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
