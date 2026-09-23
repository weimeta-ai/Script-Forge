// =============================================================================
// 积分业务服务层（V1 完整闭环）
// -----------------------------------------------------------------------------
// 职责：
//   - lockCredits：triggerXxx 时锁定积分（事务内 update 余额+锁定+写流水+更新 task）
//   - consumeCredits：worker 成功时实扣（幂等：task.creditsCharged>0 则跳过；不再写流水）
//   - refundCredits：worker 失败/用户取消时退款（幂等：已存在 refund 流水则跳过）
//   - adjustCredits：admin 手动调整（充值/补偿/扣减，按 category 写不同 type 流水）
//   - getUserBalance / listUserTransactions：查询
//   - resolveRuleCode：taskType+mode → ruleCode 映射
//
// 设计要点：
//   - V1 仅支持 per_call 规则（按次固定扣费，不按 token/图片数）
//   - 所有金额变更加 SELECT FOR UPDATE 行锁，防并发超额
//   - consume/refund 幂等，安全应对 BullMQ 重试
//   - 所有变更必须写 credit_transactions 流水（审计 100% 覆盖）
// =============================================================================

import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { users, tasks, scripts } from '../db/schema'
import { creditTxType } from '../db/schema/credit-transactions'
import { creditRuleRepository } from '../repositories/credit-rule.repository'
import { creditTransactionRepository } from '../repositories/credit-transaction.repository'
import { userRepository } from '../repositories/user.repository'
import { badRequest, conflict, notFound } from '../lib/errors'
import { logger } from '../logger/index'

// -----------------------------------------------------------------------------
// 类型
// -----------------------------------------------------------------------------
export type CreditRuleCode =
  | 'analyze.standard'
  | 'analyze.fast'
  | 'analyze.ultra'
  | 'cover.default'

export type TaskType = 'analyze' | 'cover'

export interface ListTransactionsOptions {
  type?: string
  refTaskId?: string
  page?: number
  pageSize?: number
}

export interface PagedTransactions {
  items: Array<{
    id: string
    userId: string
    delta: number
    balanceAfter: number
    type: string
    refTaskId: string | null
    refRuleCode: string | null
    remark: string | null
    operatedBy: string | null
    createdAt: string
  }>
  page: number
  pageSize: number
  total: number
}

// -----------------------------------------------------------------------------
// 规则 code 解析（taskType + mode → ruleCode）
// -----------------------------------------------------------------------------
export function resolveRuleCode(taskType: TaskType, _mode?: string): CreditRuleCode {
  switch (taskType) {
    case 'analyze':
      // 展会场景：统一 analyze.standard（忽略 fast/ultra，保留路径不删）
      return 'analyze.standard'
    case 'cover':
      return 'cover.default'
  }
}

// -----------------------------------------------------------------------------
// lockCredits：锁定积分（triggerXxx 调用）
// -----------------------------------------------------------------------------
// 流程（db.transaction 内）：
//   1. 幂等检查：task.creditsLocked > 0 则直接返回（防 BullMQ 重试双锁）
//   2. SELECT user FOR UPDATE
//   3. 查规则（cached）→ 必须存在 + enabled + unitType='per_call'
//   4. 余额检查 → 不足抛 conflict('INSUFFICIENT_CREDITS')
//   5. user.creditBalance -= cost, user.creditLocked += cost
//   6. 写 type='consume' 流水（delta=-cost，用户端直接展示"剧本分析 -2000"）
//   7. task.creditsLocked = cost
// -----------------------------------------------------------------------------
export async function lockCredits(input: {
  userId: string
  taskId: string
  ruleCode: CreditRuleCode
}): Promise<{ lockedAmount: number; balanceAfter: number }> {
  const { userId, taskId, ruleCode } = input

  return await db.transaction(async (tx) => {
    // 1. 幂等：task 已锁定则不重复锁
    const taskRow = await tx.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
    if (!taskRow[0]) {
      throw notFound('任务')
    }
    if (taskRow[0].creditsLocked > 0) {
      return { lockedAmount: taskRow[0].creditsLocked, balanceAfter: 0 }
    }

    // 2. 查规则
    const rule = await creditRuleRepository.findByCodeCached(ruleCode)
    if (!rule) {
      throw badRequest(
        'CREDIT_RULE_NOT_FOUND',
        `积分规则未配置：${ruleCode}，请联系管理员`,
      )
    }
    if (!rule.enabled) {
      throw badRequest('CREDIT_RULE_DISABLED', `积分规则已禁用：${ruleCode}`)
    }
    if (rule.unitType !== 'per_call') {
      throw badRequest(
        'CREDIT_RULE_UNSUPPORTED_V1',
        `V1 仅支持 per_call 规则，${ruleCode} 类型为 ${rule.unitType}`,
      )
    }
    const cost = rule.creditsPerUnit

    // 3. SELECT user FOR UPDATE（防并发超额）
    const userRows = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .for('update')
      .limit(1)
    if (!userRows[0]) {
      throw notFound('用户')
    }
    const user = userRows[0]
    if (user.creditBalance < cost) {
      throw conflict(
        'INSUFFICIENT_CREDITS',
        `积分余额不足：需要 ${cost}，当前 ${user.creditBalance}`,
      )
    }

    // 4. 余额转移：creditBalance -= cost, creditLocked += cost
    const newBalance = user.creditBalance - cost
    await tx
      .update(users)
      .set({
        creditBalance: sql`${users.creditBalance} - ${cost}`,
        creditLocked: sql`${users.creditLocked} + ${cost}`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))

    // 5. 写 consume 流水（用户端直接展示为"剧本分析 -2000"，无需等 worker 完成）
    await creditTransactionRepository.insert(
      {
        userId,
        delta: -cost,
        balanceAfter: newBalance,
        type: creditTxType.CONSUME,
        refTaskId: taskId,
        refRuleCode: ruleCode,
        remark: `剧本分析（${rule.name}）`,
      },
      tx,
    )

    // 6. 更新 task.creditsLocked
    await tx.update(tasks).set({ creditsLocked: cost }).where(eq(tasks.id, taskId))

    return { lockedAmount: cost, balanceAfter: newBalance }
  })
}

// -----------------------------------------------------------------------------
// consumeCredits：worker 成功时实扣（幂等）
// -----------------------------------------------------------------------------
// 流程（db.transaction 内）：
//   1. 查 task，得 creditsLocked 和 userId
//   2. 幂等：task.creditsCharged > 0 → 跳过（防 BullMQ 重试双结）
//   3. user.creditLocked -= cost（不动 creditBalance，因 lockCredits 时已扣 + 已写 consume 流水）
//   4. task.creditsCharged = cost（标记已结算）
//   注：不再写流水，lockCredits 已写一条 consume 流水，避免双条扣减造成用户困惑
// -----------------------------------------------------------------------------
export async function consumeCredits(input: {
  taskId: string
}): Promise<{ chargedAmount: number; balanceAfter: number } | null> {
  const { taskId } = input

  return await db.transaction(async (tx) => {
    const taskRow = await tx.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
    if (!taskRow[0]) return null
    const task = taskRow[0]

    // 幂等：已结算则跳过（task.creditsCharged 在 worker 成功时回填）
    if (task.creditsCharged > 0) return null

    // 没有锁定记录（异常情况），无法 consume
    if (task.creditsLocked === 0) return null

    const actualUserId = await resolveTaskUserId(task.id, tx)
    if (!actualUserId) return null

    const cost = task.creditsLocked

    // 解锁（creditLocked -= cost）；余额不动（lockCredits 时已扣 + 已写 consume 流水）
    await tx
      .update(users)
      .set({
        creditLocked: sql`${users.creditLocked} - ${cost}`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, actualUserId))

    // task.creditsCharged = cost（标记已结算，幂等关键）
    await tx.update(tasks).set({ creditsCharged: cost }).where(eq(tasks.id, taskId))

    // 不再写 consume 流水：lockCredits 已写一条 consume 流水（用户端展示"剧本分析 -2000"）
    // 此处仅做结算标记，避免双条扣减流水造成用户困惑
    return { chargedAmount: cost, balanceAfter: 0 }
  }).catch((err) => {
    logger.error({ err, taskId }, 'consumeCredits 失败')
    return null
  })
}

// -----------------------------------------------------------------------------
// refundCredits：worker 失败/用户取消时退款（幂等）
// -----------------------------------------------------------------------------
// 流程（db.transaction 内）：
//   1. 查 task，得 creditsLocked 和 userId
//   2. 幂等：task.creditsCharged > 0 → 已扣不退；或已有 refund 流水 → 跳过
//   3. user.creditLocked -= cost, user.creditBalance += cost（退款回余额）
//   4. 写 type='refund' 流水（delta=+cost）
//   5. task.creditsLocked = 0 + task.creditsRefunded = true
// -----------------------------------------------------------------------------
export async function refundCredits(input: {
  taskId: string
  reason: 'error' | 'canceled'
}): Promise<{ refundedAmount: number; balanceAfter: number } | null> {
  const { taskId, reason } = input

  try {
    return await db.transaction(async (tx) => {
      const taskRow = await tx.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
      if (!taskRow[0]) return null
      const task = taskRow[0]

      // 已实扣则不退（防误退）
      if (task.creditsCharged > 0) return null
      // 幂等：已有 refund 流水则跳过
      const alreadyRefunded = await creditTransactionRepository.existsByTaskAndType(
        taskId,
        creditTxType.REFUND,
      )
      if (alreadyRefunded) return null

      // 无锁定记录，无需退款
      if (task.creditsLocked === 0) return null

      const userId = await resolveTaskUserId(task.id, tx)
      if (!userId) return null

      const cost = task.creditsLocked

      const userRows = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .for('update')
        .limit(1)
      if (!userRows[0]) return null
      const user = userRows[0]

      // 退款：锁定 -cost，余额 +cost
      const newBalance = user.creditBalance + cost
      await tx
        .update(users)
        .set({
          creditBalance: sql`${users.creditBalance} + ${cost}`,
          creditLocked: sql`${users.creditLocked} - ${cost}`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))

      await creditTransactionRepository.insert(
        {
          userId,
          delta: cost,
          balanceAfter: newBalance,
          type: creditTxType.REFUND,
          refTaskId: taskId,
          refRuleCode: null,
          remark: reason === 'canceled' ? '任务取消退款' : '任务失败退款',
        },
        tx,
      )

      // task.creditsLocked = 0 + task.creditsRefunded = true（前端展示"已退回"标记）
      await tx
        .update(tasks)
        .set({ creditsLocked: 0, creditsRefunded: true })
        .where(eq(tasks.id, taskId))

      return { refundedAmount: cost, balanceAfter: newBalance }
    })
  } catch (err) {
    logger.error({ err, taskId, reason }, 'refundCredits 失败')
    return null
  }
}

// -----------------------------------------------------------------------------
// adjustCredits：admin 手动调整（充值/扣减）
// -----------------------------------------------------------------------------
export type AdjustCategory = 'recharge' | 'compensate' | 'deduct'

export async function adjustCredits(input: {
  userId: string
  delta: number // 正数=充值/补偿，负数=扣减
  remark?: string // 选填：调配原因（内容自定义），空则落 NULL
  adminId: string
  category: AdjustCategory // 区分后台充值/人工补偿/人工扣减，决定流水 type
}): Promise<{ balanceAfter: number }> {
  const { userId, delta, remark, adminId, category } = input

  if (delta === 0) {
    throw badRequest('INVALID_DELTA', '调整量不能为 0')
  }
  // category 与 delta 符号一致性校验
  if (category === 'deduct' && delta > 0) {
    throw badRequest('INVALID_CATEGORY', '人工扣减的 delta 必须为负数')
  }
  if (category !== 'deduct' && delta < 0) {
    throw badRequest('INVALID_CATEGORY', '充值/补偿的 delta 必须为正数')
  }

  return await db.transaction(async (tx) => {
    const userRows = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .for('update')
      .limit(1)
    if (!userRows[0]) {
      throw notFound('用户')
    }
    const user = userRows[0]

    // 扣减时检查余额（不允许扣成负数）
    if (delta < 0 && user.creditBalance + delta < 0) {
      throw conflict(
        'INSUFFICIENT_CREDITS',
        `用户当前余额 ${user.creditBalance}，无法扣减 ${Math.abs(delta)}`,
      )
    }

    const newBalance = user.creditBalance + delta
    await tx
      .update(users)
      .set({
        creditBalance: sql`${users.creditBalance} + ${delta}`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))

    // 按 category 映射流水 type（避免与业务 consume 混淆）
    const txType =
      category === 'recharge'
        ? creditTxType.RECHARGE
        : category === 'compensate'
          ? creditTxType.COMPENSATE
          : creditTxType.DEDUCT

    await creditTransactionRepository.insert(
      {
        userId,
        delta,
        balanceAfter: newBalance,
        type: txType,
        refTaskId: null,
        refRuleCode: null,
        remark: remark ?? null,
        operatedBy: adminId,
      },
      tx,
    )

    return { balanceAfter: newBalance }
  })
}

// -----------------------------------------------------------------------------
// getUserBalance：查询余额（用户端 / admin 端共用）
// -----------------------------------------------------------------------------
export async function getUserBalance(userId: string): Promise<{ balance: number; locked: number; available: number }> {
  const user = await userRepository.findById(userId)
  if (!user) {
    throw notFound('用户')
  }
  return {
    balance: user.creditBalance,
    locked: user.creditLocked,
    available: user.creditBalance - user.creditLocked,
  }
}

// -----------------------------------------------------------------------------
// listUserTransactions：分页查询用户流水
// -----------------------------------------------------------------------------
export async function listUserTransactions(
  userId: string,
  opts: ListTransactionsOptions = {},
): Promise<PagedTransactions> {
  const result = await creditTransactionRepository.listWithFilters(userId, opts)
  return {
    items: result.items.map((tx) => ({
      id: tx.id,
      userId: tx.userId,
      delta: tx.delta,
      balanceAfter: tx.balanceAfter,
      type: tx.type,
      refTaskId: tx.refTaskId,
      refRuleCode: tx.refRuleCode,
      remark: tx.remark,
      operatedBy: tx.operatedBy,
      createdAt: tx.createdAt.toISOString(),
    })),
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
  }
}

// -----------------------------------------------------------------------------
// 辅助：从 taskId 反查 userId（tasks 表无 userId，需 JOIN scripts）
// -----------------------------------------------------------------------------
async function resolveTaskUserId(
  taskId: string,
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<string | null> {
  const rows = await tx
    .select({ userId: scripts.userId })
    .from(tasks)
    .innerJoin(scripts, eq(scripts.id, tasks.scriptId))
    .where(eq(tasks.id, taskId))
    .limit(1)
  return rows[0]?.userId ?? null
}
