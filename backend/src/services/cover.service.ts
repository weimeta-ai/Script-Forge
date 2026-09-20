// 封面生成业务服务层
// -----------------------------------------------------------------------------
// 职责：
//   - triggerCoverGeneration  归属校验 + 并发保护 + 入队 BullMQ + 创建 tasks 记录
//
// 设计要点：
//   - 复用 tasks 表（type="cover"），与 analyze 共用 events 轮询通道
//   - jobId = taskId：方便后续扩展 stop 接口（与 analyze 一致）
//   - 并发策略：同一 scriptId 已有 pending/running 的 cover task 时，返回原 taskId
//     （不抛 conflict；用户重复点击仅视为查询；YAGNI）
//   - attempts=1：图片模型失败常由限流/审核触发，重试易二次限流，不重试
// =============================================================================

import { Queue } from 'bullmq'
import { eq, and, inArray } from 'drizzle-orm'
import { connection } from '../lib/redis'
import { db } from '../db/client'
import { tasks, scripts } from '../db/schema'
import { notFound, badRequest, conflict } from '../lib/errors'
import { signObjectUrl } from '../lib/oss-signer'
import { scriptRepository } from '../repositories/script.repository'
import { scriptVersionRepository } from '../repositories/script-version.repository'
import { calcOverallProgressFromEvents, persistEvent } from '../lib/task-events'
import { lockCredits, refundCredits, resolveRuleCode } from './credit.service'
import { logger } from '../logger/index'

export const COVER_QUEUE = 'cover'
const coverQueue = new Queue(COVER_QUEUE, { connection })

export interface CoverJobData {
  taskId: string
  scriptId: string
  title: string
  genre: string | null
  reportMarkdown: string
}

// 触发封面生成（前端 POST /scripts/:id/cover/generate 调用）
// 返回 taskId；前端复用 GET /scripts/:id/status?taskId=xxx 轮询 cover_done 事件
export async function triggerCoverGeneration(
  userId: string,
  scriptId: string,
): Promise<{ taskId: string; status: 'pending' | 'running' }> {
  // 1. 归属校验
  const script = await scriptRepository.findById(scriptId)
  if (!script || script.userId !== userId) {
    throw notFound('剧本')
  }

  // 2. 并发保护：同一剧本已有 pending/running 的 cover task → 复用原 taskId
  const activeTask = await db
    .select({ id: tasks.id, status: tasks.status })
    .from(tasks)
    .where(
      and(
        eq(tasks.scriptId, scriptId),
        eq(tasks.type, 'cover'),
        inArray(tasks.status, ['pending', 'running']),
      ),
    )
    .limit(1)
  if (activeTask[0]) {
    return { taskId: activeTask[0].id, status: activeTask[0].status as 'pending' | 'running' }
  }

  // 3. 取最新版本的报告 markdown（无报告时用空串，buildCoverPrompt 仍能产出基础 prompt）
  const version = await scriptVersionRepository.findCurrentByScriptId(scriptId)
  const reportMarkdown = version?.scoreDetails?.report ?? ''

  // 4. 创建 tasks 记录
  const taskRows = await db
    .insert(tasks)
    .values({
      scriptId,
      type: 'cover',
      mode: 'standard',
      status: 'pending',
      events: [],
    })
    .returning()
  const task = taskRows[0]

  // 4.5 锁定积分（失败清理孤儿 task）
  try {
    await lockCredits({
      userId,
      taskId: task.id,
      ruleCode: resolveRuleCode('cover'),
    })
  } catch (err) {
    await db.delete(tasks).where(eq(tasks.id, task.id)).catch(() => {})
    throw err
  }

  // 5. 入队 BullMQ（attempts=1，不重试）
  const jobData: CoverJobData = {
    taskId: task.id,
    scriptId,
    title: script.title,
    genre: script.genre,
    reportMarkdown,
  }
  await coverQueue.add('cover', jobData, {
    jobId: task.id,
    attempts: 1,
  })

  // 6. 立即置 running + 记 startedAt（worker 接手前的乐观写入）
  await db
    .update(tasks)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(tasks.id, task.id))

  return { taskId: task.id, status: 'running' }
}

// 选定封面（前端 POST /scripts/:id/cover/select 调用）
// 用户从候选列表里挑一张 → 写入 script.coverUrl，并返回签名后的可访问 URL
// 入参 selectedUrl 是前端拿到的签名 URL，后端遍历 candidates 重新签名匹配出对应 key
// （不在前端做 URL→key 转换，避免前端理解 OSS URL 格式）
export async function selectCover(
  userId: string,
  scriptId: string,
  selectedUrl: string,
): Promise<{ coverUrl: string }> {
  // 1. 归属校验
  const script = await scriptRepository.findById(scriptId)
  if (!script || script.userId !== userId) {
    throw notFound('剧本')
  }

  // 2. 候选必须存在
  const candidates = script.coverUrlCandidates ?? []
  if (candidates.length === 0) {
    throw badRequest('COVER_NO_CANDIDATES', '尚无候选封面，请先生成')
  }

  // 3. 遍历候选重新签名，匹配出 selectedUrl 对应的 object key
  //    OSS 签名 URL 含Expires/Signature 参数，每次签名串不同，故用 path 比对更稳
  let matchedKey: string | null = null
  for (const key of candidates) {
    const signed = await signObjectUrl(key)
    if (!signed) continue
    // 用 URL 比较 path + 不带 query 的部分（避免 Expires/Signature 干扰）
    const normSigned = signed.split('?')[0]
    const normSelected = selectedUrl.split('?')[0]
    if (normSigned === normSelected) {
      matchedKey = key
      break
    }
  }
  if (!matchedKey) {
    throw badRequest('COVER_INVALID_CANDIDATE', '所选封面不在候选列表中')
  }

  // 4. 写入 coverUrl
  await db
    .update(scripts)
    .set({ coverUrl: matchedKey, updatedAt: new Date() })
    .where(eq(scripts.id, scriptId))

  // 5. 返回签名 URL（私有 bucket 直链会 403）
  const signed = await signObjectUrl(matchedKey)
  return { coverUrl: signed ?? matchedKey }
}

// 停止运行中的封面生成任务（POST /scripts/:id/cover/stop）
// 参考 stopAnalysis 实现：DB 标记 canceled + BullMQ 移除 job + 退款
export async function stopCoverGeneration(
  userId: string,
  scriptId: string,
  taskId: string,
): Promise<{ stopped: true; taskId: string }> {
  // 归属校验
  const script = await scriptRepository.findById(scriptId)
  if (!script || script.userId !== userId) {
    throw notFound('剧本')
  }

  const taskRows = await db
    .select({ id: tasks.id, status: tasks.status, scriptId: tasks.scriptId, type: tasks.type })
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
  if (task.type !== 'cover') {
    throw badRequest('TASK_TYPE_MISMATCH', '该任务不是封面生成任务')
  }
  if (!['running', 'pending'].includes(task.status)) {
    throw conflict('TASK_NOT_RUNNING', '任务不在运行中，无法停止')
  }

  // BullMQ 移除 job
  const job = await coverQueue.getJob(taskId)
  if (job) {
    try {
      await job.discard()
    } catch {
      // 忽略
    }
    try {
      await job.remove()
    } catch {
      // 忽略
    }
  }

  // DB 标记 canceled
  await db
    .update(tasks)
    .set({ status: 'canceled', finishedAt: new Date() })
    .where(eq(tasks.id, taskId))

  await persistEvent(taskId, {
    type: 'task_canceled',
    message: '用户取消封面生成',
    ts: Date.now(),
  })

  // 退款（fire-and-forget；幂等）
  refundCredits({ taskId, reason: 'canceled' }).catch((err) => {
    logger.error({ err, taskId }, 'stopCoverGeneration 退款失败')
  })

  return { stopped: true, taskId }
}

// 计算封面任务进度（导出给路由层用，避免重复实现）
export function getCoverProgress(events: unknown[]): number {
  return calcOverallProgressFromEvents(events as Parameters<typeof calcOverallProgressFromEvents>[0])
}
