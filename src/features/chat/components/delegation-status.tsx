import { Check, LoaderCircle, TriangleAlert } from "lucide-react";

import type { DelegationView } from "@/features/chat/lib/delegation-state";

const statusCopy = {
  running: "正在协作",
  complete: "协作完成",
  failed: "协作失败",
};

export function DelegationStatus({ view }: { view: DelegationView }) {
  const Icon =
    view.status === "running"
      ? LoaderCircle
      : view.status === "complete"
        ? Check
        : TriangleAlert;

  return (
    <div
      className="delegation-row"
      data-agent={view.key}
      data-status={view.status}
    >
      <span className="delegation-icon" aria-hidden="true">
        <Icon className={view.status === "running" ? "animate-spin" : ""} />
      </span>
      <span>
        <strong>{view.label}</strong>
        <small>{statusCopy[view.status]}</small>
      </span>
    </div>
  );
}
