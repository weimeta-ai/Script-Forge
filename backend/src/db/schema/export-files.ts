// =============================================================================
// 导出文件表 Schema（简化：删除 projectId，仅保留剧本级导出）
// -----------------------------------------------------------------------------
// 重构说明：原项目级 ZIP 导出已废弃（无项目概念），仅保留剧本级 PDF/MD 导出
// =============================================================================

import {
  pgTable,
  uuid,
  varchar,
  bigint,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { scripts } from './scripts'

// 导出格式
export const exportFormat = {
  MARKDOWN: 'markdown',
  PDF: 'pdf',
  HTML: 'html',
} as const

export const exportFiles = pgTable(
  'export_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    scriptId: uuid('script_id')
      .notNull()
      .references(() => scripts.id, { onDelete: 'cascade' }),

    format: varchar('format', { length: 16 }).notNull(),

    // MinIO 对象存储的 key
    storageKey: varchar('storage_key', { length: 512 }).notNull(),

    fileSize: bigint('file_size', { mode: 'number' }).notNull(),

    // 预签名下载 URL（带过期时间）
    downloadUrl: varchar('download_url', { length: 1024 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    scriptIdx: index('export_files_script_idx').on(table.scriptId, table.createdAt),
  })
)

export const exportFilesRelations = relations(exportFiles, ({ one }) => ({
  script: one(scripts, {
    fields: [exportFiles.scriptId],
    references: [scripts.id],
  }),
}))

export type ExportFile = typeof exportFiles.$inferSelect
export type NewExportFile = typeof exportFiles.$inferInsert
