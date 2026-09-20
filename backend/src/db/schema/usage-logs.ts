// =============================================================================
// 用法日志表（每次 LLM / 图片调用的流水）
// -----------------------------------------------------------------------------
// 用途：
//   - admin 后台展示每用户的 Token / 调用次数 / 报告数（实时聚合，无冗余字段）
//   - V2 积分扣费的依据（cost_credits 字段已就位，V1 全部写 0）
//
// 写入时机：
//   - chatCompletion 成功/失败（type=llm）
//   - generateImage 成功/失败（type=image）
//
// 设计要点：
//   - 不冗余到 users 表（零一致性维护成本）
//   - 大字段（model/errorCode）单独索引便于排查
//   - 失败也写入（success=false + errorCode），便于统计失败率
// =============================================================================

import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'
import { users } from './users'

// 调用类型
export const usageLogType = {
  LLM: 'llm',
  IMAGE: 'image',
} as const

// 阶段标识（区分一次完整任务中的不同阶段调用）
export const usageLogPhase = {
  ANALYZE: 'analyze',
  COVER: 'cover',
  TEST: 'test',
} as const

export const usageLogs = pgTable(
  'usage_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 归属用户
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // 关联任务（nullable：测试连接也算调用，但无 task）
    taskId: uuid('task_id'),

    // 关联剧本（便于按剧本筛）
    scriptId: uuid('script_id'),

    // 类型：llm / image
    type: varchar('type', { length: 16 }).notNull(),

    // 阶段：analyze / cover / test
    phase: varchar('phase', { length: 32 }).notNull(),

    // 实际调用的模型名（如 claude-sonnet-4-5 / dall-e-3）
    model: varchar('model', { length: 128 }),

    // LLM token 消耗（图片调用留空）
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    totalTokens: integer('total_tokens'),

    // 图片生成张数（LLM 调用留空）
    imageCount: integer('image_count'),

    // 调用耗时毫秒
    latencyMs: integer('latency_ms').notNull(),

    // 积分消耗（V1 写 0；V2 由扣费服务计算后回填）
    costCredits: integer('cost_credits').notNull().default(0),

    // 是否成功
    success: boolean('success').notNull().default(true),

    // 失败时的错误码（BusinessError.code）
    errorCode: varchar('error_code', { length: 64 }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // admin 用户列表 + 单用户时间线查询
    userCreatedIdx: index('usage_logs_user_created_idx').on(
      table.userId,
      table.createdAt,
    ),
    // 按任务查关联日志
    taskIdx: index('usage_logs_task_idx').on(table.taskId),
    // 全局趋势（admin dashboard）
    typeCreatedIdx: index('usage_logs_type_created_idx').on(
      table.type,
      table.createdAt,
    ),
  }),
)

export type UsageLog = typeof usageLogs.$inferSelect
export type NewUsageLog = typeof usageLogs.$inferInsert
