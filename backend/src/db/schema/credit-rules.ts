// =============================================================================
// 积分规则表（V2 预留）
// -----------------------------------------------------------------------------
// V1：仅建表 + 提供 admin CRUD 接口（暂不接入业务）
// V2：扣费服务根据规则 code 查 credits_per_unit + unit_type 计算扣费
//
// 规则示例：
//   code='analyze.standard'   credits_per_unit=10  unit_type=per_call
//   code='image.dalle3.1024'  credits_per_unit=5   unit_type=per_image
//   code='llm.claude.sonnet'  credits_per_unit=1   unit_type=per_1k_tokens
// =============================================================================

import {
  pgTable,
  uuid,
  integer,
  varchar,
  text,
  boolean,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

// 单位类型
export const creditUnitType = {
  PER_CALL: 'per_call',
  PER_1K_TOKENS: 'per_1k_tokens',
  PER_IMAGE: 'per_image',
} as const

export const creditRules = pgTable(
  'credit_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 规则代码（全局唯一，业务层按 code 匹配）
    code: varchar('code', { length: 64 }).notNull().unique(),

    // 中文展示名（admin UI 显示用）
    name: varchar('name', { length: 128 }).notNull(),

    // 用途说明（admin 自填，展示在规则卡片上；为空时前端 fallback 到内置文案）
    description: text('description'),

    // 单次/单位消耗的积分
    creditsPerUnit: integer('credits_per_unit').notNull().default(0),

    // 单位类型（per_call / per_1k_tokens / per_image）
    unitType: varchar('unit_type', { length: 16 }).notNull().default('per_call'),

    // 是否启用
    enabled: boolean('enabled').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    codeUniqueIdx: uniqueIndex('credit_rules_code_idx').on(table.code),
  }),
)

export type CreditRule = typeof creditRules.$inferSelect
export type NewCreditRule = typeof creditRules.$inferInsert
