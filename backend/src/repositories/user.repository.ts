// =============================================================================
// 用户 Repository
// -----------------------------------------------------------------------------
// 继承 BaseRepository，加用户特有查询
// =============================================================================

import { eq, ilike, and, sql, desc } from 'drizzle-orm'
import { db, type Database } from '../db/client'
import {
  users,
  usageLogs,
  scripts,
  tasks,
  type User,
  type NewUser,
} from '../db/schema'
import { BaseRepository } from './base.repository'

// 事务参数类型（drizzle db.transaction 回调的 tx 参数）
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

// admin 列表查询返回的精简类型（不带 passwordHash，附统计聚合）
export type UserListItem = Omit<User, 'passwordHash'> & {
  totalTokens: number
  totalCalls: number
  lastActiveAt: Date | null
  reportCount: number
}

// admin 列表查询过滤条件
export interface ListUsersFilter {
  keyword?: string
  status?: 'active' | 'disabled'
  role?: 'admin' | 'user'
  page?: number
  pageSize?: number
}

class UserRepository extends BaseRepository<User> {
  protected table = users

  // 按用户名查询（登录用，含 passwordHash）
  async findByUsername(username: string): Promise<User | null> {
    const rows = await db.select().from(users).where(eq(users.username, username)).limit(1)
    return rows[0] ?? null
  }

  // 创建用户
  async create(data: NewUser): Promise<User> {
    const rows = await db.insert(users).values(data).returning()
    return rows[0]
  }

  // 更新用户（displayName / role / status / passwordHash 等）
  async update(id: string, data: Partial<NewUser>): Promise<User | null> {
    const rows = await db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning()
    return rows[0] ?? null
  }

  // 原子增减积分余额（积分扣费/充值专用，避免读改写竞争）
  // tx 可选：传入则在该事务内执行（用于 lock/consume/refund 原子操作）
  async incrementBalance(userId: string, delta: number, tx: Tx | typeof db = db): Promise<User | null> {
    const rows = await tx
      .update(users)
      .set({ creditBalance: sql`${users.creditBalance} + ${delta}`, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning()
    return rows[0] ?? null
  }

  // 原子增减锁定积分（锁定/解锁专用）
  async incrementLocked(userId: string, delta: number, tx: Tx | typeof db = db): Promise<User | null> {
    const rows = await tx
      .update(users)
      .set({ creditLocked: sql`${users.creditLocked} + ${delta}`, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning()
    return rows[0] ?? null
  }

  // 列表 + 统计聚合（参考 script.repository 的子查询写法，避免 N+1）
  async listWithStats(filter: ListUsersFilter = {}): Promise<{
    items: UserListItem[]
    page: number
    pageSize: number
    total: number
  }> {
    const page = Math.max(1, filter.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20))
    const offset = (page - 1) * pageSize

    // 构建 where
    const conditions = []
    if (filter.keyword) {
      const kw = `%${filter.keyword}%`
      conditions.push(
        sql`(${ilike(users.username, kw)} OR ${ilike(users.displayName, kw)})`,
      )
    }
    if (filter.status) {
      conditions.push(eq(users.status, filter.status))
    }
    if (filter.role) {
      conditions.push(eq(users.role, filter.role))
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const baseQuery = db.select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      status: users.status,
      creditBalance: users.creditBalance,
      creditLocked: users.creditLocked,
      preferences: users.preferences,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      // 累计 token（usage_logs 聚合）
      // 注意：drizzle sql 模板嵌入 column 时仅展开列名（不带表前缀），
      // 在 JOIN 多表的相关子查询中会触发 "column reference id is ambiguous"
      // 这里用字面量 "users"."id" 显式声明外层表引用，规避歧义
      totalTokens:
        sql<number>`COALESCE((SELECT SUM(u.total_tokens) FROM ${usageLogs} u WHERE u.user_id = "users"."id"), 0)`.as('total_tokens'),
      // 累计调用次数（usage_logs 聚合）
      totalCalls:
        sql<number>`COALESCE((SELECT COUNT(*) FROM ${usageLogs} u WHERE u.user_id = "users"."id"), 0)`.as('total_calls'),
      // 最近活跃时间（最后一次 usage_log 时间）
      lastActiveAt:
        sql<Date | null>`(SELECT MAX(u.created_at) FROM ${usageLogs} u WHERE u.user_id = "users"."id")`.as('last_active_at'),
      // 报告数（tasks: type=analyze AND status=done，关联该用户的 scripts）
      // 子查询 JOIN tasks + scripts 都有 id 列，外层引用必须用完整 "users"."id"
      reportCount:
        sql<number>`COALESCE((SELECT COUNT(*) FROM ${tasks} t JOIN ${scripts} s ON s.id = t.script_id WHERE s.user_id = "users"."id" AND t.type = 'analyze' AND t.status = 'done'), 0)`.as('report_count'),
    }).from(users)

    // 并行：分页数据 + 总数
    const [rows, totalRows] = await Promise.all([
      where
        ? baseQuery.where(where).orderBy(desc(users.createdAt)).limit(pageSize).offset(offset)
        : baseQuery.orderBy(desc(users.createdAt)).limit(pageSize).offset(offset),
      where
        ? db.select({ count: sql<number>`COUNT(*)` }).from(users).where(where)
        : db.select({ count: sql<number>`COUNT(*)` }).from(users),
    ])

    return {
      items: rows as UserListItem[],
      page,
      pageSize,
      total: Number(totalRows[0]?.count ?? 0),
    }
  }
}

// 单例导出（全应用共享一个实例）
export const userRepository = new UserRepository()
