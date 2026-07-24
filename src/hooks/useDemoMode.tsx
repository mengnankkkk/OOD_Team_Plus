import { createContext, useContext, useEffect, useMemo, useState } from "react";

interface DemoModeContextValue {
  judgeMode: boolean;
  toggle: () => void;
  setJudgeMode: (v: boolean) => void;
}

const DemoModeContext = createContext<DemoModeContextValue | null>(null);
const STORAGE_KEY = "mw:judge-mode";

export const DemoModeProvider = ({ children }: { children: React.ReactNode }) => {
  const [judgeMode, setJudgeMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(STORAGE_KEY) === "1";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY, judgeMode ? "1" : "0");
    document.body.classList.toggle("judge-mode", judgeMode);
  }, [judgeMode]);

  const value = useMemo(() => ({ judgeMode, toggle: () => setJudgeMode((v) => !v), setJudgeMode }), [judgeMode]);
  return <DemoModeContext.Provider value={value}>{children}</DemoModeContext.Provider>;
};

export const useDemoMode = () => {
  const ctx = useContext(DemoModeContext);
  if (!ctx) throw new Error("useDemoMode must be used within DemoModeProvider");
  return ctx;
};
