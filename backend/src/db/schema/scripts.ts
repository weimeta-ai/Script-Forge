// =============================================================================
// 剧本表 Schema（p00 同款：剧本直挂用户，无项目概念）
// -----------------------------------------------------------------------------
// 重构说明：删除原 projectId 关联，改为直接挂在 users 下
// 删除 5 阶段流水线字段（currentStage/stageStatus/sortOrder），改为事件流（存 tasks.events）
// =============================================================================

import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { users } from './users'

// 剧本状态（保留软删概念）
export const scriptStatus = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
  DELETED: 'deleted',
} as const

// 剧本表
export const scripts = pgTable(
  'scripts',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 直接挂在用户下（p00 同款）
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    title: varchar('title', { length: 255 }).notNull(),
    genre: varchar('genre', { length: 64 }),

    // 原始文件名（p00 同款，用于历史列表展示）
    fileName: varchar('file_name', { length: 255 }),

    // 原文内容（必填，至少 50 字，校验在 service 层做）
    sourceContent: text('source_content').notNull(),

    wordCount: integer('word_count').notNull().default(0),

    status: varchar('status', { length: 16 }).notNull().default('active'),

    // 封面图 URL（可选，无值时前端用默认图兜底）
    // 注：实际存的是 OSS object key，由 routes 层动态签名返回
    coverUrl: varchar('cover_url', { length: 512 }),

    // 封面候选 OSS object key 数组（一次生成 3 张供用户挑选，未选定前 coverUrl 为 null）
    // 选定后 coverUrl 写入对应 key，本字段保留以便用户切换候选
    coverUrlCandidates: jsonb('cover_url_candidates').$type<string[] | null>(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // 主查询：列出某用户的所有剧本（历史页用）
    userStatusIdx: index('scripts_user_status_idx').on(
      table.userId,
      table.status,
      table.createdAt
    ),
  })
)

export const scriptsRelations = relations(scripts, ({ one }) => ({
  user: one(users, {
    fields: [scripts.userId],
    references: [users.id],
  }),
}))

export type Script = typeof scripts.$inferSelect
export type NewScript = typeof scripts.$inferInsert
