// =============================================================================
// 用户级 Prompt 话术配置表（每用户独立配置 + 版本历史）
// -----------------------------------------------------------------------------
// 与全局 prompt_settings 的关系：
//   - 全局表保留作「模板」：admin 在用户详情下点「复制全局」一键复制过来
//   - 业务调用强制优先本表，本表无记录则 fallback 到全局 prompt_settings
//   - 覆盖范围：report_system（报告 system）+ cover_template（封面话术）
//
// 设计要点（与 prompt_settings 镜像 + user_id 维度）：
//   - 复用全局表结构（type/version/is_current/created_by 全部一致）
//   - 单表 + is_current 标记：每个 (user_id, type) 同时只有一行 is_current=true
//   - partial unique index WHERE is_current=true：DB 层强制并发安全
//   - user_id FK + ON DELETE CASCADE：删用户时同步清理话术历史
//   - type 用 varchar + CHECK 与全局表保持一致
//
// 优先级（worker 取效链）：
//   1. 本表 user_prompt_settings WHERE user_id=? AND type=? AND is_current=true
//   2. 全局 prompt_settings WHERE type=? AND is_current=true
//   3. 内置 fallback（report_system 读 refer/system_prompt.md，cover_template 用常量）
// =============================================================================

import {
  pgTable,
  serial,
  integer,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  check,
  index,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { users } from './users'

// 合法 type 集合（与 prompt_settings 保持一致，确保全局/用户级语义统一）
export const USER_PROMPT_TYPES = ['report_system', 'cover_template'] as const
export type UserPromptType = (typeof USER_PROMPT_TYPES)[number]

export const userPromptSettings = pgTable(
  'user_prompt_settings',
  {
    id: serial('id').primaryKey(),

    // 归属用户（删用户时级联清理话术历史）
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // prompt 类型（report_system / cover_template）
    type: varchar('type', { length: 32 }).notNull(),

    // 模板原文（cover_template 含 {{title}} 等占位符；report_system 是纯 markdown）
    content: text('content').notNull(),

    // 保存备注（管理员手填）
    note: varchar('note', { length: 200 }),

    // 第几版（同 user_id + type 内单调递增）
    version: integer('version').notNull(),

    // 是否当前生效（每个 user_id + type 同时只有一行 is_current=true）
    isCurrent: boolean('is_current').notNull().default(false),

    // 创建者（admin 用户名）
    createdBy: varchar('created_by', { length: 64 }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // 每个 (user_id, type) 同时只允许一行 is_current=true
    oneCurrentPerUserType: uniqueIndex('user_prompt_settings_one_current')
      .on(t.userId, t.type)
      .where(sql`is_current = true`),
    // 按 user_id + type 查历史版本（worker 取效 + admin 列表）
    userTypeIdx: index('user_prompt_settings_user_type_idx').on(
      t.userId,
      t.type,
    ),
    // type 值白名单（与全局表保持一致）
    typeCheck: check(
      'user_prompt_settings_type_check',
      sql`type IN ('report_system', 'cover_template')`,
    ),
  }),
)

export type UserPromptSettings = typeof userPromptSettings.$inferSelect
export type NewUserPromptSettings = typeof userPromptSettings.$inferInsert
