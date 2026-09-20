// =============================================================================
// 异步任务表 Schema（p00 同款：节点级事件流）
// -----------------------------------------------------------------------------
// 重构说明：
//   - 状态机简化为 pending → running → done | error
//   - 删除 currentStep/totalSteps（不再有 12 步流水线概念）
//   - stepsLog 重命名为 events，结构对齐 p00 TaskEvent
//   - 新增 reportId（指向 scriptVersions.id）
// =============================================================================

import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { scripts } from './scripts'
import { scriptVersions } from './script-versions'

// 任务状态（简化为 p00 同款 + canceling/canceled 支持用户主动停止）
export const taskStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  DONE: 'done',
  ERROR: 'error',
  CANCELING: 'canceling', // 用户请求停止（中间态，等 worker 退出）
  CANCELED: 'canceled', // worker 已退出（终态）
} as const

// 任务事件类型（对齐 p00 TaskEvent）
export type TaskEvent = {
  type:
    | 'node_start'
    | 'node_progress'
    | 'node_done'
    | 'node_error'
    | 'task_done'
    | 'task_error'
    | 'task_canceled'
    | 'log'
    // 封面生成事件（独立 cover worker，事件携带最终 OSS coverUrl）
    | 'cover_start'
    | 'cover_done'
    | 'cover_error'
  nodeId?: string
  nodeName?: string
  percent?: number
  message?: string
  summary?: string
  reportId?: string
  // 封面生成最终 URL（仅 cover_done 事件携带；前端据此渲染 <img>）
  // coverUrl: 单图改造前的旧字段，保留兼容（历史事件）
  // coverUrls: 一次生成 3 张候选的 object key 数组（前端需逐个签名渲染）
  coverUrl?: string
  coverUrls?: string[]
  ts: number
}

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    scriptId: uuid('script_id')
      .notNull()
      .references(() => scripts.id, { onDelete: 'cascade' }),

    // 任务类型（analyze / cover；varchar 16 已可塞任意字符串）
    type: varchar('type', { length: 16 }).notNull().default('analyze'),

    // 分析模式（standard 串行 8 节点 / fast 并行 8 节点 / ultra 单次合并）
    // 仅 type='analyze' 时有意义；其他 type 默认 standard
    mode: varchar('mode', { length: 20 }).notNull().default('standard'),

    // 任务状态
    status: varchar('status', { length: 16 }).notNull().default('pending'),

    // 节点级事件流（对齐 p00 TaskEvent[]，前端轮询读取）
    events: jsonb('events').notNull().default([]).$type<TaskEvent[]>(),

    // 成功后的报告引用（指向 script_versions.id）
    reportId: uuid('report_id').references(() => scriptVersions.id, {
      onDelete: 'set null',
    }),

    // 失败原因
    errorMessage: text('error_message'),

    // 锁定积分（triggerXxx 时预扣，便于 task 维度对账）
    creditsLocked: integer('credits_locked').notNull().default(0),

    // 实际消耗积分（worker 成功时回填，等于 lockedAmount；失败/取消则保持 0）
    creditsCharged: integer('credits_charged').notNull().default(0),

    // 是否已退款（worker 失败/取消时 refundCredits 置 true，前端用于展示"已退回"提示）
    creditsRefunded: boolean('credits_refunded').notNull().default(false),

    // 时间记录
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // 查询某剧本的活跃任务（轮询主路径）
    scriptActiveIdx: index('tasks_script_active_idx').on(table.scriptId, table.status),
    // worker 扫描待处理任务
    statusCreatedIdx: index('tasks_status_created_idx').on(table.status, table.createdAt),
  })
)

export const tasksRelations = relations(tasks, ({ one }) => ({
  script: one(scripts, {
    fields: [tasks.scriptId],
    references: [scripts.id],
  }),
  report: one(scriptVersions, {
    fields: [tasks.reportId],
    references: [scriptVersions.id],
  }),
}))

export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
