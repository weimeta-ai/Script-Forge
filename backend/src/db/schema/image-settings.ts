// =============================================================================
// 图片模型配置表（封面生成用）
// -----------------------------------------------------------------------------
// 用途：让前端 admin 动态配置图片生成模型（DALL·E / SD-XL / Flux 等），
//       不重启后端即可切换网关。
//
// 设计要点（与 llm-settings 一致）：
//   - 单行表（singleton）：CHECK id = 1，全局唯一配置
//   - 字段全部 NOT NULL（UPSERT 时强制提供完整值）
//   - apiKey 敏感字段，repository 出参脱敏
//   - apiFormat 不入库：前端硬编码 "openai-image"（本期写死）
//   - 额外字段 defaultSize / defaultCount：图片默认尺寸与张数
// =============================================================================

import {
  pgTable,
  integer,
  varchar,
  timestamp,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const imageSettings = pgTable(
  'image_settings',
  {
    // 固定 id = 1（singleton 模式）
    id: integer('id').primaryKey().default(1),

    // 配置名称（便于人工识别，如 "dalle-prod" / "sd-local"）
    name: varchar('name', { length: 64 }).notNull().default('default'),

    // API Key（敏感字段，repository 出参时脱敏）
    apiKey: varchar('api_key', { length: 512 }).notNull(),

    // 图片模型名（如 dall-e-3 / sd-xl / flux-pro）
    model: varchar('model', { length: 128 }).notNull(),

    // OpenAI 兼容图片接口地址（如 https://api.openai.com/v1）
    baseUrl: varchar('base_url', { length: 512 }).notNull(),

    // 调用超时（毫秒）
    timeoutMs: integer('timeout_ms').notNull().default(120000),

    // 默认尺寸（如 1024x1024 / 1024x1792 / 1792x1024）
    defaultSize: varchar('default_size', { length: 32 }).notNull().default('1024x1024'),

    // 默认生成张数（1-4）
    defaultCount: integer('default_count').notNull().default(1),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (_table) => ({
    // 强制单行：CHECK id = 1
    singletonCheck: check('image_settings_singleton_check', sql`id = 1`),
  }),
)

export type ImageSettings = typeof imageSettings.$inferSelect
export type NewImageSettings = typeof imageSettings.$inferInsert
