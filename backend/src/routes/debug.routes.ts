// =============================================================================
// Debug 路由（admin only）
// -----------------------------------------------------------------------------
// 1 个接口：
//   GET /debug/logs?limit=200   读最近 N 条运行时日志（前端调试面板用）
//
// 设计要点：
//   - requireRole('admin')：日志可能含敏感信息（模型名、错误堆栈），仅 admin
//   - limit 上限 500（与 runtime-logger 缓冲区对齐）
//   - 不分页：调试面板只看最近活动，不需要 cursor
// =============================================================================

import { Hono } from 'hono'
import { requireAuth, requireRole } from '../middlewares/auth.middleware'
import { ok } from '../lib/response'
import { getRuntimeLogs } from '../lib/runtime-logger'

export const debugRoutes = new Hono()

debugRoutes.get('/logs', requireAuth, requireRole('admin'), async (c) => {
  const rawLimit = Number(c.req.query('limit') ?? 200)
  const limit = Number.isFinite(rawLimit) ? rawLimit : 200
  const items = await getRuntimeLogs(limit)
  return ok(c, { items })
})
