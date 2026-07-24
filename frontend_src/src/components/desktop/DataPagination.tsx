import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface DataPaginationProps {
  pageNo: number;
  pageSize: number;
  total: number;
  onPageChange: (pageNo: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: number[];
}

export function DataPagination({
  pageNo,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50],
}: DataPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canPrev = pageNo > 1;
  const canNext = pageNo < totalPages;
  const startIdx = total === 0 ? 0 : (pageNo - 1) * pageSize + 1;
  const endIdx = Math.min(total, pageNo * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm text-muted-foreground">
      <div>
        共 {total} 条 · 显示 {startIdx}-{endIdx}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!canPrev}
          onClick={() => onPageChange(Math.max(1, pageNo - 1))}
          className="h-8 gap-1 px-2"
        >
          <ChevronLeft className="size-4" />
          上一页
        </Button>
        <span className="min-w-[64px] text-center text-foreground">
          {pageNo} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={!canNext}
          onClick={() => onPageChange(Math.min(totalPages, pageNo + 1))}
          className="h-8 gap-1 px-2"
        >
          下一页
          <ChevronRight className="size-4" />
        </Button>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger className="ml-2 h-8 w-[110px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((n) => (
              <SelectItem key={n} value={String(n)}>
                每页 {n} 条
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
