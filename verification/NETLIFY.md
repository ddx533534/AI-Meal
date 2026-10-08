# Netlify 迁移与验证

日期：2026-10-08。用户已确认采用 Netlify 免费方案。

**迁移已完成，生产端到端验证通过。** 生产地址为 [AI-Meal 后端](https://ai-meal-adk-verification-dream533534.netlify.app/)，[健康接口](https://ai-meal-adk-verification-dream533534.netlify.app/health)可公开访问；分析和历史仍要求 Bearer Token。生产 Public、Deploy Previews Private 已由用户在控制台保存。

## 迁移范围

- Netlify Functions 入口：`netlify/functions/api.ts`，对外仍为 `GET /health`、`POST /api/analyze`、`GET /api/records`。
- `src/api.ts` 共用输入校验、Bearer 鉴权、ADK 调用及安全错误响应；Cloudflare 入口改为 D1 适配器，旧资源仍存在。
- 模型保持 Google ADK JS 2.2.1 与 `gemini-3.1-flash-lite`；密钥只从运行环境读取。
- Netlify Blobs 使用站点级 `ai-meal-records` store，强一致性读取，记录在重新部署后保留。没有将旧 D1 或本地历史记录导入 Netlify。
- Blobs 每条记录一个对象，以创建时间和 ID 为键。历史查询枚举全部记录键、降序排序，只读取当前页的 JSON 值。这适合少量记录，查询成本随记录数量增加；未来大量数据应改用支持索引的数据库。
- `public/index.html` 是后端服务说明页，不包含 API Key 或鉴权令牌。

## 已确认的账号状态

通过用户已登录的 Chrome 查看 Netlify Usage & billing：团队 `dream533534` 的套餐为 Free，查看时显示 300/300 credits 可用，未保存信用卡信息。此信息是部署前快照，不表示部署后额度不变。

官方当前免费档为每月 300 credits 硬上限，无自动充值。生产部署、请求、计算与带宽消耗额度；用尽会暂停服务。Gemini 的额度与账单独立，未在本次核实 Google 账号实际账单。

## 本地验证结果

- TypeScript 检查通过。
- 官方 `netlify build --offline` 构建通过，完成 Functions 打包。原 TypeScript 7 与构建器解析器不兼容，已改为固定 5.9.3；当前类型检查和打包均通过。
- 14 项测试通过：8 项原 Worker/D1 回归，6 项新增 Netlify/Blobs 验证。
- 新测试运行真实 ADK、真实 Blobs SDK 和官方本地 BlobsServer，仅 Gemini HTTP 回复被模拟。
- Node v26.7.0 的真实 Gemini 调用返回 HTTP 201，模型耗时 1347 ms，Blobs 写入及读回内容一致。首次尝试返回 `MODEL_UNKNOWN_ERROR`，当时缺少足够诊断，无法确认原因；后续原生 Node fetch 重试收到上游 HTTP 200 并通过完整验证。
- 本地 BlobsServer 重启后记录仍能读回。
- 官方 Netlify Dev 实际 HTTP 服务的 `/health` 和 `/api/records` 返回 200。首次默认启动时未使用的 Deno Edge 代理导致包括静态页面在内的请求超时；本项目没有 Edge Functions，开发脚本通过 CLI 内部 `--internal-disable-edge-functions` 参数关闭该本地代理后恢复。此参数仅用于本地开发，不改变云端入口。
- 实际本地 HTTP 分析请求曾两次返回 `MODEL_UNKNOWN_ERROR`；未取得足够的失败传输诊断，具体原因未知。加上只输出 HTTP 状态的诊断并重启后，原生 fetch 收到 Gemini HTTP 200，分析返回 201、模型耗时 1136 ms，生成的记录 ID 为 `8a1ee8a0-0ed9-45cf-a917-48d3efa41925`。不带诊断重新启动后，`GET /api/records` 仍完整读回同一条记录，确认实际开发服务的 Blobs 持久化。不能把模型重试成功归因于诊断脚本。
- Netlify 构建配置选择 Node 24，本地结果是在 Node 26 下取得。实际云端函数已通过模型与存储业务验证；验证响应未报告具体 Node 版本，因此不把配置选择当成云端实际版本的独立测量。

原始结果位于已忽略的 `verification/netlify-live-smoke.local.json`，包含合成测试输入及模型输出，不含密钥。

## 部署状态

Netlify CLI 授权已完成，已创建并关联项目 `ai-meal-adk-verification-dream533534`，站点 ID 为 `2e2e8d1b-8a95-4cb6-9147-0676c1d68a3c`。实际 HTTPS 地址已从官方 API 写入 `deployment-netlify.json`。

生产密钥上传首次被自动审批拒绝，理由为用户尚未明确授权把现有 Gemini Key 和 API Bearer Token 传到该项目。用户随后明确允许上传这两项密钥并继续部署。

站点环境变量的 Functions 范围设置返回 403；官方文档说明细分 scopes 需要 Pro。改用官方 CLI `--secret-env` 的部署级 Functions 变量，维持 Free 且不扩大变量范围。生产部署已成功：`6ac75cd7f0cb2c3e109c844b`，官方 API 状态为 `ready`，发布时间 `2026-10-08T09:05:38.614Z`。CLI 参数只在内存传递，没有把密钥放入 shell 命令参数。

项目最初为 Private，未登录 GET `/health` 返回 Netlify 登录跳转 HTML / HTTP 401，未到达业务函数。用户随后自行保存为生产 Public、Deploy Previews Private；此次配置由截图确认，生产公开访问由实际 HTTP 请求确认。未来更新需使用 `npm run deploy` 重新注入部署变量。

## 云端端到端结果

验证启动时间：`2026-10-08T09:18:42.986Z`（北京时间 17:18:42）。目标为上述实际生产 HTTPS 地址，令牌从本地文件读取、只在请求头中传递，不出现在日志中。全部断言通过：

| 检查 | 结果 |
| --- | --- |
| GET `/health` 无令牌 | 200；框架 `google-adk-js`、配置齐全 |
| POST `/api/analyze` 无令牌 | 401；`UNAUTHORIZED` |
| GET `/api/records` 无令牌 | 401；`UNAUTHORIZED` |
| 空白分析输入 | 400；`INVALID_INPUT` |
| 无效分页 `limit=0` | 400；`INVALID_PAGINATION` |
| 真实 ADK / Gemini 分析 | 201；`gemini-3.1-flash-lite`；模型耗时 4596 ms，整个 HTTP 请求 5064 ms |
| GET `/api/records` 带令牌 | 200；找到同一记录，所有字段与分析响应完全相等 |

此次只发送合成输入“早餐吃了一个鸡蛋和一片面包，重量和配料未知”。真实模型输出整理了已知食物和数量，并指出重量、面包种类、烹饪方式及额外配料缺失，没有生成假定热量。远端测试记录 ID：`a06bd5d9-f99c-4f0b-9b85-4977b993f871`，创建时间 `2026-10-08T09:18:51.736Z`。

公开状态摘要保存在 `netlify-cloud-summary.json`；包含合成输入和输出的完整报告为已忽略的 `netlify-cloud-smoke.local.json`。这次成功证明实际生产环境的模型与 Blobs 读写链路可用，尚未测试长期稳定性、并发或大量历史记录的查询性能，也没有为验证跨部署持久化额外发布一个版本。

## 官方依据

- [免费档及计费](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/)
- [Functions 配置和运行限制](https://docs.netlify.com/build/functions/configuration/)
- [Functions API 和自定义路径](https://docs.netlify.com/build/functions/api/)
- [Blobs 站点级存储、分页和一致性](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
- [Functions 环境变量的套餐范围限制](https://docs.netlify.com/build/functions/environment-variables/)
- [CLI 部署级 Functions 密钥参数](https://cli.netlify.com/commands/deploy/)
- [新项目默认 Private 与公开访问](https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/)
