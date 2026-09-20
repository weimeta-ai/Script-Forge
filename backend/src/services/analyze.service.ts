// 分析业务服务层（p00 同款：触发 8 节点分析 + 查询任务状态）
// -----------------------------------------------------------------------------
// 职责：
//   - triggerAnalysis  入队 BullMQ + 创建 tasks 记录 + 立即置 running
//   - getStatus        轮询任务状态 + events[] + overall（前端 1.8s 轮询用）
// =============================================================================

import { Queue } from 'bullmq'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { connection } from '../lib/redis'
import { db } from '../db/client'
import { tasks } from '../db/schema'
import { conflict, notFound } from '../lib/errors'
import { scriptRepository } from '../repositories/script.repository'
import { scriptVersionRepository } from '../repositories/script-version.repository'
import { calcOverallProgressFromEvents, persistEvent } from '../lib/task-events'
import { signObjectUrl } from '../lib/oss-signer'
import { getEffectiveLlmConfig } from './llm-config.service'
import { lockCredits, refundCredits, resolveRuleCode } from './credit.service'
import { logger } from '../logger/index'
import type { TaskEvent } from '../db/schema'

// 分析队列（与 worker 共享 connection + queue name）
export const ANALYZE_QUEUE = 'analyze'
const analyzeQueue = new Queue(ANALYZE_QUEUE, { connection })

export type AnalyzeMode = 'standard' | 'fast' | 'ultra'

// 触发分析（前端 POST /scripts/:id/analyze 调用）
// 返回 202 + taskId，前端跳转到 /analyzing-task/:taskId
// mode 为 undefined 时：从 llm_settings.defaultAnalyzeMode 取默认值（再 fallback 到 standard）
export async function triggerAnalysis(
  userId: string,
  scriptId: string,
  mode?: AnalyzeMode,
): Promise<{ taskId: string; status: 'running'; mode: AnalyzeMode }> {
  // 1. 归属校验
  const script = await scriptRepository.findById(scriptId)
  if (!script || script.userId !== userId) {
    throw notFound('剧本')
  }

  // 2. 取当前版本
  const version = await scriptVersionRepository.findCurrentByScriptId(scriptId)
  if (!version) {
    throw notFound('剧本版本')
  }

  // 3. 防重复触发：查询该剧本是否有活跃任务（pending/running）
  const activeTask = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.scriptId, scriptId),
        eq(tasks.status, 'running'),
      ),
    )
    .limit(1)
  if (activeTask[0]) {
    throw conflict('ANALYZE_RUNNING', '该剧本正在分析中，请稍后再试')
  }

  // 3.5 解析最终 mode：参数 > DB 默认 > standard
  const resolvedMode: AnalyzeMode = mode ?? (await resolveDefaultMode())

  // 4. 创建 tasks 记录（pending → running 由 worker 接手后改）
  const taskRows = await db
    .insert(tasks)
    .values({
      scriptId,
      type: 'analyze',
      mode: resolvedMode,
      status: 'pending',
      events: [],
    })
    .returning()
  const task = taskRows[0]

  // 4.5 锁定积分（事务内：余额检查 + 锁定 + 写流水）
  // 失败必须清理孤儿 task，否则 active-task 检查会永久卡住该剧本
  try {
    await lockCredits({
      userId,
      taskId: task.id,
      ruleCode: resolveRuleCode('analyze', resolvedMode),
    })
  } catch (err) {
    await db.delete(tasks).where(eq(tasks.id, task.id)).catch(() => {})
    throw err
  }

  // 5. 入队 BullMQ
  // jobId = taskId：让 stopAnalysis 能用 taskId 反查 job 调用 remove
  await analyzeQueue.add(
    'analyze',
    {
      taskId: task.id,
      scriptId,
      versionId: version.id,
      content: script.sourceContent,
      mode: resolvedMode,
    },
    {
      jobId: task.id,
      attempts: 2,
      backoff: { type: 'exponential', delay: 10_000 },
    },
  )

  // 6. 立即置 running + 记 startedAt
  await db
    .update(tasks)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(tasks.id, task.id))

  return { taskId: task.id, status: 'running', mode: resolvedMode }
}

// 解析默认分析模式：DB > standard
async function resolveDefaultMode(): Promise<AnalyzeMode> {
  try {
    const effective = await getEffectiveLlmConfig()
    return (effective.defaultAnalyzeMode ?? 'standard') as AnalyzeMode
  } catch {
    // DB 不可用时 fallback 到 standard（不阻塞触发分析）
    return 'standard'
  }
}

// 查询任务状态（前端 1.8s 轮询用）
export async function getStatus(userId: string, scriptId: string, taskId: string) {
  // 归属校验
  const script = await scriptRepository.findById(scriptId)
  if (!script || script.userId !== userId) {
    throw notFound('剧本')
  }

  const taskRows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.scriptId, scriptId)))
    .limit(1)
  const task = taskRows[0]
  if (!task) {
    throw notFound('任务')
  }

  const events = (task.events ?? []) as TaskEvent[]
  const overall = calcOverallProgressFromEvents(events)

  // 对 cover_done 事件里的 coverUrl / coverUrls 做签名（DB 里存 object key，私有 bucket 直链会 403）
  // - coverUrls: 多候选数组（当前主路径），逐个签名
  // - coverUrl: 单值旧字段（历史事件兼容），单独签名
  const signedEvents = await Promise.all(
    events.map(async (e) => {
      if (e.type !== 'cover_done') return e
      const signedCoverUrl = e.coverUrl ? await signObjectUrl(e.coverUrl) : undefined
      const signedCoverUrls = e.coverUrls?.length
        ? await Promise.all(e.coverUrls.map((k) => signObjectUrl(k)))
        : undefined
      return {
        ...e,
        ...(signedCoverUrl ? { coverUrl: signedCoverUrl } : {}),
        ...(signedCoverUrls ? { coverUrls: signedCoverUrls.filter(Boolean) as string[] } : {}),
      }
    }),
  )

  return {
    task: {
      id: task.id,
      status: task.status,
      mode: task.mode as AnalyzeMode,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      reportId: task.reportId,
      errorMessage: task.errorMessage,
      // 失败退款标记：前端 AnalyzingTask 据此展示「已退回 2,000 积分」
      creditsRefunded: task.creditsRefunded,
      // 同时返回 fileName 让前端 AnalyzingTask 显示「当前文件」（p00 同款）
      fileName: script.fileName ?? null,
    },
    events: signedEvents,
    overall,
  }
}

// 列出最近任务（admin 可观测用，可选）
export async function listRecentTasks(limit = 20) {
  return db.select().from(tasks).orderBy(desc(tasks.createdAt)).limit(limit)
}

// 查剧本最近活跃任务（断点续传用）
// 返回 analyze/cover 各自最新一条 running/pending 任务；二者皆无时两字段均为 null
// progress：基于 events 数组算出整体进度（与 getStatus 一致）
export async function getActiveTaskByScriptId(
  userId: string,
  scriptId: string,
): Promise<{
  analyzeTask: ActiveTaskSnapshot | null
  coverTask: ActiveTaskSnapshot | null
}> {
  // 归属校验
  const script = await scriptRepository.findById(scriptId)
  if (!script || script.userId !== userId) {
    throw notFound('剧本')
  }

  const rows = await db
    .select({
      id: tasks.id,
      type: tasks.type,
      status: tasks.status,
      mode: tasks.mode,
      events: tasks.events,
      startedAt: tasks.startedAt,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.scriptId, scriptId),
        inArray(tasks.status, ['running', 'pending']),
        inArray(tasks.type, ['analyze', 'cover']),
      ),
    )
    .orderBy(desc(tasks.createdAt))

  // 按 type 分桶，各自取最新一条（rows 已按 createdAt desc，首条即最新）
  const analyzeRow = rows.find((r) => r.type === 'analyze')
  const coverRow = rows.find((r) => r.type === 'cover')

  return {
    analyzeTask: analyzeRow ? toSnapshot(analyzeRow) : null,
    coverTask: coverRow ? toSnapshot(coverRow) : null,
  }
}

type ActiveTaskSnapshot = {
  taskId: string
  status: string
  mode: AnalyzeMode
  progress: number
  startedAt: Date | null
}

function toSnapshot(row: {
  id: string
  status: string
  mode: string
  events: unknown
  startedAt: Date | null
}): ActiveTaskSnapshot {
  const events = (row.events ?? []) as TaskEvent[]
  return {
    taskId: row.id,
    status: row.status,
    mode: row.mode as AnalyzeMode,
    progress: calcOverallProgressFromEvents(events),
    startedAt: row.startedAt,
  }
}

// 重试分析：用原 task 的 mode 触发新 task（保留历史）
// 允许的原 task 状态：error / done / canceled
// 拒绝：running / pending / canceling（防并发，canceling 也是过渡态）
export async function retryAnalysis(
  userId: string,
  scriptId: string,
  oldTaskId: string,
): Promise<{ taskId: string; status: 'running'; mode: AnalyzeMode }> {
  // 1. 查原 task
  const oldRows = await db
    .select({ id: tasks.id, status: tasks.status, mode: tasks.mode, scriptId: tasks.scriptId })
    .from(tasks)
    .where(eq(tasks.id, oldTaskId))
    .limit(1)
  if (!oldRows[0]) {
    throw notFound('原任务')
  }

  // 2. 校验：原 task 必须属于该 scriptId + 处于终态（error / done / canceled）
  const old = oldRows[0]
  if (old.scriptId !== scriptId) {
    throw notFound('原任务')
  }
  if (['running', 'pending', 'canceling'].includes(old.status)) {
    throw conflict(
      'ANALYZE_RUNNING',
      '原任务仍在运行中，无法重试',
    )
  }

  // 3. 复用 triggerAnalysis（自带归属校验、防重复、入队）
  const mode = old.mode as AnalyzeMode
  return triggerAnalysis(userId, scriptId, mode)
}

// 停止运行中任务：DB 标记 canceled + BullMQ 移除 job
// 简化方案：不实时中断 in-flight LLM 请求（worker 跑完后检查 status 主动跳过 done 写入）
// 代价：浪费一次 LLM 调用（最多 360s 内完成），但用户立即看到"已停止"
export async function stopAnalysis(
  userId: string,
  scriptId: string,
  taskId: string,
): Promise<{ stopped: true; taskId: string }> {
  // 1. 归属校验
  const script = await scriptRepository.findById(scriptId)
  if (!script || script.userId !== userId) {
    throw notFound('剧本')
  }

  // 2. 查任务，校验状态
  const taskRows = await db
    .select({ id: tasks.id, status: tasks.status, scriptId: tasks.scriptId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1)
  if (!taskRows[0]) {
    throw notFound('任务')
  }
  const task = taskRows[0]
  if (task.scriptId !== scriptId) {
    throw notFound('任务')
  }
  if (!['running', 'pending'].includes(task.status)) {
    throw conflict('TASK_NOT_RUNNING', '任务不在运行中，无法停止')
  }

  // 3. BullMQ 移除 job（防止 stalled 重处理）
  // jobId = taskId（triggerAnalysis 入队时设置的）
  const job = await analyzeQueue.getJob(taskId)
  if (job) {
    try {
      await job.discard() // 标记不再重试
    } catch {
      // 已被 worker 拿走或已删除，忽略
    }
    try {
      await job.remove() // 移除
    } catch {
      // 已被 worker 拿走或已删除，忽略
    }
  }

  // 4. DB 标记 canceled + finishedAt（前端轮询立即看到）
  await db
    .update(tasks)
    .set({ status: 'canceled', finishedAt: new Date() })
    .where(eq(tasks.id, taskId))

  // 5. 持久化 task_canceled 事件
  await persistEvent(taskId, {
    type: 'task_canceled',
    message: '用户取消分析',
    ts: Date.now(),
  })

  // 6. 退款（fire-and-forget；refundCredits 内部幂等，与 worker 失败路径互斥）
  refundCredits({ taskId, reason: 'canceled' }).catch((err) => {
    logger.error({ err, taskId }, 'stopAnalysis 退款失败')
  })

  return { stopped: true, taskId }
}
