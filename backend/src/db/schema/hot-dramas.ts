// =============================================================================
// 爆款库表 Schema（只读参考表）
// -----------------------------------------------------------------------------
// 平台热门短剧参考数据，作为新剧本创作灵感来源
// 不与业务表强关联，独立维护
// =============================================================================

import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'

export const hotDramas = pgTable(
  'hot_dramas',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    title: varchar('title', { length: 255 }).notNull(),
    genre: varchar('genre', { length: 64 }),
    platform: varchar('platform', { length: 64 }),

    // 数据指标（播放/完播/转化等）
    // 结构：{ "plays": "1.2亿", "completionRate": "78%", "topics": ["战神归来"] }
    metrics: jsonb('metrics'),

    // 数据同步时间（外部数据源定期同步）
    syncedAt: timestamp('synced_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // 按题材筛选
    genreIdx: index('hot_dramas_genre_idx').on(table.genre),
    // 按平台筛选
    platformIdx: index('hot_dramas_platform_idx').on(table.platform),
  })
)

export type HotDrama = typeof hotDramas.$inferSelect
export type NewHotDrama = typeof hotDramas.$inferInsert
