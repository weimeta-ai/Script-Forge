// =============================================================================
// Prompt 话术配置表（管理员可编辑 + 版本历史）
// -----------------------------------------------------------------------------
// 用途：让 admin 在不重启后端的前提下，动态编辑两类 prompt：
//   - report_system   报告 system prompt（对应原 refer/system_prompt.md）
//   - cover_template  封面图片话术模板（含 {{title}}/{{genre}}/{{excerpt_block}} 占位符）
//
// 设计要点（KISS + 单表 + 软版本）：
//   - 单表方案：每个历史版本一行，is_current 标记当前生效行
//   - 不用 主表+版本表：2 类 prompt 小体量下双表 JOIN / 回滚事务维护成本更高
//   - type 用 varchar + CHECK 而非 pgEnum：未来扩类型只需改 CHECK，无需独立迁移
//   - partial unique index WHERE is_current = true：DB 层强制每个 type 只有 1 行 current
//   - content 用 text 不限长：当前最大 ~11KB，无性能问题
//   - version 整数：同 type 内 MAX(version)+1，便于 UI 显示 v1/v2
//
// 回滚语义：读旧版本 content → 作为新版本插入 → 切 is_current（事务内）
// =============================================================================

import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// 合法 type 集合（与 CHECK 约束保持一致）
export const PROMPT_TYPES = ['report_system', 'cover_template'] as const
export type PromptType = (typeof PROMPT_TYPES)[number]

export const promptSettings = pgTable(
  'prompt_settings',
  {
    id: serial('id').primaryKey(),

    // prompt 类型（report_system / cover_template）
    type: varchar('type', { length: 32 }).notNull(),

    // 模板原文（cover_template 含 {{title}} 等占位符；report_system 是纯 markdown）
    content: text('content').notNull(),

    // 保存备注（管理员手填，如 "加了爆款案例"）
    note: varchar('note', { length: 200 }),

    // 第几版（同 type 内单调递增，便于人读）
    version: integer('version').notNull(),

    // 是否当前生效（每个 type 同时只有一行 is_current=true）
    isCurrent: boolean('is_current').notNull().default(false),

    // 创建者（admin 用户名，从 auth context 取）
    createdBy: varchar('created_by', { length: 64 }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // 每个 type 同时只允许一行 is_current=true（DB 层防并发写入冲突）
    oneCurrentPerType: uniqueIndex('prompt_settings_one_current')
      .on(t.type)
      .where(sql`is_current = true`),
    // type 值白名单
    typeCheck: check(
      'prompt_settings_type_check',
      sql`type IN ('report_system', 'cover_template')`,
    ),
  }),
)

export type PromptSettings = typeof promptSettings.$inferSelect
export type NewPromptSettings = typeof promptSettings.$inferInsert
