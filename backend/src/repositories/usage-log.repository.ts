// =============================================================================
// 用法日志 Repository（每次 LLM/图片调用的流水）
// -----------------------------------------------------------------------------
// 设计要点：
//   - insert：写入流水（service 层 chatCompletion/generateImage 调用）
//   - summarizeByUser：单用户聚合（admin 详情页用）
//   - summarizeMany：批量用户聚合（admin 列表用，避免 N+1）
//   - listByUser：分页查询（admin 详情页时间线用）
// =============================================================================

import { eq, sql, and, desc, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { usageLogs, type NewUsageLog } from '../db/schema'

// 单用户聚合结果
export interface UserUsageSummary {
  totalTokens: number
  totalCalls: number
  lastActiveAt: Date | null
}

// 批量聚合结果（Map<userId, summary>）
export type UserUsageSummaryMap = Map<string, UserUsageSummary>

// 聚合函数 MAX() 在驱动层返回字符串而非 Date（Drizzle 仅对 column 引用做 mode 转换）
// 统一在此处收敛为 Date | null，保证接口契约
function toDate(value: unknown): Date | null {
  if (!value) return null
  return value instanceof Date ? value : new Date(value as string)
}

class UsageLogRepository {
  // 写入一条流水（fire-and-forget 不阻塞业务；失败仅记日志）
  async insert(data: NewUsageLog): Promise<void> {
    try {
      await db.insert(usageLogs).values(data)
    } catch (e) {
      // 不抛错：日志写入失败不应影响业务流程
      console.warn('[usage-log] insert failed:', (e as Error).message)
    }
  }

  // 单用户聚合
  async summarizeByUser(userId: string): Promise<UserUsageSummary> {
    const rows = await db
      .select({
        totalTokens: sql<number>`COALESCE(SUM(${usageLogs.totalTokens}), 0)`.as('total_tokens'),
        totalCalls: sql<number>`COUNT(*)`.as('total_calls'),
        lastActiveAt: sql<Date | null>`MAX(${usageLogs.createdAt})`.as('last_active_at'),
      })
      .from(usageLogs)
      .where(eq(usageLogs.userId, userId))
    return {
      totalTokens: Number(rows[0]?.totalTokens ?? 0),
      totalCalls: Number(rows[0]?.totalCalls ?? 0),
      lastActiveAt: toDate(rows[0]?.lastActiveAt),
    }
  }

  // 批量聚合（admin 列表用，一次 SQL 拿全部）
  async summarizeMany(userIds: string[]): Promise<UserUsageSummaryMap> {
    const map: UserUsageSummaryMap = new Map()
    if (userIds.length === 0) return map
    for (const id of userIds) {
      map.set(id, { totalTokens: 0, totalCalls: 0, lastActiveAt: null })
    }
    const rows = await db
      .select({
        userId: usageLogs.userId,
        totalTokens: sql<number>`COALESCE(SUM(${usageLogs.totalTokens}), 0)`.as('total_tokens'),
        totalCalls: sql<number>`COUNT(*)`.as('total_calls'),
        lastActiveAt: sql<Date | null>`MAX(${usageLogs.createdAt})`.as('last_active_at'),
      })
      .from(usageLogs)
      .where(inArray(usageLogs.userId, userIds))
      .groupBy(usageLogs.userId)
    for (const row of rows) {
      map.set(row.userId, {
        totalTokens: Number(row.totalTokens),
        totalCalls: Number(row.totalCalls),
        lastActiveAt: toDate(row.lastActiveAt),
      })
    }
    return map
  }

  // 单用户分页列表
  async listByUser(
    userId: string,
    options: { type?: string; page?: number; pageSize?: number } = {},
  ) {
    const page = Math.max(1, options.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20))
    const offset = (page - 1) * pageSize

    const where = options.type
      ? and(eq(usageLogs.userId, userId), eq(usageLogs.type, options.type))
      : eq(usageLogs.userId, userId)

    const [rows, totalRows] = await Promise.all([
      db
        .select()
        .from(usageLogs)
        .where(where)
        .orderBy(desc(usageLogs.createdAt))
        .limit(pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(usageLogs)
        .where(where),
    ])

    return {
      items: rows,
      page,
      pageSize,
      total: Number(totalRows[0]?.count ?? 0),
    }
  }
}

export const usageLogRepository = new UsageLogRepository()
