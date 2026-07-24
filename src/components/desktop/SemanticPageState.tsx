"use client";

import { RefreshCw } from "lucide-react";

import { reloadSemanticLayer, useSemanticStatus } from "@/lib/semanticStore";

export function SemanticPageState({ children }: { children: React.ReactNode }) {
  const status = useSemanticStatus();
  if (status.loading && !status.loaded) return <div className="state-panel">正在读取语义层…</div>;
  if (status.error && !status.loaded) return <div className="state-panel error"><p>{status.error}</p><button className="button ghost" onClick={() => void reloadSemanticLayer()}><RefreshCw className="size-4" />重试</button></div>;
  return <>{status.error ? <div className="error-banner" role="alert">{status.error}<button className="button ghost" onClick={() => void reloadSemanticLayer()}>重新加载</button></div> : null}{children}</>;
}
