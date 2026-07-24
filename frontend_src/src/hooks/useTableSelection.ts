import { useCallback, useMemo, useState } from "react";

export interface TableSelection {
  selectedIds: string[];
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  toggleAll: (idsOnPage: string[]) => void;
  clear: () => void;
  allSelected: (idsOnPage: string[]) => boolean;
  someSelected: (idsOnPage: string[]) => boolean;
  count: number;
}

export function useTableSelection(): TableSelection {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback((idsOnPage: string[]) => {
    setSelected((prev) => {
      const allOn = idsOnPage.length > 0 && idsOnPage.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allOn) {
        for (const id of idsOnPage) next.delete(id);
      } else {
        for (const id of idsOnPage) next.add(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  return useMemo(
    () => ({
      selectedIds: Array.from(selected),
      isSelected: (id: string) => selected.has(id),
      toggle,
      toggleAll,
      clear,
      allSelected: (idsOnPage: string[]) => idsOnPage.length > 0 && idsOnPage.every((id) => selected.has(id)),
      someSelected: (idsOnPage: string[]) =>
        idsOnPage.some((id) => selected.has(id)) && !idsOnPage.every((id) => selected.has(id)),
      count: selected.size,
    }),
    [selected, toggle, toggleAll, clear],
  );
}
