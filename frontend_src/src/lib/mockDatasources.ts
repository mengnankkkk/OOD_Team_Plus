// Prototype-only fixture: represents the set of physical tables discoverable from
// each mock datasource. In a real integration this would be replaced by a data-source
// discovery API (introspecting Postgres / MySQL / Iceberg / etc.). The rest of the
// semantic-layer UI treats this list as the authoritative "what does the source system
// currently expose" answer; the sync UI lets the user pick which of these tables to
// materialize into their semantic layer.

import type { SyncColumnInput, SyncTableInput } from "@/types/app/semantic";

export interface MockDatasource {
  key: string;
  label: string;
  description: string;
  schemaName: string;
  tables: SyncTableInput[];
}

const col = (
  physicalColumnName: string,
  dataType: string,
  extras: Partial<SyncColumnInput> = {},
): SyncColumnInput => ({
  physicalColumnName,
  dataType,
  isNullable: extras.isNullable ?? true,
  isPrimaryKey: extras.isPrimaryKey ?? false,
  ordinalPosition: extras.ordinalPosition,
  defaultValue: extras.defaultValue ?? null,
  physicalDescription: extras.physicalDescription ?? null,
  semanticName: extras.semanticName ?? null,
  semanticDescription: extras.semanticDescription ?? null,
  businessType: extras.businessType ?? null,
  exampleValues: extras.exampleValues ?? [],
  isVisible: extras.isVisible ?? true,
});

export const MOCK_DATASOURCES: MockDatasource[] = [
  {
    key: "main",
    label: "主业务库 (main)",
    description: "线上交易主库：订单、用户、支付、商品",
    schemaName: "public",
    tables: [
      {
        physicalTableName: "orders",
        physicalDescription: "订单主表，一个订单一行",
        semanticName: "订单主表",
        semanticDescription: "记录用户提交的交易生命周期",
        isVisible: true,
        columns: [
          col("id", "bigint", { ordinalPosition: 1, isNullable: false, isPrimaryKey: true, physicalDescription: "订单主键", semanticName: "订单ID", businessType: "id", exampleValues: ["10001", "10002"] }),
          col("buyer_id", "bigint", { ordinalPosition: 2, isNullable: false, physicalDescription: "下单人用户 ID", semanticName: "买家ID", businessType: "user_id", exampleValues: ["u_1001", "u_1002"] }),
          col("amount", "numeric", { ordinalPosition: 3, isNullable: false, physicalDescription: "订单金额（含税，单位分）", semanticName: "订单金额", businessType: "money", exampleValues: ["9900", "12800"] }),
          col("status", "text", { ordinalPosition: 4, isNullable: false, defaultValue: "'pending'", physicalDescription: "订单状态机", semanticName: "订单状态", businessType: "status", exampleValues: ["pending", "paid", "shipped", "closed"] }),
          col("created_at", "timestamptz", { ordinalPosition: 5, isNullable: false, defaultValue: "now()", physicalDescription: "创建时间", semanticName: "下单时间", businessType: "timestamp" }),
        ],
      },
      {
        physicalTableName: "users",
        physicalDescription: "用户主表",
        semanticName: "用户主表",
        semanticDescription: "端上注册的实名 / 匿名用户",
        isVisible: true,
        columns: [
          col("id", "bigint", { ordinalPosition: 1, isNullable: false, isPrimaryKey: true, physicalDescription: "用户主键", semanticName: "用户ID", businessType: "id" }),
          col("phone", "text", { ordinalPosition: 2, physicalDescription: "手机号", semanticName: "手机号", businessType: "text" }),
          col("nickname", "text", { ordinalPosition: 3, physicalDescription: "昵称", semanticName: "昵称", businessType: "text" }),
          col("created_at", "timestamptz", { ordinalPosition: 4, isNullable: false, defaultValue: "now()", physicalDescription: "注册时间", semanticName: "注册时间", businessType: "timestamp" }),
        ],
      },
      {
        physicalTableName: "payments",
        physicalDescription: "支付流水",
        semanticName: "支付流水",
        semanticDescription: "订单对应的多笔实际支付/退款尝试",
        isVisible: true,
        columns: [
          col("id", "bigint", { ordinalPosition: 1, isNullable: false, isPrimaryKey: true, semanticName: "支付ID", businessType: "id" }),
          col("order_id", "bigint", { ordinalPosition: 2, isNullable: false, physicalDescription: "订单外键", semanticName: "订单ID", businessType: "id" }),
          col("channel", "text", { ordinalPosition: 3, physicalDescription: "支付渠道", semanticName: "支付渠道", businessType: "category", exampleValues: ["wechat", "alipay", "card"] }),
          col("amount", "numeric", { ordinalPosition: 4, physicalDescription: "支付金额", semanticName: "支付金额", businessType: "money" }),
        ],
      },
      {
        physicalTableName: "products",
        physicalDescription: "商品目录",
        semanticName: "商品目录",
        semanticDescription: "对外售卖的商品 SKU",
        isVisible: true,
        columns: [
          col("id", "bigint", { ordinalPosition: 1, isNullable: false, isPrimaryKey: true, semanticName: "商品ID", businessType: "id" }),
          col("title", "text", { ordinalPosition: 2, semanticName: "商品名", businessType: "text" }),
          col("price", "numeric", { ordinalPosition: 3, semanticName: "商品价格", businessType: "money" }),
        ],
      },
    ],
  },
  {
    key: "warehouse",
    label: "数仓库 (warehouse)",
    description: "T+1 数仓：宽表、汇总表",
    schemaName: "dw",
    tables: [
      {
        physicalTableName: "sales_daily",
        physicalDescription: "每日销售汇总宽表",
        semanticName: "日销售宽表",
        semanticDescription: "按日 × 商品维度的销售数据",
        isVisible: true,
        columns: [
          col("dt", "date", { ordinalPosition: 1, isNullable: false, isPrimaryKey: true, semanticName: "统计日期", businessType: "timestamp" }),
          col("product_id", "bigint", { ordinalPosition: 2, isNullable: false, isPrimaryKey: true, semanticName: "商品ID", businessType: "id" }),
          col("gmv", "numeric", { ordinalPosition: 3, semanticName: "成交金额", businessType: "money" }),
          col("orders_cnt", "bigint", { ordinalPosition: 4, semanticName: "订单数", businessType: "quantity" }),
        ],
      },
      {
        physicalTableName: "customer_dim",
        physicalDescription: "客户维度表",
        semanticName: "客户维度",
        semanticDescription: "客户属性 / 标签",
        isVisible: true,
        columns: [
          col("customer_id", "bigint", { ordinalPosition: 1, isNullable: false, isPrimaryKey: true, semanticName: "客户ID", businessType: "user_id" }),
          col("tier", "text", { ordinalPosition: 2, semanticName: "客户等级", businessType: "category", exampleValues: ["S", "A", "B", "C"] }),
          col("region", "text", { ordinalPosition: 3, semanticName: "所属地区", businessType: "category" }),
        ],
      },
      {
        physicalTableName: "product_dim",
        physicalDescription: "商品维度表",
        semanticName: "商品维度",
        semanticDescription: "商品的品类 / 品牌属性",
        isVisible: true,
        columns: [
          col("product_id", "bigint", { ordinalPosition: 1, isNullable: false, isPrimaryKey: true, semanticName: "商品ID", businessType: "id" }),
          col("category", "text", { ordinalPosition: 2, semanticName: "品类", businessType: "category" }),
          col("brand", "text", { ordinalPosition: 3, semanticName: "品牌", businessType: "category" }),
        ],
      },
    ],
  },
  {
    key: "analytics",
    label: "行为分析库 (analytics)",
    description: "埋点 / 用户行为事件",
    schemaName: "events",
    tables: [
      {
        physicalTableName: "page_view",
        physicalDescription: "页面浏览事件",
        semanticName: "页面浏览",
        semanticDescription: "PV 级明细，含设备与来源",
        isVisible: true,
        columns: [
          col("event_id", "text", { ordinalPosition: 1, isNullable: false, isPrimaryKey: true, semanticName: "事件ID", businessType: "id" }),
          col("user_id", "bigint", { ordinalPosition: 2, semanticName: "用户ID", businessType: "user_id" }),
          col("page", "text", { ordinalPosition: 3, semanticName: "页面路径", businessType: "text" }),
          col("ts", "timestamptz", { ordinalPosition: 4, isNullable: false, semanticName: "发生时间", businessType: "timestamp" }),
        ],
      },
      {
        physicalTableName: "click",
        physicalDescription: "点击事件",
        semanticName: "点击事件",
        semanticDescription: "元素点击，含元素 ID / 位置",
        isVisible: true,
        columns: [
          col("event_id", "text", { ordinalPosition: 1, isNullable: false, isPrimaryKey: true, semanticName: "事件ID", businessType: "id" }),
          col("user_id", "bigint", { ordinalPosition: 2, semanticName: "用户ID", businessType: "user_id" }),
          col("element_id", "text", { ordinalPosition: 3, semanticName: "元素ID", businessType: "text" }),
          col("ts", "timestamptz", { ordinalPosition: 4, isNullable: false, semanticName: "发生时间", businessType: "timestamp" }),
        ],
      },
    ],
  },
];

export const getMockDatasource = (key: string): MockDatasource | undefined =>
  MOCK_DATASOURCES.find((d) => d.key === key);
