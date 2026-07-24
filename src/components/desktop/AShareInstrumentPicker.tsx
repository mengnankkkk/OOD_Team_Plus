import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";

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
  const localMatches = useMemo(() => searchText.trim() ? searchAShareStocks(searchText, 8).map((stock) => ({ ...stock, symbol: stock.code, instrumentId: stock.code, assetType: "STOCK", market: stock.code.startsWith("6") ? "SH" : "SZ", tradable: true })) : [], [searchText]);
  useEffect(() => {
    const query = searchText.trim();
    if (!query) { setRemoteMatches([]); return; }
    const timer = window.setTimeout(() => {
      apiGet<{ items: Array<InstrumentSearchResult & { symbol: string }> }>(`/api/v1/instruments/search?q=${encodeURIComponent(query)}&limit=12`)
        .then((result) => setRemoteMatches(result.items.filter((item) => item.tradable)))
        .catch(() => setRemoteMatches([]));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [searchText]);
  const matches = useMemo(() => [...new Map([...remoteMatches, ...localMatches].map((item) => [item.symbol, item])).values()].slice(0, 8), [localMatches, remoteMatches]);

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
          {suggestOpen && matches.length ? (
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
