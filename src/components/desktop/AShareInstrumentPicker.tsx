import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, LoaderCircle, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { findAShareStock, searchAShareStocks } from "@/lib/a-share-stocks";
import { apiGet } from "@/features/frontend-migration/api";

export type InstrumentSearchResult = {
  code?: string;
  name: string;
  symbol: string;
  instrumentId: string;
  assetType: string;
  sector?: string | null;
  market?: string;
  tradable: boolean;
};

type PickerInstrument = InstrumentSearchResult & { symbol: string };

type InstrumentSearchPage = {
  items: PickerInstrument[];
  pagination?: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
    total: number;
  };
};

type Props = {
  name: string;
  symbol: string;
  onChange: (next: { name: string; symbol: string; stock: InstrumentSearchResult | null }) => void;
  onSelect?: (stock: InstrumentSearchResult) => void;
  searchLabel?: string;
  nameLabel?: string;
  symbolLabel?: string;
  namePlaceholder?: string;
  symbolPlaceholder?: string;
  searchPlaceholder?: string;
};

const SEARCH_PAGE_SIZE = 8;

export default function AShareInstrumentPicker({
  name,
  symbol,
  onChange,
  onSelect,
  searchLabel = "搜索标的",
  nameLabel = "标的名称",
  symbolLabel = "代码",
  namePlaceholder = "贵州茅台",
  symbolPlaceholder = "600519",
  searchPlaceholder = "输入代码或名称，例如 600519 / 贵州茅台",
}: Props) {
  const [searchText, setSearchText] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [remoteMatches, setRemoteMatches] = useState<PickerInstrument[]>([]);
  const [remoteCursor, setRemoteCursor] = useState<string | null>(null);
  const [remoteHasMore, setRemoteHasMore] = useState(false);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(SEARCH_PAGE_SIZE);
  const requestVersionRef = useRef(0);
  const localMatches = useMemo(() => searchText.trim() ? searchAShareStocks(searchText, Number.POSITIVE_INFINITY).map((stock) => ({ ...stock, symbol: stock.code, instrumentId: stock.code, assetType: "STOCK", market: stock.code.startsWith("6") ? "SH" : "SZ", tradable: true })) : [], [searchText]);

  useEffect(() => {
    const query = searchText.trim();
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setRemoteMatches([]);
    setRemoteCursor(null);
    setRemoteHasMore(false);
    setRemoteLoading(false);
    setVisibleLimit(SEARCH_PAGE_SIZE);
    if (!query) return;

    const timer = window.setTimeout(() => {
      setRemoteLoading(true);
      apiGet<InstrumentSearchPage>(`/api/v1/instruments/search?q=${encodeURIComponent(query)}&limit=${SEARCH_PAGE_SIZE}&cursor=0`)
        .then((result) => {
          if (requestVersionRef.current !== requestVersion) return;
          setRemoteMatches(result.items.filter((item) => item.tradable));
          setRemoteCursor(result.pagination?.nextCursor ?? null);
          setRemoteHasMore(Boolean(result.pagination?.hasMore));
        })
        .catch(() => {
          if (requestVersionRef.current !== requestVersion) return;
          setRemoteMatches([]);
          setRemoteCursor(null);
          setRemoteHasMore(false);
        })
        .finally(() => {
          if (requestVersionRef.current === requestVersion) setRemoteLoading(false);
        });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const mergedMatches = useMemo(() => [...new Map([...localMatches, ...remoteMatches].map((item) => [item.symbol, item])).values()], [localMatches, remoteMatches]);
  const matches = useMemo(() => mergedMatches.slice(0, visibleLimit), [mergedMatches, visibleLimit]);
  const canLoadMore = mergedMatches.length > visibleLimit || remoteHasMore;

  const handleLoadMore = async () => {
    if (remoteLoading) return;
    const nextVisibleLimit = visibleLimit + SEARCH_PAGE_SIZE;
    if (mergedMatches.length > visibleLimit) {
      setVisibleLimit(nextVisibleLimit);
      return;
    }
    if (!remoteHasMore || !remoteCursor) return;

    const query = searchText.trim();
    const requestVersion = requestVersionRef.current;
    setRemoteLoading(true);
    try {
      const result = await apiGet<InstrumentSearchPage>(`/api/v1/instruments/search?q=${encodeURIComponent(query)}&limit=${SEARCH_PAGE_SIZE}&cursor=${encodeURIComponent(remoteCursor)}`);
      if (requestVersionRef.current !== requestVersion) return;
      setRemoteMatches((current) => [...new Map([...current, ...result.items.filter((item) => item.tradable)].map((item) => [item.symbol, item])).values()]);
      setRemoteCursor(result.pagination?.nextCursor ?? null);
      setRemoteHasMore(Boolean(result.pagination?.hasMore));
      setVisibleLimit(nextVisibleLimit);
    } catch {
      if (requestVersionRef.current !== requestVersion) return;
      setRemoteCursor(null);
      setRemoteHasMore(false);
    } finally {
      if (requestVersionRef.current === requestVersion) setRemoteLoading(false);
    }
  };

  const applyStock = (stock: PickerInstrument) => {
    setSearchText(`${stock.symbol} ${stock.name}`);
    setSuggestOpen(false);
    onChange({ name: stock.name, symbol: stock.symbol, stock });
    onSelect?.(stock);
  };

  const handleSearchChange = (value: string) => {
    setSearchText(value);
    setSuggestOpen(true);
    const stock = findAShareStock(value);
    if (stock) {
      const match = { ...stock, symbol: stock.code, instrumentId: stock.code, assetType: "STOCK", market: stock.code.startsWith("6") ? "SH" : "SZ", tradable: true };
      onChange({ name: match.name, symbol: match.symbol, stock: match });
      onSelect?.(match);
    }
  };

  const handleNameChange = (value: string) => {
    const stock = findAShareStock(value);
    if (stock) {
      setSearchText(`${stock.code} ${stock.name}`);
      const match = { ...stock, symbol: stock.code, instrumentId: stock.code, assetType: "STOCK", market: stock.code.startsWith("6") ? "SH" : "SZ", tradable: true };
      onChange({ name: match.name, symbol: match.symbol, stock: match });
      onSelect?.(match);
      return;
    }
    onChange({ name: value, symbol, stock: null });
  };

  const handleSymbolChange = (value: string) => {
    const stock = findAShareStock(value);
    if (stock) {
      setSearchText(`${stock.code} ${stock.name}`);
      const match = { ...stock, symbol: stock.code, instrumentId: stock.code, assetType: "STOCK", market: stock.code.startsWith("6") ? "SH" : "SZ", tradable: true };
      onChange({ name: match.name, symbol: match.symbol, stock: match });
      onSelect?.(match);
      return;
    }
    onChange({ name, symbol: value, stock: null });
  };

  return (
    <div className="grid gap-4">
      <div className="space-y-2">
        <Label>{searchLabel}</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchText}
            onFocus={() => setSuggestOpen(true)}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="pl-9"
          />
          {suggestOpen && (matches.length || remoteLoading) ? (
            <div className="absolute inset-x-0 top-[calc(100%+6px)] z-50 max-h-64 overflow-auto rounded-md border border-border bg-popover p-1 shadow-xl">
              {matches.map((stock) => (
                <button
                  key={stock.symbol}
                  type="button"
                  onClick={() => applyStock(stock)}
                  className="flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-accent hover:text-primary"
                >
                  <span className="font-medium">{stock.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{stock.symbol}</span>
                </button>
              ))}
              {canLoadMore ? (
                <button
                  type="button"
                  onClick={() => void handleLoadMore()}
                  disabled={remoteLoading}
                  className="mt-1 flex h-9 w-full items-center justify-center gap-2 border-t border-border px-3 pt-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-60"
                >
                  {remoteLoading ? <LoaderCircle className="size-4 animate-spin" /> : <ChevronDown className="size-4" />}
                  {remoteLoading ? "加载中…" : "加载更多"}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-[1fr_140px]">
        <div className="space-y-2">
          <Label htmlFor="a-share-instrument-name">{nameLabel}</Label>
          <Input id="a-share-instrument-name" value={name} onChange={(event) => handleNameChange(event.target.value)} placeholder={namePlaceholder} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="a-share-instrument-symbol">{symbolLabel}</Label>
          <Input id="a-share-instrument-symbol" value={symbol} onChange={(event) => handleSymbolChange(event.target.value)} placeholder={symbolPlaceholder} />
        </div>
      </div>
    </div>
  );
}
