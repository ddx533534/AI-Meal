# 本地、Gemini 与云端部署验证报告

本文件为 Cloudflare 阶段的历史记录。用户随后确认切换 Netlify Free，当前迁移与部署结果见 [NETLIFY.md](NETLIFY.md)。下文旧命令中的默认脚本现已改名为相应的 `:worker` 命令。

验证日期：2026-10-08。项目范围：Google ADK JS/TypeScript + Gemini + Workers + D1 最小后端。先完成本地与 Gemini 验证，之后用户完成 Cloudflare 设备授权，继续云端部署；遇到公开域名连接问题后，用户选择保留当前部署。

## 结论

**本地后端和真实 Gemini 调用通过；云端代码、D1 表结构与 secrets 已部署。公开接口的云端端到端调用受本机网络阻塞，尚未通过；免费档 CPU 适配尚未验证。**

最终默认模型：`gemini-3.1-flash-lite`。运行环境：Node 26.7.0；ADK 2.2.1；Wrangler 4.148.0；Miniflare 5.20261006.0-alpha；兼容日期 2026-10-08。使用 Web ADK 入口，无需 nodejs_compat。

## 证据

| 检查 | 结果 | 证明范围 |
| --- | --- | --- |
| 公共 npm registry 下 `npm ci` | 通过 | 依赖锁文件可重新安装；构建后的 Worker SHA-256 与此前真实验证所用构建一致 |
| `npm run check` | 通过 | TypeScript 类型检查 |
| `npm test` | 8/8 通过 | 真实 ADK + workerd + D1；远程 Gemini 回复模拟 |
| Wrangler dry-run 构建 | 通过 | 1463.95 KiB；gzip 306.62 KiB；没有部署 |
| Wrangler 本地 D1 迁移 | 通过 | 0001_records.sql 成功应用到本机数据库 |
| Wrangler HTTP 健康与历史查询 | 200 | `.dev.vars` 加载与本地 DB 读取 |
| workerd 原生 fetch 调用真实 Gemini | 201 | 模型回复 + 本地临时 D1 写入与完整读回 |
| curl 诊断转发调用真实 Gemini | 201 | 独立系统网络传输下也得到真实模型回复 |
| 实际 Wrangler 服务分析请求 | 201 | 用户可复现命令调用 Gemini 并保存真实记录 |
| 实际 Wrangler 服务历史查询 | 200 | 成功读回上述真实记录 |
| 实际 Wrangler 服务停止后再启动 | 200 | 同一条真实记录仍能读回 |
| Cloudflare 设备登录 | 通过 | 无需 localhost 回调，授权凭据已保存 |
| 云端 D1 创建与迁移 | 通过 | ai-meal-records / APAC，0001_records.sql 已成功应用 |
| Cloudflare Worker 部署 | 通过 | 目标版本流量占比 100%，workers.dev 路由启用 |
| 云端 secrets 核对 | 通过 | 管理 API 确认两项 secret 名称存在，不读取或回显值 |
| 云端公开接口调用 | 连接失败 | 健康请求未收到 HTTP 响应；没有执行云端 Gemini 或记录读写 |
| Workers 免费档 10 ms CPU | 未验证 | 本地经过时间不能代替云端 CPU 指标 |

自动化 8 项覆盖：Worker 启动/ADK 导入、鉴权、无效/畸形/过大输入不调用模型、ADK 协议调用与写入、模型失败信息清理且不写入、空/截断输出拒绝、分页校验、完整运行时重启后 D1 记录保留。

## 真实模型结果

原生 workerd 验证开始时间：`2026-10-08T07:42:57.013Z`（北京时间 15:42:57）。接口 HTTP 201，整次请求 1407 ms；D1 写入与读回断言通过。

实际 Wrangler 服务保存的记录：

- ID：`7c5247ec-5c59-4ea9-9028-d0690d2ba239`
- created_at：`2026-10-08T07:44:34.692Z`
- model：`gemini-3.1-flash-lite`
- duration_ms：1389，包含网络等待，不是 CPU 时间。
- 输入：早餐吃了一个鸡蛋和一片面包，重量和配料未知。请整理已知信息。
- 模型输出包含：早餐为 1 个鸡蛋、1 片面包；具体重量、面包品种及配料、总热量及营养数值均为缺失信息。

该回复来自真实 Gemini API，没有用固定字符串替代。实际 Wrangler 数据保存在 `.wrangler/state`；独立 live-smoke 的 D1 是临时数据库，结束后已清理。原始原生结果保存在已忽略的 `verification/live-smoke.local.json`；该文件不含 Key 或令牌。

## 诊断发现与边界

最初默认 `gemini-flash-latest` 的真实生成请求返回过 503 UNAVAILABLE；对照的 `gemini-2.5-flash` / `gemini-2.5-flash-lite` 返回过 404 NOT_FOUND。`listModels` 返回 200 且包含这些名称，但模型列表成功不足以证明生成成功。没有足够证据确定所有失败的具体服务端原因。

本机部分 Node/workerd 请求也出现过连接失败，因此加入 curl 转发作为诊断手段。改用 `gemini-3.1-flash-lite` 后，curl 诊断与原生 workerd fetch 均取得真实成功结果，部署代码仍直接通过 SDK 的 fetch 调用 Gemini。一次成功不足以说明长期稳定性或性能分位数。

ADK 会将部分上游 HTTP 错误转换成 error event。后端显式检测 event.errorCode，避免将错误事件当成模型生成成功；错误响应仅保留安全代码，错误、空输出和截断输出都不保存。

远端 D1 建表已通过，但 Worker 到远端 D1 的业务读写、Cloudflare 到 Gemini 的调用、云端 CPU、并发性能、Gemini 账户免费额度及实际账单尚未验证；不能声明云端端到端验证已经通过或保证零费用。

验证用的 Wrangler 开发服务已停止；原有本地数据库文件继续保留，未导入云端。云端 database_id 已替换本地占位值，本次没有重新验证该配置下的本地历史查询。

## 云端部署与访问证据

- URL：`https://ai-meal-adk-verification.ai-meal-backend.workers.dev`
- 发布时间：`2026-10-08T08:03:05.890Z`（北京时间 16:03:05）。
- 版本：`3737dfe8-32a6-407b-981a-5fb1540d3f25`；部署列表确认该版本占比 100%。
- D1 ID：`d7936695-f059-4734-960b-b7fb02e79b03`。
- 部署输出 Worker Startup Time：16 ms。此项是初始化耗时，不是每次请求的 CPU 时间。
- Worker settings API HTTP 200，兼容日期 2026-10-08，secret 名称为 API_AUTH_TOKEN / GEMINI_API_KEY。
- Worker public routing API HTTP 200，workersDevEnabled 为 true。

云端 smoke 在 `2026-10-08T08:04:38.801Z` 启动，第一个健康请求出现 `UND_ERR_CONNECT_TIMEOUT`，checks 数组为空。系统 curl 同样超时；本机 DNS lookup / resolve4 分别返回 `199.59.150.12` / `179.60.193.16`，Google DoH 返回 `172.67.167.207` / `104.21.41.243`。通过后一地址、保持目标 hostname 与正常 TLS 验证进行请求时仍被连接重置。只能确认存在解析差异和访问失败，不能据此确定全部失败原因，也不能将连接失败描述成 Worker 返回了 5xx。

Cloudflare account / Worker settings 均返回 usage model `standard`。账户订阅查询返回 403、API 错误码 10000，缺少读取权限，无法确认实际免费/付费套餐；没有变更账户套餐。

远端预览诊断被自动审批拒绝：系统认为这种预览会使用生产 D1，而用户未明确授权该独立诊断方式。该命令没有执行。用户之后选择保留当前部署，没有提供代理或自有域名，故本次停止进一步云端调用尝试。

后续在域名可达的网络中运行 `npm run verify:cloud`，可继续执行鉴权、真实 Gemini 和远端 D1 完整验证。当前部署与数据库继续保留。

后续用户浏览器截图同样显示该健康地址 `ERR_CONNECTION_TIMED_OUT`。这进一步确认该地址在用户当前浏览器网络不可达；仍未收到 Worker HTTP 响应，不能将此结果解释为业务接口或 Gemini 返回错误。
