// =============================================================================
// Hono 应用实例（核心）
// -----------------------------------------------------------------------------
// 【前端转全栈知识点】
// app.ts 做什么：
//   创建 Hono 实例，挂载所有中间件、路由。
//   但不启动服务（启动在 server.ts）。
//
// 为什么拆 app.ts 和 server.ts：
//   - app.ts 只关心"应用本身"（路由、中间件），方便测试
//   - server.ts 关心"启动"（监听端口、信号处理）
//   - 测试时可以直接 import app，不发请求测试逻辑
//
// 中间件链（执行顺序很重要）：
//   请求 → requestId → logger → cors → errorHandler → 业务路由 → 响应
//   类比：React 的 Context Provider 嵌套，从外到内
// =============================================================================

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger as honoLogger } from 'hono/logger'
import { requestId } from 'hono/request-id'
import { secureHeaders } from 'hono/secure-headers'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { env, isDev, isProd } from './config/env'
import { logger } from './logger/index'
import { healthRoutes } from './routes/health.routes'
import { authRoutes } from './routes/auth.routes'
import { scriptRoutes } from './routes/script.routes'
import { knowledgeRoutes } from './routes/knowledge.routes'
import { llmConfigRoutes } from './routes/llm-config.routes'
import { imageConfigRoutes } from './routes/image-config.routes'
import { ossConfigRoutes } from './routes/oss-config.routes'
import { loginBannerRoutes } from './routes/login-banners.routes'
import { promptConfigRoutes } from './routes/prompt-config.routes'
import { debugRoutes } from './routes/debug.routes'
import { adminUserRoutes } from './routes/admin-users.routes'
import { adminUsageRoutes } from './routes/admin-usage.routes'
import { adminCreditRulesRoutes } from './routes/admin-credit-rules.routes'
import { creditRoutes } from './routes/credit.routes'
import { pushRuntimeLog } from './lib/runtime-logger'

// -----------------------------------------------------------------------------
// 创建 Hono 实例
// -----------------------------------------------------------------------------
// 类型参数 <Bindings, Variables>：
//   Bindings  = 环境变量类型（Hono Cloudflare/Edge 风格，我们用 process.env 不需要）
//   Variables = ctx.set/ctx.get 的类型（用于在中间件间传递数据，如 ctx.user）
//   这里先空着，后续鉴权中间件会用到 Variables
export const app = new Hono()

// -----------------------------------------------------------------------------
// 全局错误处理（必须最先注册）
// -----------------------------------------------------------------------------
// Hono 的 onError 类似 React 的 ErrorBoundary
// 任何路由里抛出的错误都会到这里，统一转成前端友好的响应
app.onError((err, c) => {
  // 业务错误（我们主动抛的）
  if (err.name === 'BusinessError') {
    const be = err as unknown as { code: string; message: string; status: number; details?: unknown }
    logger.warn({ code: be.code, path: c.req.path }, be.message)

    return c.json(
      {
        code: be.code,
        data: be.details ?? null,
        message: be.message,
      },
      be.status as 400 | 401 | 403 | 404 | 409 | 500 | 502 | 504,
    )
  }

  // 未知错误（程序 bug）
  logger.error(
    {
      err,
      path: c.req.path,
      method: c.req.method,
    },
    '未处理异常'
  )

  // 生产环境隐藏错误详情（避免泄漏堆栈）
  // 开发环境返回完整堆栈方便调试
  const message = isProd ? '服务器内部错误' : err.message

  return c.json(
    {
      code: 'INTERNAL_ERROR',
      data: null,
      message,
      ...(isDev ? { stack: err.stack } : {}),
    },
    500
  )
})

// -----------------------------------------------------------------------------
// 全局 404 处理
// -----------------------------------------------------------------------------
// 没有匹配到任何路由时触发
app.notFound((c) => {
  return c.json(
    {
      code: 'NOT_FOUND',
      data: null,
      message: `路径不存在：${c.req.method} ${c.req.path}`,
    },
    404
  )
})

// -----------------------------------------------------------------------------
// 中间件链
// -----------------------------------------------------------------------------
// 注意：注册顺序决定执行顺序
// 1. requestId  最先执行，给每个请求分配唯一 ID
// 2. logger     记录每个请求（带 requestId）
// 3. cors       处理跨域预检请求
// 4. secureHeaders 加安全响应头
// -----------------------------------------------------------------------------

// 给每个请求分配唯一 ID（X-Request-Id 响应头）
// 方便日志排查：前端报错时把 requestId 给后端，秒级定位日志
app.use('*', requestId())

// HTTP 请求日志（每个请求一行：METHOD /path 200 12ms）
app.use('*', honoLogger())

// CORS 跨域
// 【前端必懂】浏览器有同源策略：前端 5173 调后端 3000 算跨域
//   没配 CORS → 浏览器拦截请求
//   配了 CORS → 后端响应头加 Access-Control-Allow-Origin: http://localhost:5173
app.use(
  '*',
  cors({
    origin: env.CORS_ORIGIN.split(','),        // 支持多个 origin（逗号分隔）
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposeHeaders: ['X-Request-Id'],
    credentials: true,                         // 允许带 Cookie（如果用 cookie 存 token）
    maxAge: 86400,                             // 预检结果缓存 24 小时
  })
)

// 安全响应头（防止常见攻击：XSS、点击劫持等）
app.use('*', secureHeaders())

// -----------------------------------------------------------------------------
// 路由挂载
// -----------------------------------------------------------------------------
// 【设计要点】所有 API 路由统一挂在 /api 前缀下
// 原因：
//   - 前端通过 VITE_API_BASE_URL=/api 统一加前缀，避免与前端 SPA 路由冲突
//   - 开发环境：vite proxy 把 /api/* 转发到后端（保留 /api 前缀）
//   - 生产环境：Hono 同时 serve 前端 dist + 处理 /api/* API 路由
//
// 健康检查（不需要鉴权）
const api = new Hono()
api.route('/health', healthRoutes)

// 鉴权路由：/auth/login、/auth/register、/auth/me
api.route('/auth', authRoutes)

// 业务路由（p00 同款：剧本直挂用户）
api.route('/scripts', scriptRoutes)
// 知识库样本（admin 批量导入 + user 检索接口）
api.route('/knowledge', knowledgeRoutes)
// LLM 运行时配置（admin only：GET/PUT/POST test）
api.route('/llm-config', llmConfigRoutes)
// 图片模型配置（admin only：GET/PUT/POST test；登录用户：POST generate）
api.route('/image-config', imageConfigRoutes)
// 阿里云 OSS 图床配置（admin only：GET/PUT/POST test；upload-by-url）
api.route('/oss-config', ossConfigRoutes)
// 登录页轮播图（GET / 公开；POST/PATCH/DELETE admin only）
api.route('/login-banners', loginBannerRoutes)
// Prompt 话术配置（admin only：报告 system prompt + 封面模板，含版本历史）
api.route('/prompt-config', promptConfigRoutes)
// Debug 日志（admin only，前端 Cmd+Shift+L 调试面板用）
api.route('/debug', debugRoutes)
// 用户管理（admin only：CRUD + per-user 配置 + 复制模板 + 积分调整/流水）
api.route('/admin/users', adminUserRoutes)
// 用法统计（admin only：单用户流水 + 全局聚合）
api.route('/admin/usage', adminUsageRoutes)
// 积分规则管理（admin only：CRUD）
api.route('/admin/credit-rules', adminCreditRulesRoutes)
// 积分用户端（登录用户：查自身余额 / 流水）
api.route('/credits', creditRoutes)

// 挂载到主应用，所有 API 都通过 /api 前缀访问
app.route('/api', api)

// 启动事件日志（前端调试面板可见）
pushRuntimeLog({
  level: 'info',
  category: 'system',
  message: `API server 启动 (port=${env.PORT}, env=${env.NODE_ENV})`,
  meta: { logLevel: env.LOG_LEVEL },
})

// 兼容老路径 /health（不带 /api 前缀），方便后端单独健康检查
app.get('/health', (c) => c.json({ status: 'healthy' }))

// -----------------------------------------------------------------------------
// 静态文件服务（生产环境合并部署，必须放在所有路由之后）
// -----------------------------------------------------------------------------
// 设计：
//   - 开发模式（STATIC_ROOT 未配置）：跳过，前端走 vite dev server
//   - 生产模式（STATIC_ROOT 指向前端 dist）：
//     1. 先匹配所有 API 路由（上面已挂载）
//     2. API 未命中的 GET 请求 → 第一个 serveStatic 尝试找静态文件
//     3. 静态文件没找到 → 第二个 serveStatic 回退 index.html（SPA 路由交给 React Router）
const staticRoot = env.STATIC_ROOT
if (staticRoot && existsSync(staticRoot)) {
  const root = path.resolve(staticRoot)
  logger.info({ staticRoot: root }, '🎬 静态文件服务已挂载（前端 SPA）')

  // 1. 尝试匹配静态文件（js/css/图片等）
  //    找不到文件时自动调用 next()，进入下面的 fallback
  app.use('*', serveStatic({ root }))

  // 2. SPA fallback：所有未匹配的 GET 请求都返回 index.html
  //    React Router 接管路由（如 /login、/scripts/123）
  app.get('*', serveStatic({ path: path.join(root, 'index.html') }))
} else if (isProd) {
  // 生产环境但 STATIC_ROOT 未配置：警告（不阻止启动，仅 API 模式）
  logger.warn('⚠️  生产环境未配置 STATIC_ROOT，仅以纯 API 模式运行')
}

// -----------------------------------------------------------------------------
// 根路由（API 模式下的友好提示）
// -----------------------------------------------------------------------------
// 注意：必须放在静态文件服务之后！如果配置了 STATIC_ROOT，静态服务会优先匹配
// 只有当静态服务找不到（纯 API 模式）时，才会走到这里返回 API 元数据
app.get('/', (c) => {
  return c.json({
    name: 'drama-predict-backend',
    version: '1.0.0',
    docs: '/api/health',
  })
})

export default app
