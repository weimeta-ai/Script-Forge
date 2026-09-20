// =============================================================================
// 剧本版本表 Schema（p00 同款简化）
// -----------------------------------------------------------------------------
// 重构说明：原 5 阶段流水线下 V1/V2 对比已废弃
// 当前结构：一个剧本只有一个版本（versionNo 始终为 1），存分析后的报告 markdown
// scoreDetails 简化为 { report, score?, grade?, durationMs? }，对齐 p00 报告结构
// =============================================================================

import {
  pgTable,
  uuid,
  integer,
  text,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { scripts } from './scripts'

// 报告 scoreDetails 结构（对齐 p00 Report 类型）
// {
//   report: string         // 完整 markdown 报告
//   score?: number         // 总体评分 0-100（从 markdown 反向抽取）
//   grade?: string         // 评级 S/A+/A/B/C/D
//   durationMs?: number    // 分析耗时毫秒
//   title?: string         // 报告标题（从 markdown 抽取）
// }
export type ScoreDetails = {
  report: string
  score?: number
  grade?: string
  durationMs?: number
  title?: string
}

export const scriptVersions = pgTable(
  'script_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    scriptId: uuid('script_id')
      .notNull()
      .references(() => scripts.id, { onDelete: 'cascade' }),

    // 版本号：始终为 1（保留字段为未来扩展位，YAGNI 原则不预先实现多版本）
    versionNo: integer('version_no').notNull().default(1),

    // 该版本的完整正文（与 scripts.sourceContent 一致，p00 同款冗余存储）
    content: text('content').notNull(),

    // 报告 scoreDetails（p00 同款简化结构）
    scoreDetails: jsonb('score_details').$type<ScoreDetails>(),

    // 是否为当前生效版本
    isCurrent: boolean('is_current').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    scriptVersionIdx: uniqueIndex('script_versions_script_version_idx').on(
      table.scriptId,
      table.versionNo
    ),
    scriptIdx: index('script_versions_script_idx').on(table.scriptId),
  })
)

export const scriptVersionsRelations = relations(scriptVersions, ({ one }) => ({
  script: one(scripts, {
    fields: [scriptVersions.scriptId],
    references: [scripts.id],
  }),
}))

export type ScriptVersion = typeof scriptVersions.$inferSelect
export type NewScriptVersion = typeof scriptVersions.$inferInsert
