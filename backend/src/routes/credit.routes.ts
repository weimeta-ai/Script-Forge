// =============================================================================
// 积分用户端路由（登录用户访问）
// -----------------------------------------------------------------------------
// 端点（挂在 /api/credits 下）：
//   GET  /balance         查询自身余额（balance / locked / available）
//   GET  /transactions    分页查询自身流水（支持 type / refTaskId 筛选）
// =============================================================================

import { Hono } from 'hono'
import { requireAuth } from '../middlewares/auth.middleware'
import { ok } from '../lib/response'
import { badRequest } from '../lib/errors'
import type { AppJwtPayload } from '../lib/jwt'
import { listTransactionsQuerySchema } from '../schemas/credit.schema'
import * as creditService from '../services/credit.service'

export const creditRoutes = new Hono<{
  Variables: { user: AppJwtPayload }
}>()

creditRoutes.use('*', requireAuth)

// GET /balance
creditRoutes.get('/balance', async (c) => {
  const user = c.get('user') as AppJwtPayload
  const balance = await creditService.getUserBalance(user.userId)
  return ok(c, balance)
})

// GET /transactions
creditRoutes.get('/transactions', async (c) => {
  const user = c.get('user') as AppJwtPayload
  const parsed = listTransactionsQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '参数错误',
    )
  }
  const result = await creditService.listUserTransactions(user.userId, parsed.data)
  return ok(c, result)
})
