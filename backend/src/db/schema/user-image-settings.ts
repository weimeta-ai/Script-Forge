// =============================================================================
// 用户级图片模型配置表（每用户独立配置）
// -----------------------------------------------------------------------------
// 与全局 image_settings 的关系：同 user-llm-settings（保留模板 + 强制 per-user）
// =============================================================================

import {
  pgTable,
  uuid,
  integer,
  varchar,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { users } from './users'

export const userImageSettings = pgTable(
  'user_image_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    name: varchar('name', { length: 64 }).notNull().default('default'),

    apiKey: varchar('api_key', { length: 512 }).notNull(),

    model: varchar('model', { length: 128 }).notNull(),

    baseUrl: varchar('base_url', { length: 512 }).notNull(),

    timeoutMs: integer('timeout_ms').notNull().default(120000),

    defaultSize: varchar('default_size', { length: 32 }).notNull().default('1024x1024'),

    defaultCount: integer('default_count').notNull().default(1),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userUniqueIdx: uniqueIndex('user_image_settings_user_idx').on(table.userId),
  }),
)

export type UserImageSettings = typeof userImageSettings.$inferSelect
export type NewUserImageSettings = typeof userImageSettings.$inferInsert
