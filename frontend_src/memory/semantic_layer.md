---
name: 语义层管理子页面
description: 资产模块下语义层子页面组（领域/表/字段/外键）。当前为纯前端 mock 版：无后端、无鉴权，从共享内存 store 读取 fixture 数据，用于演示渲染逻辑。
type: project
---

# 语义层管理子页面（资产 · 语义层）

## 定位
用户按业务领域来组织自己的物理表 → 语义模型 → 外键关联；产品说明位于资产板块下，顶栏用与「历史记录」相同风格的下拉列出三个顶级入口。

**当前阶段：纯前端渲染演示，不接后端。** fixture 数据在 `src/lib/mockSemanticData.ts`，运行态共享 store 在 `src/lib/mockSemanticStore.ts`（`useSyncExternalStore` 驱动）。所有增删改会立即反映在所有页面，但**刷新即回到 fixture 初值**。

## 导航
- 顶栏「语义层 ▼」下拉（自作 CSS 定位）：`领域管理 / 表管理 / 外键管理`。
- 「字段管理」不是顶级入口，从「表管理」某一行的「字段」按钮进入。

## 路由（App.tsx）
| 路径 | 页面 |
|---|---|
| `/assets/semantic` | `SemanticDomainsPage.tsx` — 兜底跳到领域管理 |
| `/assets/semantic/domains` | `SemanticDomainsPage.tsx` |
| `/assets/semantic/tables` | `SemanticTablesPage.tsx` |
| `/assets/semantic/tables/:tableId/columns` | `SemanticColumnsPage.tsx` |
| `/assets/semantic/foreign-keys` | `SemanticForeignKeysPage.tsx` |

**这 5 条路由挂在 `MainLayout` 下但 *不在* `ProtectedRoute` 里** —— 匿名进也能看到，用于纯前端演示。其它业务页仍在 `ProtectedRoute` 里。

## 数据 fixture（`src/lib/mockSemanticData.ts`）
- **5 个领域**：交易 / 用户 / 营销 / 供应链 / 行为分析（其中"行为分析"默认 `isVisible=false`）
- **13 张表**：涵盖 orders / payments / refunds / users / user_profiles / user_devices / campaigns / coupons / products / inventory / suppliers / page_view / click。其中 `refunds` 表 `syncStatus='missing'`，用于演示灰显 badge。
- **~40 个字段**：3–5 列/表，字段有类型、主键标记、语义名、业务类型、示例值。`refunds` 表的字段也是 `missing`。
- **10 条外键**：orders→users, payments→orders, refunds→orders (missing 源), profiles→users (one_to_one), devices→users, coupons→campaigns, products→suppliers (inferred confidence 0.82), inventory→products, pv/click→users (inferred, 一条 isVisible=false)。每条外键的 `sourceTableName/sourceColumnName/targetTableName/targetColumnName` 都预填好，同时页面上还会用当前 store 的实时名字覆盖派生字段，保证改表名后 FK 页立即反映。

## 共享 store（`src/lib/mockSemanticStore.ts`）
```ts
useDomains() / useTables() / useColumns() / useForeignKeys()  // 订阅式 hook
setDomains() / setTables() / setColumns() / setForeignKeys()   // 全量替换 + notify
getDomains() / getTables() / ...                                // 同步读取（sync dialog 用）
```
基于 React 18 `useSyncExternalStore`。每个 topic 有独立 listener set，改一个只 notify 相关订阅者，页面之间的联动免费。

## 页面套路
1. 头部标题 + 子导航（仅 domains/tables/foreign-keys）。
2. `DataToolbar`（关键字 debounce 300ms、显示/隐藏筛选、排序字段、升降序）+ 右侧动作 slot：批量删除（>0 显示）、同步（仅表管理页）、新建。
3. 表格：表头全选 `Checkbox`（三态：全选 / indeterminate / 未选），行 `Checkbox`；表管理页 / 字段页对 `syncStatus === 'missing'` 的行渲染 `bg-muted/40 opacity-60`，同步状态列渲染 `<Badge variant="outline">missing</Badge>`。
4. `DataPagination` 分页（默认每页 20，10/20/50 可选）。
5. 编辑 `Dialog` + 单条删除 / 批量删除 `AlertDialog`。
6. keyword / isVisible / sortBy / sortOrder / pageSize / domainFilter 改变时 `setPageNo(1)`；分页越界（例如删完最后一页）自动回退到最后一页。
7. 客户端过滤 + 排序 + 分页：所有 list 数据在 `useMemo` 里对 store 内容做 filter / sort / slice，无 API 请求。
8. 排序字段白名单来自 `TABLE_SORT_MAP` 之类的类型联合，`useState<SortField>` 保证类型收敛。

## 同步向导（`SemanticSyncDialog.tsx`）
3 步：选数据源（`mockDatasources.ts` 的 3 个）→ 选目标领域（已有或 `+ 新建`）→ 勾待同步表 → `markMissing` 开关。提交时 fake 一个 300ms 异步，然后直接操作 store：
- 领域 upsert（按 name 找）
- 表按 `(domainId, datasourceKey, physicalTableName)` upsert
- 字段按 `(tableId, physicalColumnName)` upsert
- `markMissing=true` 时，本次没勾选但库里在同一 (domain, datasourceKey) 范围内的表 → `syncStatus='missing'`；字段同款
- 重新出现的 missing 行翻回 `active`
- 全程不删除任何行；toast 汇总 `created / updated / missing / skipped` 四类计数

## 服务层与后端
`src/services/semanticService.ts` 仍存在（还带 supabase 直连的分页壳、批量删除、sync 实现），但**页面不再引用**。之后如果要转真后端，只需要把页面里的 `useDomains()` 等换回 `useQuery` 走服务层即可，UI 层无需改动。

## 关键设计
- fixture 数据里 `refunds` 表以及其字段的 `syncStatus='missing'`，用来展示灰显效果。外键 `fk_refunds_orders` 也是 confidence 0.9 用来展示置信度。
- 通用组件 `DataToolbar / DataPagination / useTableSelection` 都不带业务字眼，其他页面可以复用。
- `useTableSelection` 用 `Set<string>` 记录跨页选中；三态全选逻辑 `isAllOnPageSelected / isSomeOnPageSelected`。
- `example_values` 表单里用逗号（含全角）分隔，split + trim 落库。
- 字段编辑用 `businessType` 受控枚举下拉，`未设置` 用哨兵 `__unset`，落库前转 `null`。
