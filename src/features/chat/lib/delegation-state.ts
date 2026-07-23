import type { UIMessage } from "ai";

export type DelegationView = {
  key: "explorer" | "reviewer";
  label: "Explorer" | "Reviewer";
  status: "running" | "complete" | "failed";
};

const agentLabels = {
  explorer: "Explorer",
  reviewer: "Reviewer",
} as const;

export function getDelegationView(
  part: UIMessage["parts"][number],
): DelegationView | null {
  const candidate = part as Record<string, unknown>;
  const type = typeof candidate.type === "string" ? candidate.type : "";
  if (type === "data-tool-agent") {
    const data = candidate.data as Record<string, unknown> | undefined;
    const agentId = typeof data?.id === "string" ? data.id : "";
    const key = agentId.replace(/-agent$/, "") as keyof typeof agentLabels;
    if (!(key in agentLabels)) return null;

    const dataStatus = data?.status;
    const status =
      dataStatus === "finished" || dataStatus === "completed"
        ? "complete"
        : dataStatus === "failed" || dataStatus === "error"
          ? "failed"
          : "running";
    return { key, label: agentLabels[key], status };
  }
  const dynamicName =
    type === "dynamic-tool" && typeof candidate.toolName === "string"
      ? candidate.toolName
      : type.replace(/^tool-/, "");
  const key = dynamicName
    .replace(/^agent-/, "")
    .replace(/Agent$/, "") as keyof typeof agentLabels;

  if (!(key in agentLabels)) return null;

  const state = candidate.state;
  const status =
    state === "output-available"
      ? "complete"
      : state === "output-error" || state === "output-denied"
        ? "failed"
        : "running";

  return { key, label: agentLabels[key], status };
}
