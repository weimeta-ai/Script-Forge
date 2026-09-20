// =============================================================================
// LLM 运行时配置表（运维调试页用）
// -----------------------------------------------------------------------------
// 用途：让前端 admin 在不重启后端的前提下，动态切换 LLM 网关（OpenAI 兼容网关 / newapi / Anthropic 直连）
//
// 设计要点（KISS + YAGNI）：
//   - 单行表（singleton）：CHECK id = 1，全局唯一配置
//   - 字段全部 NOT NULL（UPSERT 时强制提供完整值，避免半残状态）
//   - apiKey 是敏感字段，repository 出参脱敏（返回 masked 字符串）
//   - apiFormat：admin 可选 'openai'（OpenAI 兼容 /chat/completions）或
//     'anthropic'（Anthropic 原生 /v1/messages），默认 'openai'
//   - 无 userId 关联：当前定位「单租户全局唯一」
// =============================================================================

import {
  pgTable,
  integer,
  varchar,
  timestamp,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const llmSettings = pgTable(
  'llm_settings',
  {
    // 固定 id = 1（singleton 模式）
    // 应用层 UPSERT 时 WHERE id = 1，保证全局唯一
    id: integer('id').primaryKey().default(1),

    // 配置名称（便于人工识别，如 "newapi-test" / "anthropic-prod"）
    name: varchar('name', { length: 64 }).notNull().default('default'),

    // API Key（敏感字段，repository 出参时脱敏）
    apiKey: varchar('api_key', { length: 512 }).notNull(),

    // 模型名（如 gpt-4 / claude-sonnet-4-5 / claude-opus-4）
    model: varchar('model', { length: 128 }).notNull(),

    // 服务地址：
    //   openai 格式 → OpenAI 兼容接口（如 https://your-gateway.example.com/v1）
    //   anthropic 格式 → Anthropic 原生接口（如 https://api.anthropic.com，不带 /v1）
    baseUrl: varchar('base_url', { length: 512 }).notNull(),

    // API 协议格式（openai: /v1/chat/completions | anthropic: /v1/messages）
    // 默认 'openai'（绝大多数网关兼容 OpenAI 协议）
    apiFormat: varchar('api_format', { length: 20 }).notNull().default('openai'),

    // 调用超时（毫秒）
    timeoutMs: integer('timeout_ms').notNull().default(90000),

    // 默认分析模式（standard / fast / ultra）；前端未显式指定时使用此值
    defaultAnalyzeMode: varchar('default_analyze_mode', { length: 20 })
      .notNull()
      .default('standard'),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // extras 用 callback 形式，参数 table 必须保留（drizzle API 约束）
  // 这里 CHECK 约束用 sql 字符串（不引用 table），table 参数加下划线表示未使用
  (_table) => ({
    // 强制单行：CHECK id = 1
    singletonCheck: check('llm_settings_singleton_check', sql`id = 1`),
  }),
)

export type LlmSettings = typeof llmSettings.$inferSelect
export type NewLlmSettings = typeof llmSettings.$inferInsert
