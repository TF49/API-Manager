# 中转站分组价格对比 — 设计

## 目标

选一个模型类别（GPT / Claude / Gemini / 国模），一眼看到所有站点、所有分组的价格，最便宜的排最前；倍率自动定时更新，变动有记录、有提示。

## 范围

**删除**：站点连通测试、批量测试、模型拉取（/v1/models）、模型测试、API Key 字段、调用历史页。
数据库里的旧表（`models`、`call_history`）和旧列（`api_key_encrypted`、`status`、`last_tested_at`）保留不删，代码不再读写。

**保留**：站点管理、sub2api 登录、分组查询页（临时查询任意地址）、登录与安全机制。

## 数据来源与价格口径

价格统一换算成「美元 / 百万 token」（按次计费的模型是「美元 / 次」），**实际价格 = 模型基础价 × 分组倍率**。

| 架构 | 分组倍率 | 分组下的模型 | 模型基础价 |
|---|---|---|---|
| new-api / one-api | `/api/pricing` 的 `group_ratio` | `data[].enable_groups` | 输入 = `model_ratio × 2`，输出 = 输入 × `completion_ratio`；按次 = `model_price` |
| sub2api 模型广场 | `rate_multiplier`（有个人倍率时优先） | `groups[].models` | `models[].pricing.input_price/output_price × 1e6`；按次 = `per_request_price` |
| sub2api 登录 | `/groups/available` + `/groups/rates` | `/channels/available`（站点关了该功能时没有模型） | 同上 |

说明：这里的「美元」是站点的额度单位，不含各站充值汇率差异。

## 分类

`lib/model-category.ts` 按模型名判断类别：`gpt`、`claude`、`gemini`、`cn`（国模）、`other`。
分组的类别 = 分组内所有模型类别的并集（一个分组可同时属于多个类别）。没有模型数据时，依次用 sub2api 平台、分组名推断。
可在站点详情页手动覆盖（`site_price_groups.category_override`）。

## 数据库（增量迁移）

- `sites` 加 `architecture`、`last_fetched_at`、`last_fetch_ok`、`last_fetch_error`
- `site_price_groups` 加 `category_override`
- 新表 `site_group_models`：`(site_id, group_name, model_name)` 唯一，存计费方式和基础价
- 新表 `price_group_changes`：`site_id, group_name, change_type, old_ratio, new_ratio, created_at`；模型级变动另有 `model_name, group_count, price_billing, old_price, new_price`
- `sites.last_success_at`：「数据更新于」只算成功的获取

变动类型：分组倍率变动（ratio）、新增分组（added）、分组下架（removed）、模型基础价变动（model_price）、模型上架（model_added）、模型下架（model_removed）。
模型级变动按「站点 + 模型 + 变动」聚合，同一次调价影响多个分组只记一条。
站点第一次获取时不记录变动；改了 Base URL 的域名时清空旧数据，按第一次获取处理。

## 自动更新

- `instrumentation.ts` 在 Node 运行时启动定时器，每 `PRICE_REFRESH_MINUTES`（默认 30，设为 0 关闭）分钟同步全部站点，并发 3。
- 同一站点同时只跑一次同步（进程内锁），手动刷新与定时任务共用；修改站点后的同步会排在正在跑的那次之后，用新配置再跑一次。
- 写库遇到死锁或锁等待超时最多重试 3 次。
- 「立即同步全部」在后台运行，前端轮询 `/api/refresh` 直到结束。
- 对比页每 30 秒轮询一次，有新变动时弹出提示；导航栏每分钟检查未读变动数。

## 页面

- **价格对比 `/compare`（首页）**：类别 Tab；模型下拉（只列出该类别下出现过的模型和覆盖的分组数）。
  - 不选模型：按分组倍率从低到高列出含该类别模型的分组。
  - 选了模型：只列有这个模型的分组，按实际输入价从低到高排，显示输入/输出价、分组倍率。
  - 最便宜的一行高亮；倍率变动显示 ↑/↓ 和原值，24 小时内的变动额外标记。
  - 侧栏显示当前类别最近的倍率变动。
- **站点管理 `/sites`**：列表显示架构、分组数、最后获取时间和结果；操作：刷新、详情、编辑、删除。
- **站点详情 `/sites/[id]`**：分组列表，可展开看模型和价格，可修改分组类别。
- **倍率变动 `/changes`**：替代调用历史，按时间倒序，可按涨价/降价/新增/下架筛选。
