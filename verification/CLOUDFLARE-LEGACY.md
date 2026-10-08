# AI-Meal 后端验证项目

这是切换前的历史 Cloudflare 说明，命令名称和状态以当时为准。当前 Netlify 工作流见 [README](../README.md)；旧平台命令现带 `:worker` 后缀，不能直接照搬下文默认命令。

2026-10-08 用户确认切换到 **Netlify 免费方案**。Netlify Functions + Blobs 迁移代码已加入，14 项回归测试和本地真实 Gemini / Blobs 读回验证通过；Netlify 云端部署尚待完成。当前账号已在控制台核实为 Free。详见 [Netlify 迁移与验证](verification/NETLIFY.md)。下文 Cloudflare 内容保留作旧部署记录，不能视为当前 Netlify 配置。

目前已实现 Google ADK JS/TypeScript + Gemini + Cloudflare Workers + D1 的最小后端，并通过本地真实 Gemini 调用、记录写入和读取验证。2026-10-08 已部署到 Cloudflare Workers，远端 D1 已建表，两项 secrets 已上传。公开接口的云端调用因本机连接超时尚未验证，用户选择保留当前部署。

默认模型为 `gemini-3.1-flash-lite`。验证过程中，`gemini-flash-latest` 返回过 503，`gemini-2.5-flash` 和 `gemini-2.5-flash-lite` 返回过 404；模型列表能够列出这些名称，但这并不代表当时生成接口一定可用。详见 [验证报告](verification/REPORT.md)。

## 请求流程

```text
客户端 → Workers 接口 → ADK LlmAgent / Runner → Gemini API
                    ← 完整模型文本
                    → D1 保存 input / output / model / 时间
```

每次分析使用独立的内存 ADK session，调用上限为一次；D1 只持久化完成的输入和输出，不保存 ADK 多轮会话。模型错误、无文本和 MAX_TOKENS 截断均返回 502，不写入成功记录。

`src/agent.ts` 使用 ADK 包中的 `@google/adk/dist/web/index_web.js` 入口，避免引入 Node 专用集成。该入口已在本地 workerd 实测。ADK 固定为 2.2.1，升级时需要重新检查此子路径与 Workers 兼容性。

## 本地运行

本项目在 Node 26.7.0 下验证。ADK 官方 TypeScript 快速入门当前要求 Node 24.13.0+、npm 11.8.0+，参见 [官方文档](https://adk.dev/get-started/typescript/)。

```sh
npm ci
```

项目 `.npmrc` 和锁文件使用公共 npm registry；关键依赖固定版本。已重新执行 `npm ci` 并通过构建、类型检查和全部测试。

新机器复制 `.dev.vars.example` 为 `.dev.vars`，填写 Gemini Key 和随机 `API_AUTH_TOKEN`。当前机器的 `.dev.vars` 已配置，不要用示例覆盖。真实密钥文件、D1 本地数据、构建产物和原始验证 JSON 均已加入 `.gitignore`。

```sh
npm run db:migrate:local
npm run dev -- --ip 127.0.0.1 --port 8787
```

另开终端，在项目目录执行：

```sh
npm run request:local -- health
npm run request:local -- analyze "早餐吃了一个鸡蛋和一片面包，重量和配料未知。请整理已知信息。"
npm run request:local -- history
```

`request:local` 从本地文件读取鉴权令牌，不要求把令牌放在命令参数中。分析请求会真实调用 Gemini；历史查询读取 `.wrangler/state` 中的本地 D1 数据。开发服务停止后数据保留。健康检查仅表示 Worker 启动及密钥存在，不代表 Gemini 或 D1 此刻一定健康。

## 接口

除 `/health` 外均要求 `Authorization: Bearer <API_AUTH_TOKEN>`。

| 请求 | 输入 | 成功响应 |
| --- | --- | --- |
| `GET /health` | 无 | 200，框架、模型及配置状态 |
| `POST /api/analyze` | JSON：`{"input":"饮食信息"}` | 201，`{"record":{...}}` |
| `GET /api/records?limit=20&offset=0` | limit 1–50，offset 0–10000 | 200，records、limit、offset |

输入去除首尾空白后需为 1–2000 个 JavaScript 字符串长度单位，请求体上限 8192 字节。记录包含 `id`、`input`、`output`、`model`、`created_at`、`duration_ms`；最后一项是模型调用经过的时间，包含网络等待，不是 CPU 时间。

常见错误：400 输入或分页无效、401 未授权、413 请求体过大、415 非 JSON、503 配置缺失、502 模型调用失败、500 存储或请求处理失败。模型错误仅返回安全的 reason，不回显上游错误详情。

当前鉴权用于个人验证，共享一个令牌和一份记录。公开产品上线前仍需用户身份和记录隔离；当前没有前端、CORS 配置或按用户限流。

## 验证命令

```sh
npm run check
npm test
npm run verify:live
```

- `npm test` 先 dry-run 构建，然后运行真实 ADK、workerd 和本地 D1；仅远程 Gemini HTTP 回复被模拟，不消耗 Gemini 请求额度。
- `npm run verify:live` 先构建，使用 `.dev.vars` 中的 Key 真实调用 Gemini，并断言生成结果可完整从 D1 读回。数据库位于临时目录，验证结束会清理；结果写入 `verification/live-smoke.local.json`。
- `node --dns-result-order=ipv4first scripts/check-gemini.mjs` 检查真实模型列表，仅输出模型名称与安全状态。
- `node scripts/live-smoke.mjs --curl-outbound` 使用本机 curl 转发同一真实请求，仅用于网络诊断。该脚本没有模拟模型结果，curl 不进入 Worker 部署代码。本次原生 workerd fetch 和 curl 诊断方式均通过。

`package.json` 暂时将 OpenTelemetry trace base/node 固定到 2.11.0：首次安装时其 2.12.0 依赖链引用的 `@opentelemetry/sdk-trace@2.12.0` 无法取得。该覆盖下的构建和运行已验证；后续升级应重新检查依赖是否修复。

## 免费范围与后续云端验证

截至 2026-10-08 查阅的官方文档：

| 服务 | 免费档额度或限制 | 对本项目的影响 |
| --- | --- | --- |
| Workers | 100,000 请求/天；每次 HTTP 请求 CPU 10 ms；128 MB 内存 | 网络等待不计 CPU，但 ADK 初始化、序列化等会计入。尚未测量云端 CPU，不能保证满足免费档。 |
| D1 | 读取 5,000,000 行/天；写入 100,000 行/天；总存储 5 GB，单库上限 500 MB | 行计费不同于接口次数；索引维护也会影响写入计量。少量记录是本项目设计目标，实际用量需在云端观察。 |
| Gemini 3.1 Flash-Lite | 标准文本生成列有免费档；频率与项目额度需在 AI Studio 核对 | Key 已通过真实生成验证，但没有检查账户计费档位或实际账单，不能据此声明本次费用为零。 |

来源：[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)、[D1 价格](https://developers.cloudflare.com/d1/platform/pricing/)、[D1 限制](https://developers.cloudflare.com/d1/platform/limits/)、[Gemini 价格](https://ai.google.dev/gemini-api/docs/pricing)、[Gemini 频率限制](https://ai.google.dev/gemini-api/docs/rate-limits)。

## 当前云端部署

- Worker：`ai-meal-adk-verification`
- 地址：[Worker 健康接口](https://ai-meal-adk-verification.ai-meal-backend.workers.dev/health)
- D1：`ai-meal-records`，位置为 APAC；实际 database_id 已写入 `wrangler.jsonc`。
- 两项 Cloudflare secrets：`GEMINI_API_KEY`、`API_AUTH_TOKEN`，从本地文件上传，值未写入代码。
- 发布信息保存在 `deployment.json`，部署版本为 `3737dfe8-32a6-407b-981a-5fb1540d3f25`。

以后更新代码或本地密钥时执行：

```sh
npm run deploy -- --secrets-file .dev.vars
```

新增数据库迁移时先执行 `npm run db:migrate:remote`，再部署。云端数据库和本地数据彼此独立；本地测试记录未导入云端。

可用网络下执行云端端到端验证：

```sh
npm run verify:cloud
```

该命令从 `.dev.vars` 读取接口令牌，验证健康、鉴权和输入校验，再真实调用 Gemini、保存一条合成测试记录并从远端 D1 读回；结果保存在已忽略的 `verification/cloud-smoke.local.json`。不会上传本地历史记录。

本次自动化验证在第一个健康请求连接阶段超时，没有收到 Worker HTTP 响应，因此没有进行云端 Gemini 调用或记录写入。系统 DNS 与 Google DoH 返回地址不同；采用 DoH 地址且保留正常 TLS 校验后仍被连接重置。目前无法确认全部网络问题的具体原因。Cloudflare 管理 API 已确认目标版本部署占比 100%、workers.dev 路由启用和两项 secret 名称存在。

Cloudflare API 返回使用模式为 `standard`，它不足以证明账号是免费套餐。订阅查询因权限不足返回 403；免费档 CPU 适配、账号实际计费档位及账单仍未验证。

若普通 OAuth 登录无法回调 `localhost:8976`，当前 Wrangler 支持 `npx wrangler login --device`，通过 Cloudflare 网页输入短码授权，本次已用该方式登录成功。[设备登录官方说明](https://developers.cloudflare.com/workers/wrangler/commands/general/#use-wrangler-login-without-a-local-callback-server)
