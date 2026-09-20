// =============================================================================
// 健康检查路由
// -----------------------------------------------------------------------------
// 【前端转全栈知识点】
// 什么是健康检查：
//   一个最简单的接口，返回"服务还活着"。
//   用途：
//     1. 部署后验证服务是否启动（curl /health）
//     2. 负载均衡器（如 Nginx）定期探活，挂了就摘除流量
//     3. Kubernetes/Docker 的 liveness probe 探活
//
// 为什么单独成一个文件：
//   健康检查不经过业务中间件（如鉴权），需要单独挂载
// =============================================================================

import { Hono } from 'hono'
import { ok } from '../lib/response'
import { env } from '../config/env'

// 创建一个子应用（路由组）
// 用 Hono 实例可以嵌套，类似 React Router 的嵌套路由
export const healthRoutes = new Hono()

// GET /health
// 最简版本：服务在跑就返回 ok
healthRoutes.get('/', (c) => {
  return ok(c, {
    status: 'healthy',
    service: 'drama-predict-backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    env: env.NODE_ENV,                        // 让前端知道当前环境（开发/生产）
  })
})

// GET /health/ready
// 就绪检查：依赖的服务（DB/Redis）是否可用
// 这个接口我们暂时简化处理，后续接上 DB 后再加 ping 检查
healthRoutes.get('/ready', (c) => {
  return ok(c, {
    status: 'ready',
    checks: {
      database: 'pending',                   // TODO: 接上 DB 后改成真实 ping
      redis: 'pending',                      // TODO: 接上 Redis 后改成真实 ping
    },
  })
})
