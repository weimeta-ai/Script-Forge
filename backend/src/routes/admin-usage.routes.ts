// =============================================================================
// 用法日志路由（admin only）
// -----------------------------------------------------------------------------
// 端点（挂在 /api/admin/usage 下）：
//   GET  /users/:id/logs   单用户的调用流水（分页 + type 筛选）
//   GET  /summary          全局聚合（admin dashboard 用，V1 简版）
// =============================================================================

import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth, requireRole } from '../middlewares/auth.middleware'
import { ok } from '../lib/response'
import { badRequest } from '../lib/errors'
import type { AppJwtPayload } from '../lib/jwt'
import { usageLogRepository } from '../repositories/usage-log.repository'
import { db } from '../db/client'
import { usageLogs, users, tasks } from '../db/schema'
import { sql, eq, and } from 'drizzle-orm'

export const adminUsageRoutes = new Hono<{
  Variables: { user: AppJwtPayload }
}>()

adminUsageRoutes.use('*', requireAuth, requireRole('admin'))

// 单用户流水（query: type=llm|image, page, pageSize）
const logsQuerySchema = z.object({
  type: z.enum(['llm', 'image']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

// GET /admin/usage/users/:id/logs
adminUsageRoutes.get('/users/:id/logs', async (c) => {
  const parsed = logsQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '参数错误',
    )
  }
  const result = await usageLogRepository.listByUser(c.req.param('id'), {
    type: parsed.data.type,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  })
  // 时间戳转 ISO 字符串
  return ok(c, {
    ...result,
    items: result.items.map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
    })),
  })
})

// GET /admin/usage/summary — 全局聚合（V1 简版，给 admin dashboard 用）
// 返回：总调用数 / 总 token / 总报告数 / 活跃用户数
adminUsageRoutes.get('/summary', async (c) => {
  const [tokenAgg, userAgg, reportAgg] = await Promise.all([
    db
      .select({
        totalCalls: sql<number>`COUNT(*)`,
        totalTokens: sql<number>`COALESCE(SUM(${usageLogs.totalTokens}), 0)`,
        successCalls: sql<number>`COUNT(*) FILTER (WHERE ${usageLogs.success} = true)`,
        failedCalls: sql<number>`COUNT(*) FILTER (WHERE ${usageLogs.success} = false)`,
      })
      .from(usageLogs),
    db
      .select({
        totalUsers: sql<number>`COUNT(*)`,
        activeUsers: sql<number>`COUNT(*) FILTER (WHERE ${users.status} = 'active')`,
        adminUsers: sql<number>`COUNT(*) FILTER (WHERE ${users.role} = 'admin')`,
      })
      .from(users),
    db
      .select({
        totalReports: sql<number>`COUNT(*)`,
      })
      .from(tasks)
      .where(and(eq(tasks.type, 'analyze'), eq(tasks.status, 'done'))),
  ])

  return ok(c, {
    usage: {
      totalCalls: Number(tokenAgg[0]?.totalCalls ?? 0),
      totalTokens: Number(tokenAgg[0]?.totalTokens ?? 0),
      successCalls: Number(tokenAgg[0]?.successCalls ?? 0),
      failedCalls: Number(tokenAgg[0]?.failedCalls ?? 0),
    },
    users: {
      total: Number(userAgg[0]?.totalUsers ?? 0),
      active: Number(userAgg[0]?.activeUsers ?? 0),
      admins: Number(userAgg[0]?.adminUsers ?? 0),
    },
    reports: {
      total: Number(reportAgg[0]?.totalReports ?? 0),
    },
  })
})
