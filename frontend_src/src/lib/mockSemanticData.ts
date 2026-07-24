// Prototype-only fixture data for the semantic layer pages.
// The 4 semantic pages render entirely from this in-memory store — no backend,
// no auth, no supabase. Mutations (create / edit / delete / batch delete / sync)
// live in the shared store so changes on one page are visible on the others.

import type {
  SemanticColumn,
  SemanticDomain,
  SemanticForeignKey,
  SemanticTable,
} from "@/types/app/semantic";

const now = () => new Date().toISOString();
let _seq = 1000;
export const nextId = (prefix: string) => `${prefix}_${++_seq}`;

// ---------- Domains ----------
export const MOCK_DOMAINS: SemanticDomain[] = [
  {
    id: "dom_trade",
    name: "交易",
    description: "订单、支付、退款相关的核心业务表。",
    isVisible: true,
    createdAt: "2026-07-01T09:00:00Z",
    updatedAt: "2026-07-24T02:30:00Z",
  },
  {
    id: "dom_user",
    name: "用户",
    description: "用户身份、资料、设备与偏好。",
    isVisible: true,
    createdAt: "2026-07-01T09:10:00Z",
    updatedAt: "2026-07-22T05:40:00Z",
  },
  {
    id: "dom_marketing",
    name: "营销",
    description: "活动、优惠券、投放渠道及埋点归因。",
    isVisible: true,
    createdAt: "2026-07-05T09:00:00Z",
    updatedAt: "2026-07-20T11:00:00Z",
  },
  {
    id: "dom_supply",
    name: "供应链",
    description: "商品、库存、供应商相关表。",
    isVisible: true,
    createdAt: "2026-07-05T10:00:00Z",
    updatedAt: "2026-07-18T14:20:00Z",
  },
  {
    id: "dom_analytics",
    name: "行为分析",
    description: "PV / 点击 / 会话等埋点事件表。",
    isVisible: false,
    createdAt: "2026-07-08T09:00:00Z",
    updatedAt: "2026-07-15T08:00:00Z",
  },
];

// ---------- Tables ----------
const t = (partial: Partial<SemanticTable> & { id: string; domainId: string; physicalTableName: string }): SemanticTable => ({
  datasourceKey: "main",
  schemaName: "public",
  physicalDescription: null,
  semanticName: null,
  semanticDescription: null,
  isVisible: true,
  syncStatus: "active",
  createdAt: "2026-07-10T00:00:00Z",
  updatedAt: "2026-07-24T00:00:00Z",
  ...partial,
});

export const MOCK_TABLES: SemanticTable[] = [
  t({ id: "tbl_orders", domainId: "dom_trade", physicalTableName: "orders", semanticName: "订单主表", physicalDescription: "订单主表，一订单一行", semanticDescription: "记录用户提交的交易生命周期" }),
  t({ id: "tbl_payments", domainId: "dom_trade", physicalTableName: "payments", semanticName: "支付流水", physicalDescription: "订单对应的多笔实际支付", semanticDescription: "订单支付/退款尝试明细" }),
  t({ id: "tbl_refunds", domainId: "dom_trade", physicalTableName: "refunds", semanticName: "退款单", syncStatus: "missing" }),
  t({ id: "tbl_users", domainId: "dom_user", physicalTableName: "users", semanticName: "用户主表", semanticDescription: "端上注册的实名 / 匿名用户" }),
  t({ id: "tbl_profiles", domainId: "dom_user", physicalTableName: "user_profiles", semanticName: "用户画像", semanticDescription: "扩展资料、标签、偏好" }),
  t({ id: "tbl_devices", domainId: "dom_user", physicalTableName: "user_devices", semanticName: "登录设备", isVisible: false }),
  t({ id: "tbl_campaigns", domainId: "dom_marketing", physicalTableName: "campaigns", semanticName: "营销活动" }),
  t({ id: "tbl_coupons", domainId: "dom_marketing", physicalTableName: "coupons", semanticName: "优惠券" }),
  t({ id: "tbl_products", domainId: "dom_supply", physicalTableName: "products", semanticName: "商品目录" }),
  t({ id: "tbl_inventory", domainId: "dom_supply", physicalTableName: "inventory", semanticName: "库存快照" }),
  t({ id: "tbl_suppliers", domainId: "dom_supply", physicalTableName: "suppliers", semanticName: "供应商" }),
  t({ id: "tbl_pv", domainId: "dom_analytics", physicalTableName: "page_view", schemaName: "events", datasourceKey: "analytics", semanticName: "页面浏览", physicalDescription: "PV 级明细" }),
  t({ id: "tbl_click", domainId: "dom_analytics", physicalTableName: "click", schemaName: "events", datasourceKey: "analytics", semanticName: "点击事件" }),
];

// ---------- Columns ----------
const c = (partial: Partial<SemanticColumn> & { id: string; tableId: string; physicalColumnName: string; ordinalPosition: number }): SemanticColumn => ({
  dataType: "text",
  isNullable: true,
  isPrimaryKey: false,
  defaultValue: null,
  physicalDescription: null,
  semanticName: null,
  semanticDescription: null,
  businessType: null,
  exampleValues: [],
  isVisible: true,
  syncStatus: "active",
  createdAt: "2026-07-10T00:00:00Z",
  updatedAt: "2026-07-24T00:00:00Z",
  ...partial,
});

export const MOCK_COLUMNS: SemanticColumn[] = [
  // orders
  c({ id: "col_orders_id", tableId: "tbl_orders", physicalColumnName: "id", ordinalPosition: 1, dataType: "bigint", isNullable: false, isPrimaryKey: true, semanticName: "订单ID", businessType: "id", exampleValues: ["10001", "10002"] }),
  c({ id: "col_orders_buyer", tableId: "tbl_orders", physicalColumnName: "buyer_id", ordinalPosition: 2, dataType: "bigint", isNullable: false, semanticName: "买家ID", businessType: "user_id" }),
  c({ id: "col_orders_amount", tableId: "tbl_orders", physicalColumnName: "amount", ordinalPosition: 3, dataType: "numeric", isNullable: false, semanticName: "订单金额", businessType: "money", exampleValues: ["9900", "12800"] }),
  c({ id: "col_orders_status", tableId: "tbl_orders", physicalColumnName: "status", ordinalPosition: 4, dataType: "text", isNullable: false, defaultValue: "'pending'", semanticName: "订单状态", businessType: "status", exampleValues: ["pending", "paid", "shipped", "closed"] }),
  c({ id: "col_orders_created", tableId: "tbl_orders", physicalColumnName: "created_at", ordinalPosition: 5, dataType: "timestamptz", isNullable: false, defaultValue: "now()", semanticName: "下单时间", businessType: "timestamp" }),
  // payments
  c({ id: "col_pay_id", tableId: "tbl_payments", physicalColumnName: "id", ordinalPosition: 1, dataType: "bigint", isNullable: false, isPrimaryKey: true, semanticName: "支付ID", businessType: "id" }),
  c({ id: "col_pay_order", tableId: "tbl_payments", physicalColumnName: "order_id", ordinalPosition: 2, dataType: "bigint", isNullable: false, semanticName: "订单ID", businessType: "id" }),
  c({ id: "col_pay_channel", tableId: "tbl_payments", physicalColumnName: "channel", ordinalPosition: 3, dataType: "text", semanticName: "支付渠道", businessType: "category", exampleValues: ["wechat", "alipay", "card"] }),
  c({ id: "col_pay_amount", tableId: "tbl_payments", physicalColumnName: "amount", ordinalPosition: 4, dataType: "numeric", semanticName: "支付金额", businessType: "money" }),
  // refunds
  c({ id: "col_ref_id", tableId: "tbl_refunds", physicalColumnName: "id", ordinalPosition: 1, dataType: "bigint", isNullable: false, isPrimaryKey: true, syncStatus: "missing", semanticName: "退款ID", businessType: "id" }),
  c({ id: "col_ref_order", tableId: "tbl_refunds", physicalColumnName: "order_id", ordinalPosition: 2, dataType: "bigint", syncStatus: "missing", semanticName: "订单ID", businessType: "id" }),
  // users
  c({ id: "col_users_id", tableId: "tbl_users", physicalColumnName: "id", ordinalPosition: 1, dataType: "bigint", isNullable: false, isPrimaryKey: true, semanticName: "用户ID", businessType: "id" }),
  c({ id: "col_users_phone", tableId: "tbl_users", physicalColumnName: "phone", ordinalPosition: 2, dataType: "text", semanticName: "手机号", businessType: "text" }),
  c({ id: "col_users_nick", tableId: "tbl_users", physicalColumnName: "nickname", ordinalPosition: 3, dataType: "text", semanticName: "昵称", businessType: "text" }),
  c({ id: "col_users_created", tableId: "tbl_users", physicalColumnName: "created_at", ordinalPosition: 4, dataType: "timestamptz", isNullable: false, defaultValue: "now()", semanticName: "注册时间", businessType: "timestamp" }),
  // profiles
  c({ id: "col_prof_id", tableId: "tbl_profiles", physicalColumnName: "user_id", ordinalPosition: 1, dataType: "bigint", isNullable: false, isPrimaryKey: true, semanticName: "用户ID", businessType: "user_id" }),
  c({ id: "col_prof_tier", tableId: "tbl_profiles", physicalColumnName: "tier", ordinalPosition: 2, dataType: "text", semanticName: "会员等级", businessType: "category", exampleValues: ["S", "A", "B"] }),
  c({ id: "col_prof_tag", tableId: "tbl_profiles", physicalColumnName: "tags", ordinalPosition: 3, dataType: "jsonb", semanticName: "标签", businessType: "text" }),
  // devices
  c({ id: "col_dev_id", tableId: "tbl_devices", physicalColumnName: "id", ordinalPosition: 1, dataType: "bigint", isNullable: false, isPrimaryKey: true, semanticName: "设备ID", businessType: "id" }),
  c({ id: "col_dev_user", tableId: "tbl_devices", physicalColumnName: "user_id", ordinalPosition: 2, dataType: "bigint", isNullable: false, semanticName: "用户ID", businessType: "user_id" }),
  // campaigns
  c({ id: "col_camp_id", tableId: "tbl_campaigns", physicalColumnName: "id", ordinalPosition: 1, dataType: "bigint", isNullable: false, isPrimaryKey: true, semanticName: "活动ID", businessType: "id" }),
  c({ id: "col_camp_name", tableId: "tbl_campaigns", physicalColumnName: "name", ordinalPosition: 2, dataType: "text", semanticName: "活动名称", businessType: "text" }),
  c({ id: "col_camp_start", tableId: "tbl_campaigns", physicalColumnName: "start_at", ordinalPosition: 3, dataType: "timestamptz", semanticName: "开始时间", businessType: "timestamp" }),
  // coupons
  c({ id: "col_coup_id", tableId: "tbl_coupons", physicalColumnName: "id", ordinalPosition: 1, dataType: "bigint", isNullable: false, isPrimaryKey: true, semanticName: "优惠券ID", businessType: "id" }),
  c({ id: "col_coup_camp", tableId: "tbl_coupons", physicalColumnName: "campaign_id", ordinalPosition: 2, dataType: "bigint", semanticName: "所属活动", businessType: "id" }),
  c({ id: "col_coup_amount", tableId: "tbl_coupons", physicalColumnName: "amount", ordinalPosition: 3, dataType: "numeric", semanticName: "面额", businessType: "money" }),
  // products
  c({ id: "col_prod_id", tableId: "tbl_products", physicalColumnName: "id", ordinalPosition: 1, dataType: "bigint", isNullable: false, isPrimaryKey: true, semanticName: "商品ID", businessType: "id" }),
  c({ id: "col_prod_title", tableId: "tbl_products", physicalColumnName: "title", ordinalPosition: 2, dataType: "text", semanticName: "商品名" }),
  c({ id: "col_prod_price", tableId: "tbl_products", physicalColumnName: "price", ordinalPosition: 3, dataType: "numeric", semanticName: "商品价格", businessType: "money" }),
  c({ id: "col_prod_supp", tableId: "tbl_products", physicalColumnName: "supplier_id", ordinalPosition: 4, dataType: "bigint", semanticName: "供应商ID", businessType: "id" }),
  // inventory
  c({ id: "col_inv_prod", tableId: "tbl_inventory", physicalColumnName: "product_id", ordinalPosition: 1, dataType: "bigint", isNullable: false, isPrimaryKey: true, semanticName: "商品ID", businessType: "id" }),
  c({ id: "col_inv_qty", tableId: "tbl_inventory", physicalColumnName: "quantity", ordinalPosition: 2, dataType: "integer", semanticName: "库存数量", businessType: "quantity" }),
  // suppliers
  c({ id: "col_supp_id", tableId: "tbl_suppliers", physicalColumnName: "id", ordinalPosition: 1, dataType: "bigint", isNullable: false, isPrimaryKey: true, semanticName: "供应商ID", businessType: "id" }),
  c({ id: "col_supp_name", tableId: "tbl_suppliers", physicalColumnName: "name", ordinalPosition: 2, dataType: "text", semanticName: "供应商名称" }),
  // page_view
  c({ id: "col_pv_id", tableId: "tbl_pv", physicalColumnName: "event_id", ordinalPosition: 1, dataType: "text", isNullable: false, isPrimaryKey: true, semanticName: "事件ID", businessType: "id" }),
  c({ id: "col_pv_user", tableId: "tbl_pv", physicalColumnName: "user_id", ordinalPosition: 2, dataType: "bigint", semanticName: "用户ID", businessType: "user_id" }),
  c({ id: "col_pv_page", tableId: "tbl_pv", physicalColumnName: "page", ordinalPosition: 3, dataType: "text", semanticName: "页面路径" }),
  c({ id: "col_pv_ts", tableId: "tbl_pv", physicalColumnName: "ts", ordinalPosition: 4, dataType: "timestamptz", isNullable: false, semanticName: "发生时间", businessType: "timestamp" }),
  // click
  c({ id: "col_clk_id", tableId: "tbl_click", physicalColumnName: "event_id", ordinalPosition: 1, dataType: "text", isNullable: false, isPrimaryKey: true, semanticName: "事件ID", businessType: "id" }),
  c({ id: "col_clk_user", tableId: "tbl_click", physicalColumnName: "user_id", ordinalPosition: 2, dataType: "bigint", semanticName: "用户ID", businessType: "user_id" }),
];

// ---------- Foreign Keys ----------
const fk = (partial: Partial<SemanticForeignKey> & { id: string; sourceTableId: string; sourceColumnId: string; targetTableId: string; targetColumnId: string; sourceTableName?: string | null; sourceColumnName?: string | null; targetTableName?: string | null; targetColumnName?: string | null }): SemanticForeignKey => ({
  relationType: "many_to_one",
  sourceType: "manual",
  confidence: 1,
  physicalDescription: null,
  semanticDescription: null,
  isVisible: true,
  createdAt: "2026-07-15T00:00:00Z",
  updatedAt: "2026-07-23T00:00:00Z",
  ...partial,
});

export const MOCK_FOREIGN_KEYS: SemanticForeignKey[] = [
  fk({
    id: "fk_orders_users",
    sourceTableId: "tbl_orders", sourceColumnId: "col_orders_buyer", sourceTableName: "订单主表", sourceColumnName: "买家ID",
    targetTableId: "tbl_users", targetColumnId: "col_users_id", targetTableName: "用户主表", targetColumnName: "用户ID",
    semanticDescription: "订单的买家指向用户主表",
  }),
  fk({
    id: "fk_pay_orders",
    sourceTableId: "tbl_payments", sourceColumnId: "col_pay_order", sourceTableName: "支付流水", sourceColumnName: "订单ID",
    targetTableId: "tbl_orders", targetColumnId: "col_orders_id", targetTableName: "订单主表", targetColumnName: "订单ID",
    semanticDescription: "支付关联的订单",
  }),
  fk({
    id: "fk_refunds_orders",
    sourceTableId: "tbl_refunds", sourceColumnId: "col_ref_order", sourceTableName: "退款单", sourceColumnName: "订单ID",
    targetTableId: "tbl_orders", targetColumnId: "col_orders_id", targetTableName: "订单主表", targetColumnName: "订单ID",
    semanticDescription: "退款关联的订单（源表 missing）",
    confidence: 0.9,
  }),
  fk({
    id: "fk_prof_users",
    sourceTableId: "tbl_profiles", sourceColumnId: "col_prof_id", sourceTableName: "用户画像", sourceColumnName: "用户ID",
    targetTableId: "tbl_users", targetColumnId: "col_users_id", targetTableName: "用户主表", targetColumnName: "用户ID",
    relationType: "one_to_one",
    sourceType: "physical",
  }),
  fk({
    id: "fk_devices_users",
    sourceTableId: "tbl_devices", sourceColumnId: "col_dev_user", sourceTableName: "登录设备", sourceColumnName: "用户ID",
    targetTableId: "tbl_users", targetColumnId: "col_users_id", targetTableName: "用户主表", targetColumnName: "用户ID",
  }),
  fk({
    id: "fk_coup_camp",
    sourceTableId: "tbl_coupons", sourceColumnId: "col_coup_camp", sourceTableName: "优惠券", sourceColumnName: "所属活动",
    targetTableId: "tbl_campaigns", targetColumnId: "col_camp_id", targetTableName: "营销活动", targetColumnName: "活动ID",
    semanticDescription: "优惠券所属的营销活动",
  }),
  fk({
    id: "fk_prod_supp",
    sourceTableId: "tbl_products", sourceColumnId: "col_prod_supp", sourceTableName: "商品目录", sourceColumnName: "供应商ID",
    targetTableId: "tbl_suppliers", targetColumnId: "col_supp_id", targetTableName: "供应商", targetColumnName: "供应商ID",
    sourceType: "inferred",
    confidence: 0.82,
  }),
  fk({
    id: "fk_inv_prod",
    sourceTableId: "tbl_inventory", sourceColumnId: "col_inv_prod", sourceTableName: "库存快照", sourceColumnName: "商品ID",
    targetTableId: "tbl_products", targetColumnId: "col_prod_id", targetTableName: "商品目录", targetColumnName: "商品ID",
    relationType: "one_to_one",
  }),
  fk({
    id: "fk_pv_users",
    sourceTableId: "tbl_pv", sourceColumnId: "col_pv_user", sourceTableName: "页面浏览", sourceColumnName: "用户ID",
    targetTableId: "tbl_users", targetColumnId: "col_users_id", targetTableName: "用户主表", targetColumnName: "用户ID",
    sourceType: "inferred",
    confidence: 0.65,
    isVisible: false,
  }),
  fk({
    id: "fk_clk_users",
    sourceTableId: "tbl_click", sourceColumnId: "col_clk_user", sourceTableName: "点击事件", sourceColumnName: "用户ID",
    targetTableId: "tbl_users", targetColumnId: "col_users_id", targetTableName: "用户主表", targetColumnName: "用户ID",
    sourceType: "inferred",
    confidence: 0.6,
  }),
];

export const nowIso = now;
