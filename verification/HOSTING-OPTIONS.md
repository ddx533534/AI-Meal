# Workers 域名访问失败后的候选方案

日期：2026-10-08。约束：尽量免费、无现成自有域名或代理、保留 Google ADK JS 和 Gemini、保存少量记录。现有 Worker 和 D1 继续保留。用户已于 2026-10-08 确认切换到 Netlify 免费方案，实施与验证见 [NETLIFY.md](NETLIFY.md)。

## 当前事实

用户浏览器访问 `ai-meal-adk-verification.ai-meal-backend.workers.dev/health` 显示 `ERR_CONNECTION_TIMED_OUT`；本机 Node 和 curl 请求也未收到 HTTP 响应。Cloudflare 管理 API 确认生产版本存在、公开路由启用、两项 secrets 已设置。不能因此认定模型或业务代码报错，也不能认定所有 Cloudflare 自有域名均不可达。

## 候选：Netlify

官方免费计划包含 Functions、数据存储，当前为每月 300 credits 上限。Functions 可使用 JavaScript / TypeScript；记录存储可适配其 Database 或 Blobs。Gemini 仍使用自己的 API Key，模型费用和额度独立于托管平台。

本机 HTTPS 探测 `https://www.netlify.com` 和 `https://example.netlify.app` 均取得 HTTP 200。这只证明两个被测地址在测试时可达，不证明新项目地址、用户所有网络或长期稳定性。迁移后必须重新验证实际部署的 health、鉴权、真实 Gemini 调用和持久化记录读回。

已确认的迁移范围：保留三个接口和 ADK / Gemini 模型调用逻辑，新增 Netlify Functions 入口，将 D1 记录存储适配到 Netlify 存储，配置 Gemini Key / API_AUTH_TOKEN，再完成端到端验证。用户已注册 Free 账号并授权 CLI；项目已创建，本地迁移和官方构建已通过。实时部署结果见 [NETLIFY.md](NETLIFY.md)。原 Workers / D1 资源保留。

来源：[Netlify 价格](https://www.netlify.com/pricing/)、[Functions](https://docs.netlify.com/build/functions/overview/)、[Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)。

## 其他探测与限制

- Render 主页返回 200，示例 `example.onrender.com` 返回 404，说明测试地址的 HTTPS 服务可达，但没有验证实际新项目。官方免费 Web Service 空闲 15 分钟会休眠；免费 Postgres 30 天到期，因此不能将整个组合描述为长期免费的持久数据库方案。[Render 免费限制](https://render.com/docs/free)
- Vercel 主页返回 200，示例 `example.vercel.app` 连接失败，暂不以此作为优先候选。它也不能证明所有 Vercel 项目均不可达。
- Deno 主页、旧控制台返回 200，示例 `example.deno.dev` 返回 404。尚未完成当前 Deploy 产品免费额度和 ADK 运行兼容性验证，不作为已验证方案。[Deno Deploy 文档](https://docs.deno.com/deploy/)

以上均为有限的连通性探测，不是已经完成替代平台部署的证据。
