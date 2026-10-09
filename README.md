# AI-Meal Android 选餐应用

Android 工程位于 `android/`，使用 Kotlin、Compose 和官方 AndroidX A2UI v0.9.1 渲染器。界面采用白色极简风，提供食物录入与删除、文字选餐、条件点选、换一批、确认选择和无匹配预算调整。运行代码不包含预置演示菜单；名称、价格与口味均来自用户录入，尚未连接真实商家。

应用最低 Android 8（API 26），构建需要 JDK 17 以上、Android SDK 37.1、AGP 9.1.1 和 Gradle 9.3.1。官方 A2UI 及其 Material catalog 当前为 `1.0.0-alpha01`，依赖版本固定；尚不代表稳定版 API。

```sh
cd android
./gradlew assembleDebug
```

在 `android/local.properties` 中配置自己的 `sdk.dir`，或设置 `ANDROID_HOME`。APK 生成在 `android/app/build/outputs/apk/debug/app-debug.apk`。首次打开填写访问令牌，服务地址默认指向下面的 Netlify 站点。令牌使用 Android Keystore AES-GCM 加密保存，配置弹窗禁止截图，应用包中没有服务密钥。

先点击首页“录入 / 管理”，填写食物名称、价格（0–10000 元，最多两位小数）、适用餐别、辣度、主食和清淡口味。保存后可返回首页选餐。菜单为空时显示录入引导，不调用模型生成候选。食物库保存在 Netlify Blobs `ai-meal-foods`，使用现有后端令牌共享访问；当前没有多用户隔离。重复提交同一录入 ID 不会重复创建。删除需在应用中确认，已删除食物不会从旧会话恢复。

文字例子：`帮我选个午饭，预算30元，不要辣。` 也可以直接点选餐别、预算和辣度后点击“更新推荐”。主食和清淡口味在“更多偏好”中。未说明餐别时只显示午饭/晚饭问题并保留其他条件；无匹配时解释原因并提供真实匹配数支持的预算或单项放宽方案。确认后只展示最终选择。完整条件表单在“改一下条件”中。模型只解析文字并调用工具，候选和价格以实际 MCP 菜单查询为准。

选餐接口采用 Netlify Blobs `ai-meal-picker-sessions` 独立 store，持久化领域条件、结果、修订号和脱敏 MCP 证据。更新依赖真实 ETag 条件写入，过期或并发修订返回 409；Android 同时只提交一个请求并加载冲突后的最新状态。

| 请求 | 用途 |
| --- | --- |
| `GET /api/meal-picker/foods` | 读取已录入食物 |
| `POST /api/meal-picker/foods` | 校验并保存食物（可提供 UUID 保证重试幂等） |
| `DELETE /api/meal-picker/foods?id=<uuid>` | 删除指定食物 |
| `GET /api/meal-picker/bootstrap` | 初始官方 A2UI 面板，不调用模型 |
| `POST /api/meal-picker/session` | 以 `text` 或 `filters` 创建会话 |
| `GET /api/meal-picker/session?id=<uuid>` | 恢复会话 |
| `POST /api/meal-picker/action` | `sessionId`、`revision` 和 A2UI 动作（update/rotate/select/adjust_budget/choose_meal/relax_filter/edit_filters/restart） |
| `DELETE /api/meal-picker/session?id=<uuid>` | 清理指定会话 |

这些接口均使用现有 Bearer 令牌，返回 `session` 元数据和按顺序排列的完整 `messages` 数组。单个 JSON 响应不等同于 JSONL 流。MCP 使用官方 SDK 的 client/server 和 in-memory transport，实际经过发现和调用协议；它目前部署在同一个 Function 进程内。

文字选餐请求强制模型调用提供的工具，每轮最多一次模型调用，工具完成后直接展示 MCP 结果，不再等待模型总结。明确的按钮动作直接调用 MCP，不依赖模型或模型密钥；会话执行路径标记为 `direct`。单次模型尝试限制为 10 秒，暂时性上游错误或超时最多再试一次，避免超过线上观察到的 30 秒 Function 时限。失败日志只记录原因码与调用数量；Android 将超时、模型繁忙等错误分别提示，非 JSON 网关错误也按 HTTP 状态处理。模型与网络故障仍可能发生，重试不会自动放宽筛选条件。

本地选餐开发与真实链路验证：

```sh
npm run dev:meal -- --curl-outbound
npm run verify:meal:live
npm run verify:meal:cloud
node scripts/verify-guided-cloud.mjs
```

`verify-guided-cloud.mjs` 使用当前已保存食物验证逐步选餐，只创建并删除独立验收会话，不改变食物记录。旧的 `verify:meal:cloud` 真实链路验收要求食物库为空，临时创建明确标注的验收食物，结束时删除食物和会话并确认库中剩余 0 条。自动化测试样本仅位于 `tests/fixtures`，不打包到 Function 或 APK。生产演示数据清理使用 `scripts/clean-demo-data.mjs`（默认只读；`--apply` 删除能由演示来源、候选 ID 或已保存验收报告明确识别的数据）。

选餐开发服务监听 `127.0.0.1:8889`，模拟器 debug 包可使用 `http://10.0.2.2:8889`。本地数据保存在 `.netlify/meal-blobs/`；生产代码不使用本地测试适配器。Blobs 11.1.3 的本地服务器缺少 GET ETag，并发条件写入也需要串行化，因此本地脚本使用扩展适配器。生产的原子写入另用真实 Netlify 接口验证。`--curl-outbound` 仅用于本机 Node 直连异常时转发真实 Gemini HTTP，不模拟模型。

`scripts/android-test-setup.mjs` 配合独立测试 APK 写入加密测试配置，令牌经 `run-as` 标准输入传递。配置器不包含在应用 APK 中，默认只接受明确指定的 emulator ID。用户明确要求真实手机安装后才可使用 `--physical-authorized`；配置完成移除手机上的测试 APK，并删除临时明文文件。

原有饮食分析与历史后端仍保留如下。

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
- `test` 包含 8 项 Worker / D1 回归、6 项 Netlify / Blobs 验证和 10 项选餐验证，运行真实 ADK、MCP 和存储运行时，只模拟 Gemini HTTP。
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
