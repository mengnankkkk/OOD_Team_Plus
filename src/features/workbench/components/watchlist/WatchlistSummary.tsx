import { BellRing, CircleGauge, DatabaseZap, Layers3, WalletCards } from "lucide-react";

import { formatDateTime } from "./watchlist-format";

const metrics = [
  { key: "itemCount", label: "观察对象", detail: "当前列表", icon: Layers3 },
  { key: "heldCount", label: "已持有", detail: "组合内标的", icon: WalletCards },
  { key: "activeConditionCount", label: "活动规则", detail: "结构化条件", icon: CircleGauge },
  { key: "unreadAlertCount", label: "待处理提醒", detail: "未读且未忽略", icon: BellRing },
  { key: "insufficientDataCount", label: "数据不足", detail: "待补证据项", icon: DatabaseZap },
] as const;

export function WatchlistSummary(props: {
  itemCount: number;
  heldCount: number;
  activeConditionCount: number;
  unreadAlertCount: number;
  insufficientDataCount: number;
  lastCheckedAt: string | null;
}) {
  return (
    <section className="watchlist-summary" aria-label="观察列表概况">
      {metrics.map(({ key, label, detail, icon: Icon }) => (
        <div key={key}>
          <span><Icon className="size-4" />{label}</span>
          <strong>{props[key]}</strong>
          <small>{detail}</small>
        </div>
      ))}
      <div className="watchlist-summary-time">
        <span>最近检查</span>
        <strong>{props.lastCheckedAt ? formatDateTime(props.lastCheckedAt) : "尚未检查"}</strong>
        <small>规则或行情扫描</small>
      </div>
    </section>
  );
}
