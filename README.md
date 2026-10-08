# AI-Meal 后端验证项目

当前采用 Google ADK JS / TypeScript + Gemini + Netlify Functions + Netlify Blobs。用户于 2026-10-08 确认切换到 Netlify Free；账号套餐已在控制台核实。生产代码与密钥已部署，生产版本公开、预览版本私有，线上健康、鉴权、真实 Gemini 调用和远端 Blobs 完整读回均已通过。结果见 [Netlify 验证报告](verification/NETLIFY.md)。

生产地址：[AI-Meal 后端](https://ai-meal-adk-verification-dream533534.netlify.app/)，[健康接口](https://ai-meal-adk-verification-dream533534.netlify.app/health)。根页面仅为后端说明，分析与历史接口需要令牌。

默认模型为 `gemini-3.1-flash-lite`，ADK 固定为 2.2.1。请求经 Functions 入口进入 ADK LlmAgent / Runner，成功后将完整输入、输出、模型和时间写入站点级 Blobs。每次分析使用独立的内存 session；模型失败、空输出和 MAX_TOKENS 截断均返回 502，不保存成功记录。

## 本地运行

Netlify 构建配置选择 Node 24；本机使用 Node 26.7.0。依赖版本由锁文件固定，公共 npm registry 与 `legacy-peer-deps` 由 `.npmrc` 配置。

```sh
npm ci
npm run dev
```

新机器先复制 `.dev.vars.example` 为 `.dev.vars`，填写 Gemini Key 和随机 `API_AUTH_TOKEN`。当前机器已有配置，不要覆盖。开发脚本在内存中读取该文件并传给 Netlify CLI，默认监听 `http://localhost:8888`；本地 Blobs 使用开发服务器存储，无需 D1 迁移。

本项目没有 Edge Functions。本机 CLI 的未使用 Edge 代理曾导致所有请求超时，开发脚本使用内部 `--internal-disable-edge-functions` 参数关闭该代理；默认命令已验证健康接口、真实模型请求、Blobs 读回及服务重启后数据保留。这是本地开发兼容措施，不改变云端 Functions。

另开终端，在项目目录执行：

```sh
npm run request:local -- health
npm run request:local -- analyze "早餐吃了一个鸡蛋和一片面包，重量和配料未知。请整理已知信息。"
npm run request:local -- history
```

请求脚本从本地文件读取令牌，不把令牌放在命令参数中。分析会真实调用 Gemini。`.dev.vars`、`.netlify`、旧 `.wrangler` 数据及原始验证 JSON 均已忽略。

## 接口

除 `/health` 外均要求 `Authorization: Bearer <API_AUTH_TOKEN>`。

| 请求 | 输入 | 成功响应 |
| --- | --- | --- |
| `GET /health` | 无 | 200，框架、模型和配置状态 |
| `POST /api/analyze` | JSON：`{"input":"饮食信息"}` | 201，`{"record":{...}}` |
| `GET /api/records?limit=20&offset=0` | limit 1–50，offset 0–10000 | 200，records、limit、offset |

输入去除首尾空白后需为 1–2000 个 JavaScript 字符串长度单位，请求体上限 8192 字节。记录字段为 `id`、`input`、`output`、`model`、`created_at`、`duration_ms`；耗时包含网络等待。历史记录按创建时间和 ID 降序返回。

常见错误：400 输入或分页无效、401 未授权、413 请求体过大、415 非 JSON、503 配置缺失、502 模型调用失败、500 存储或请求处理失败。上游详细错误不会回显。`/health` 只检查配置是否存在，不能替代真实模型和存储验证。

当前用于个人后端验证，共享一个令牌和一份记录；尚无用户身份隔离、CORS 配置或按用户限流。根路径是后端服务说明页，没有饮食应用界面。

## 构建与验证

```sh
npm run check
npm run build
npm test
npm run verify:live
```

- `build` 调用官方 Netlify 构建器，完成类型检查及 Functions 打包。
- `test` 包含 8 项 Worker / D1 回归和 6 项 Netlify / Blobs 验证，运行真实 ADK 和存储运行时，只模拟 Gemini HTTP。
- `verify:live` 使用真实 Gemini API 和临时官方 BlobsServer，断言生成内容完整读回；结束后清理临时数据。原始报告为 `verification/netlify-live-smoke.local.json`。

TypeScript 固定 5.9.3，以兼容 Netlify 构建器所用解析器。OpenTelemetry trace base/node 保持 2.11.0 覆盖；这源于旧安装过程中 2.12.0 依赖链无法取得，当前组合已验证。

## Netlify 部署

CLI 已授权并关联团队 `dream533534` 的项目 `ai-meal-adk-verification-dream533534`。实际站点 ID 和 URL 保存在 `deployment-netlify.json`。部署时变量只用于本次部署的 Functions：`GEMINI_API_KEY`、`API_AUTH_TOKEN`、`GEMINI_MODEL`。

两项密钥上传已获用户明确授权。后续部署与验证命令为：

```sh
npm run deploy
npm run verify:cloud
```

`deploy` 脚本读入本地密钥，通过官方 CLI 的 `--secret-env` 仅传给本次生产部署的 Functions，值在 Netlify UI / API 中隐藏。CLI 参数在内存传递，不放入操作系统命令参数，输出仅包含公开部署字段。每次更新都使用此脚本重新注入两项密钥；单独运行普通 `netlify deploy` 不会自动继承这些部署变量。Free 不支持站点环境变量仅限定 Functions 的 scopes 设置，所以没有创建适用于所有范围的站点密钥变量。[官方 deploy 参数](https://cli.netlify.com/commands/deploy/)

`node scripts/netlify-settings.mjs` 只读取并更新部署元数据。`verify:cloud` 使用本地令牌对实际 Netlify 地址验证健康、鉴权、输入校验、真实 Gemini 生成和远端 Blobs 完整读回，并保存一条合成测试记录。报告为 `verification/netlify-cloud-smoke.local.json`。

Blobs 使用站点级 `ai-meal-records` store 和强一致性读取，数据独立于每次部署。历史查询枚举全部记录键，再读取当前页 JSON；适合少量记录，成本随记录数量增加。旧 D1 和本地历史没有导入。

## 免费方案和旧部署

Netlify Free 当前每月 300 credits，为硬上限；生产部署、计算、请求和带宽消耗额度，用尽暂停服务。部署前控制台显示 300/300 credits，未保存信用卡。Gemini 的配额和账单独立，本次没有检查 Google 账号实际计费状态。[Netlify 免费档说明](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/)

旧 Cloudflare Workers / D1 资源保留。历史部署与网络失败证据见 [Cloudflare 记录](verification/CLOUDFLARE-LEGACY.md) 和 [原验证报告](verification/REPORT.md)。旧平台命令改为 `dev:worker`、`build:worker`、`deploy:worker`、`verify:live:worker`、`verify:cloud:worker`；D1 迁移命令仍供旧部署使用。
