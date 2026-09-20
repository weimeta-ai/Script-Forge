// =============================================================================
// 积分流水 Repository
// -----------------------------------------------------------------------------
// 提供：
//   - listByUser：用户端分页查询自己的流水
//   - listWithFilters：admin 端按 type/refTaskId 等筛选
//   - insert：写入一条流水（支持事务）
//   - existsByTaskAndType：幂等检查（防 BullMQ 重试双写）
// =============================================================================

import { eq, desc, sql, and, type SQL } from 'drizzle-orm'
import { db } from '../db/client'
import {
  creditTransactions,
  type CreditTransaction,
  type NewCreditTransaction,
} from '../db/schema'
import type { Tx } from './user.repository'

// 列表查询过滤条件
export interface ListTransactionsFilter {
  type?: string
  refTaskId?: string
  page?: number
  pageSize?: number
}

class CreditTransactionRepository {
  // 用户端：分页查自己的流水
  async listByUser(
    userId: string,
    options: { page?: number; pageSize?: number } = {},
  ): Promise<{ items: CreditTransaction[]; page: number; pageSize: number; total: number }> {
    return this.listWithFilters(userId, options)
  }

  // admin/通用：按条件筛选流水
  async listWithFilters(
    userId: string,
    filter: ListTransactionsFilter = {},
  ): Promise<{ items: CreditTransaction[]; page: number; pageSize: number; total: number }> {
    const page = Math.max(1, filter.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20))
    const offset = (page - 1) * pageSize

    const conditions: SQL[] = [eq(creditTransactions.userId, userId)]
    if (filter.type) {
      conditions.push(eq(creditTransactions.type, filter.type))
    }
    if (filter.refTaskId) {
      conditions.push(eq(creditTransactions.refTaskId, filter.refTaskId))
    }
    const where = and(...conditions)

    const [rows, totalRows] = await Promise.all([
      db
        .select()
        .from(creditTransactions)
        .where(where)
        .orderBy(desc(creditTransactions.createdAt))
        .limit(pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(creditTransactions)
        .where(where),
    ])

    return {
      items: rows,
      page,
      pageSize,
      total: Number(totalRows[0]?.count ?? 0),
    }
  }

  // 写入流水（支持事务）
  async insert(data: NewCreditTransaction, tx: Tx | typeof db = db): Promise<CreditTransaction> {
    const rows = await tx.insert(creditTransactions).values(data).returning()
    return rows[0]
  }

  // 幂等检查：同 task + 同 type 的流水是否已存在
  // 用于 worker 重试时跳过已处理的 consume/refund
  async existsByTaskAndType(taskId: string, type: string): Promise<boolean> {
    const rows = await db
      .select({ id: creditTransactions.id })
      .from(creditTransactions)
      .where(
        and(
          eq(creditTransactions.refTaskId, taskId),
          eq(creditTransactions.type, type),
        ),
      )
      .limit(1)
    return rows.length > 0
  }
}

export const creditTransactionRepository = new CreditTransactionRepository()
