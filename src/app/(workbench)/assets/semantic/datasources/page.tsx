"use client";

import { SemanticPageState } from "@/components/desktop/SemanticPageState";
import SemanticDatasourcesPage from "@/features/workbench/pages/SemanticDatasourcesPage";

export default function SemanticDatasourcesRoute() {
  return <SemanticPageState><SemanticDatasourcesPage /></SemanticPageState>;
}
