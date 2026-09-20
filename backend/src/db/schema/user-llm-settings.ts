// =============================================================================
// 用户级 LLM 配置表（每用户独立配置）
// -----------------------------------------------------------------------------
// 与全局 llm_settings 的关系：
//   - 全局表保留作「模板」：admin 创建用户时一键复制过来
//   - 业务调用强制走本表（chatCompletion / runAnalysis），未配置则抛 USER_LLM_NOT_CONFIGURED
//
// 设计要点：
//   - 每用户仅 1 条记录（user_id UNIQUE）
//   - 字段镜像 llm_settings（去掉 singleton 约束）
//   - apiKey 出参脱敏（复用 maskApiKey）
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

export const userLlmSettings = pgTable(
  'user_llm_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 归属用户（每用户仅 1 条，UNIQUE 约束）
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // 配置名称（便于识别）
    name: varchar('name', { length: 64 }).notNull().default('default'),

    // API Key（敏感字段，repository 出参脱敏）
    apiKey: varchar('api_key', { length: 512 }).notNull(),

    // 模型名
    model: varchar('model', { length: 128 }).notNull(),

    // OpenAI 兼容接口地址
    baseUrl: varchar('base_url', { length: 512 }).notNull(),

    // 调用超时（毫秒）
    timeoutMs: integer('timeout_ms').notNull().default(90000),

    // 默认分析模式（standard / fast / ultra）
    defaultAnalyzeMode: varchar('default_analyze_mode', { length: 20 })
      .notNull()
      .default('standard'),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // 每用户仅 1 条
    userUniqueIdx: uniqueIndex('user_llm_settings_user_idx').on(table.userId),
  }),
)

export type UserLlmSettings = typeof userLlmSettings.$inferSelect
export type NewUserLlmSettings = typeof userLlmSettings.$inferInsert
