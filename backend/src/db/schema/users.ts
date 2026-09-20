// =============================================================================
// 用户表 Schema（p00 同款简化 + 用户管理扩展）
// -----------------------------------------------------------------------------
// 重构说明：
//   - 删除 hasProject 字段（无项目概念后不再需要）
//   - 新增 status / credit_balance / credit_locked（用户管理 + 积分系统预留）
//   - 统计字段（tokens/calls/reportCount/lastActiveAt）不冗余，走 usage_logs 实时聚合
// =============================================================================

import { pgTable, uuid, varchar, timestamp, integer, jsonb, index } from 'drizzle-orm/pg-core'

// 用户角色枚举
// pgEnum 会在 PG 里创建一个真实的 enum 类型
// 注意：enum 类型一旦创建，新增值容易，删除/重命名值难（要 drop & recreate）
export const userRoleEnum = {
  ADMIN: 'admin',
  USER: 'user',
} as const

// 用户状态枚举
export const userStatusEnum = {
  ACTIVE: 'active',
  DISABLED: 'disabled',
} as const

// 用户表
export const users = pgTable(
  'users',
  {
    // 主键：UUID（前端拿到后用作 URL 参数，比自增 ID 安全）
    id: uuid('id').primaryKey().defaultRandom(),

    // 登录账号（唯一）
    username: varchar('username', { length: 64 }).notNull().unique(),

    // 密码哈希（bcrypt，绝不存明文）
    // 字段名 password_hash 而非 password，提醒开发者"这不是明文"
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),

    // 显示名（界面展示用）
    displayName: varchar('display_name', { length: 64 }),

    // 角色：admin 可管理用户；user 普通用户
    role: varchar('role', { length: 16 }).notNull().default('user'),

    // 状态：active 启用；disabled 禁用（admin 软禁用，禁止登录）
    status: varchar('status', { length: 16 }).notNull().default('active'),

    // 积分余额（V2 启用，V1 默认 0 不参与计费）
    creditBalance: integer('credit_balance').notNull().default(0),

    // 锁定积分（任务进行中预扣，V2 启用）
    creditLocked: integer('credit_locked').notNull().default(0),

    // 用户偏好（暗黑模式、字号等，前端设置页用）
    preferences: jsonb('preferences').notNull().default({
      theme: 'light',
      fontSize: 'medium',
    }),

    // 标准时间字段
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // 按创建时间倒序索引（用户列表查询用）
    createdIdx: index('users_created_at_idx').on(table.createdAt),
    // 按状态筛选索引（admin 列表筛启用/禁用）
    statusIdx: index('users_status_idx').on(table.status),
  })
)

// -----------------------------------------------------------------------------
// TypeScript 类型导出
// InferSelectModel  = 从 schema 推导"查询返回"的类型
// InferInsertModel  = 从 schema 推导"插入数据"的类型（id/createdAt 等可省略）
// -----------------------------------------------------------------------------
export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
