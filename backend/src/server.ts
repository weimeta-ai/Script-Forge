// =============================================================================
// 服务启动入口
// -----------------------------------------------------------------------------
// 【前端转全栈知识点】
// server.ts 做什么：
//   1. 引入 app（Hono 实例）
//   2. 启动 HTTP 服务监听端口
//   3. 处理进程信号（优雅关闭）
//
// 为什么不在 app.ts 里启动：
//   - 关注点分离：app.ts 定义"应用是什么"，server.ts 定义"怎么运行"
//   - 测试时不需要启动服务，直接测 app 即可
//
// Hono 的 serve 函数：
//   Hono 自带 serve（基于 Node http），也可以接入 @hono/node-server
//   我们用 node-server（功能更全，支持 stream、keep-alive 等）
// =============================================================================

import { serve } from '@hono/node-server'
import { env } from './config/env'
import { app } from './app'
import { logger } from './logger/index'

// -----------------------------------------------------------------------------
// 启动服务
// -----------------------------------------------------------------------------
const server = serve(
  {
    fetch: app.fetch,                          // Hono 的请求处理函数
    port: env.PORT,                            // 监听端口（从环境变量读）
    hostname: '0.0.0.0',                       // 0.0.0.0 = 监听所有网卡（Docker 部署需要）
  },
  (info) => {
    // info 包含 port、address 等
    logger.info(
      {
        port: info.port,
        env: env.NODE_ENV,
        corsOrigin: env.CORS_ORIGIN,
      },
      `🚀 短剧预测后端服务已启动 → http://localhost:${info.port}`
    )
    logger.info(`📋 健康检查 → http://localhost:${info.port}/health`)
  }
)

// -----------------------------------------------------------------------------
// 优雅关闭（Graceful Shutdown）
// -----------------------------------------------------------------------------
// 【重要】为什么需要优雅关闭：
//   场景：你按 Ctrl+C 关服务，但此刻有 5 个用户正在请求
//   - 暴力关闭：5 个请求全部失败（用户看到错误）
//   - 优雅关闭：
//     1. 停止接收新请求
//     2. 等待进行中的请求完成（最多 30 秒）
//     3. 关闭数据库连接、Redis 连接
//     4. 退出进程
//
// 信号说明：
//   SIGINT  = Ctrl+C 触发
//   SIGTERM = kill 命令触发（Kubernetes/Docker 停容器时发）
// -----------------------------------------------------------------------------
function gracefulShutdown(signal: string) {
  logger.info({ signal }, '🛎 收到关闭信号，开始优雅关闭...')

  server.close((err) => {
    if (err) {
      logger.error({ err }, '关闭服务时出错')
      process.exit(1)
    }

    logger.info('✅ 服务已关闭')
    process.exit(0)
  })

  // 兜底：如果 10 秒还没关完，强制退出
  // 防止某个请求卡死导致进程不退出
  setTimeout(() => {
    logger.warn('⏰ 优雅关闭超时，强制退出')
    process.exit(1)
  }, 10000).unref()                           // unref = 这个定时器不阻止进程退出
}

// 监听关闭信号
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))

// 未捕获异常兜底（最后的防线）
// 任何 try/catch 没捕获到的错误都会到这里
// 必须监听，否则进程会崩溃且没有日志
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, '💀 未捕获异常，进程即将崩溃')
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, '💀 未处理的 Promise 拒绝')
  process.exit(1)
})
