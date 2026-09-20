// =============================================================================
// 积分流水表
// -----------------------------------------------------------------------------
// 每次扣费/充值/退款/调整各插一条；balance_after 用于对账
//
// type 取值（业务语义）：
//   recharge   后台充值（管理端快捷档位 2000/4000/6000）
//   consume    剧本分析扣费（lockCredits 时直接写入，用户端展示为"剧本分析 -2000"）
//   refund     异常退款（任务失败/取消时退回积分）
//   deduct     人工扣减（管理端负向调整）
//   compensate 人工补偿（管理端正向调整，非快捷档位）
//   lock/unlock 历史兼容（仅读取，不再写入）
// =============================================================================

import {
  pgTable,
  uuid,
  integer,
  varchar,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'
import { users } from './users'

export const creditTxType = {
  RECHARGE: 'recharge',
  CONSUME: 'consume',
  REFUND: 'refund',
  DEDUCT: 'deduct',
  COMPENSATE: 'compensate',
  // 历史兼容：仅用于读取旧流水，不再写入
  LOCK: 'lock',
  UNLOCK: 'unlock',
} as const

export const creditTransactions = pgTable(
  'credit_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // 变化量（正=充值/退款/补偿，负=扣费/扣减）
    delta: integer('delta').notNull(),

    // 流水后余额（便于对账）
    balanceAfter: integer('balance_after').notNull(),

    // 类型：recharge / consume / refund / deduct / compensate（旧数据可能为 lock/unlock）
    type: varchar('type', { length: 32 }).notNull(),

    // 关联任务（任务扣费时填）
    refTaskId: uuid('ref_task_id'),

    // 关联规则代码（按规则扣费时填）
    refRuleCode: varchar('ref_rule_code', { length: 64 }),

    // 备注
    remark: varchar('remark', { length: 255 }),

    // 操作人（管理端调配时填 admin userId，业务扣费时为 null）
    operatedBy: uuid('operated_by').references(() => users.id, {
      onDelete: 'set null',
    }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userCreatedIdx: index('credit_tx_user_created_idx').on(
      table.userId,
      table.createdAt,
    ),
  }),
)

export type CreditTransaction = typeof creditTransactions.$inferSelect
export type NewCreditTransaction = typeof creditTransactions.$inferInsert
