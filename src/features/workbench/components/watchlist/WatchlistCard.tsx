import type { ReactNode } from "react";
import {
  ArrowRightLeft,
  BellRing,
  CalendarClock,
  MessageCircleQuestion,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { WatchlistItem } from "@/services/watchlistService";

import {
  conditionSummary,
  formatAvailability,
  formatDateTime,
  formatMoney,
  formatPercentRatio,
} from "./watchlist-format";

const riskLabels = {
  increasing: "风险上升",
  decreasing: "风险下降",
  stable: "风险稳定",
  insufficient_data: "风险数据不足",
};

const concentrationLabels = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "极高",
  insufficient_data: "数据不足",
};

export function WatchlistCard(props: {
  item: WatchlistItem;
  checking?: boolean;
  onAskAdvisor: () => void;
  onCheck: () => void;
  onEdit: () => void;
  onManageConditions: () => void;
  onMove: () => void;
  onRemove: () => void;
}) {
  const { item } = props;
  const drawdownRule = item.drawdown_threshold_bps == null
    ? null
    : conditionSummary({
      conditionType: "DRAWDOWN_REACH",
      threshold: String(item.drawdown_threshold_bps / 10_000),
      thresholdDate: null,
      windowDays: 20,
    });
  return (
    <article className="watchlist-card" aria-label={`${item.name} ${item.symbol}`}>
      <header className="watchlist-card-header">
        <div className="watchlist-card-identity">
          <div className="watchlist-card-title-row">
            <h2>{item.name}</h2>
            <span className={item.portfolioRelation.isHeld ? "is-held" : "is-unheld"}>
              {item.portfolioRelation.isHeld ? "已持有" : "未持有"}
            </span>
          </div>
          <p>{item.symbol} · {item.instrument.assetType.toUpperCase()}</p>
        </div>
        <div className="watchlist-card-price">
          <strong>{formatMoney(item.market.price)}</strong>
          <span className={toneForMove(item.market.dailyMovePct)}>
            {formatPercentRatio(item.market.dailyMovePct)}
          </span>
        </div>
      </header>

      <div className="watchlist-card-source">
        <span>{formatAvailability(item.market.status)}</span>
        <span>行情 {formatDateTime(item.market.dataAsOf)}</span>
      </div>

      <div className="watchlist-data-grid">
        <DataPoint
          label="持仓权重"
          value={item.portfolioRelation.isHeld
            ? formatPercentRatio(item.portfolioRelation.weight)
            : "未持有"}
        />
        <DataPoint
          label="浮盈比例"
          value={item.portfolioRelation.isHeld
            ? formatPercentRatio(item.portfolioRelation.unrealizedGainPct)
            : "未持有"}
        />
        <DataPoint label="风险变化" value={riskLabels[item.risk.status]} />
        <DataPoint label="估值证据" value={item.valuation.label} />
        <DataPoint
          label="组合行业集中度"
          value={`${item.industryConcentration.sector ?? "未知行业"} · ${concentrationLabels[item.industryConcentration.level]}`}
        />
        <DataPoint
          label="最近事件"
          value={item.recentEvent?.title ?? "暂无明确关联事件"}
        />
      </div>

      <div className="watchlist-card-context">
        <div>
          <span>关联目标</span>
          <strong>{item.goal?.name ?? "未关联目标"}</strong>
        </div>
        <div>
          <span>关注理由</span>
          <p>{item.reason ?? "尚未填写关注理由"}</p>
        </div>
        <div>
          <span>计划期限</span>
          <p>{item.plannedHorizon ?? "未设置"}</p>
        </div>
        {drawdownRule ? <div className="watchlist-rule-preview"><BellRing className="size-4" />{drawdownRule}</div> : null}
      </div>

      <footer className="watchlist-card-footer">
        <div className="watchlist-card-counts">
          <span>{item.activeConditionCount} 条活动规则</span>
          <span>{item.triggeredConditionCount} 条本次触发</span>
          <span>{item.unreadAlertCount} 条未读</span>
        </div>
        <div className="watchlist-card-actions">
          <Button type="button" size="sm" onClick={props.onAskAdvisor}>
            <MessageCircleQuestion className="size-4" />问顾问
          </Button>
          <IconAction
            label="立即检查"
            onClick={props.onCheck}
            disabled={props.checking}
          >
            <RefreshCw className={`size-4 ${props.checking ? "animate-spin" : ""}`} />
          </IconAction>
          <IconAction label="编辑观察信息" onClick={props.onEdit}>
            <Pencil className="size-4" />
          </IconAction>
          <IconAction label="管理提醒规则" onClick={props.onManageConditions}>
            <CalendarClock className="size-4" />
          </IconAction>
          <IconAction label="移动到其他列表" onClick={props.onMove}>
            <ArrowRightLeft className="size-4" />
          </IconAction>
          <IconAction label="移除观察对象" onClick={props.onRemove} destructive>
            <Trash2 className="size-4" />
          </IconAction>
        </div>
      </footer>
    </article>
  );
}

function DataPoint({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function IconAction(props: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={`watchlist-icon-action ${props.destructive ? "is-destructive" : ""}`}
          aria-label={props.label}
          onClick={props.onClick}
          disabled={props.disabled}
        >
          {props.children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}

function toneForMove(value: number | null): string {
  if (value == null) return "is-neutral";
  if (value > 0) return "is-positive";
  if (value < 0) return "is-negative";
  return "is-neutral";
}
