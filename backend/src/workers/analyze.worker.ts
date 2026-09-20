// 分析 Worker（p00 同款：8 节点串行分析）
// -----------------------------------------------------------------------------
// 流程：
//   1. 取剧本内容
//   2. 调 runAnalysis，每个节点事件回调里持久化到 tasks.events
//   3. 全部完成后拼接报告，写入 script_versions.scoreDetails
//   4. tasks.status = 'done', reportId 指向 script_versions.id
//
// 失败处理：单节点失败 → 整个任务失败（与 p00 一致）
// =============================================================================

import { Worker } from 'bullmq'
import { eq } from 'drizzle-orm'
import { connection } from '../lib/redis'
import { db } from '../db/client'
import { tasks, scriptVersions, scripts } from '../db/schema'
import { runAnalysis, stitchReport, loadSystemPromptForTask } from '../lib/analyzer'
import { persistEvent } from '../lib/task-events'
import { extractTitleFromMarkdown, extractScoreFromMarkdown } from '../lib/report-extract'
import { scriptVersionRepository } from '../repositories/script-version.repository'
import { createRuntimeLogger } from '../lib/runtime-logger'
import { formatErrorForUser } from '../lib/errors'
import { consumeCredits, refundCredits } from '../services/credit.service'
import type { TaskEvent } from '../db/schema'

export const ANALYZE_QUEUE_NAME = 'analyze'

interface AnalyzeJobData {
  taskId: string
  scriptId: string
  versionId: string
  content: string
  mode?: 'standard' | 'fast' | 'ultra'
}

export async function processAnalyzeJob(input: AnalyzeJobData): Promise<void> {
  const { taskId, scriptId, versionId, content, mode } = input
  const startedAt = Date.now()
  const rtLog = createRuntimeLogger('analyze', { scriptId, taskId })

  rtLog.info(`分析任务开始`, { taskId, scriptId, contentLength: content.length, mode })
  console.log(`[analyze-worker] start task=${taskId} script=${scriptId} mode=${mode ?? 'standard'} contentLen=${content.length}`)

  try {
    // 反查 script → userId（per-user 配置透传）
    const scriptRow = await db
      .select({ userId: scripts.userId })
      .from(scripts)
      .where(eq(scripts.id, scriptId))
      .limit(1)
    const userId = scriptRow[0]?.userId
    if (!userId) {
      throw new Error(`剧本 ${scriptId} 无归属用户，无法执行分析`)
    }

    // 任务入口：刷新 system prompt 缓存（按 userId 维度，DB 优先 + 60s TTL）
    // 不阻塞超过 60s 内的连续任务（命中缓存直接 return）
    await loadSystemPromptForTask(userId)

    // 调 8 节点分析器，每个事件持久化到 tasks.events
    // userId 透传：强制走 per-user LLM 配置 + 写 usage_logs
    const report = await runAnalysis(
      content,
      async (event) => {
        const fullEvent: TaskEvent = { ...event, ts: Date.now() }
        await persistEvent(taskId, fullEvent)
      },
      taskId,
      { mode, userId, scriptId },
    )

    // 报告写入 script_versions.scoreDetails（含从 markdown 反向抽取的 title/score/grade）
    const durationMs = Date.now() - startedAt
    const title = extractTitleFromMarkdown(report)
    const scoreInfo = extractScoreFromMarkdown(report)
    const scoreDetails = {
      report,
      title,
      score: scoreInfo?.score,
      grade: scoreInfo?.grade,
      durationMs,
    }
    await scriptVersionRepository.updateScore(versionId, scoreDetails)

    // 取刚更新的 version id（用作 reportId）
    const version = await scriptVersionRepository.findById(versionId)
    const reportId = version?.id

    // 关键：写 done 前检查任务是否已被用户取消
    // 取消语义：stopAnalysis 已把 status 改为 canceled；worker 即使跑完也不覆盖
    const current = await db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1)
    if (current[0]?.status === 'canceled') {
      rtLog.info(`任务已被用户取消，跳过 done 写入`, { taskId })
      console.log(`[analyze-worker] task=${taskId} canceled by user, skip done write`)
      return
    }

    // 任务完成
    await db
      .update(tasks)
      .set({
        status: 'done',
        finishedAt: new Date(),
        reportId,
      })
      .where(eq(tasks.id, taskId))

    // 实扣积分（幂等：BullMQ 重试时若已 consume 则跳过）
    await consumeCredits({ taskId })

    // 持久化 task_done 事件（前端轮询时识别为 100%）
    const doneEvent: TaskEvent = {
      type: 'task_done',
      reportId,
      ts: Date.now(),
    }
    await persistEvent(taskId, doneEvent)

    rtLog.info(`分析任务完成`, { taskId, durationMs, reportLength: report.length })
    console.log(
      `[analyze-worker] done task=${taskId} script=${scriptId} duration=${durationMs}ms reportLen=${report.length}`,
    )
  } catch (e) {
    const errorMessage = formatErrorForUser(e)
    rtLog.error(`分析任务失败`, { taskId, errorMessage })
    console.error(`[analyze-worker] failed task=${taskId}:`, errorMessage)

    // 关键：写 error 前检查任务是否已被用户取消
    // 取消语义：stopAnalysis 已把 status 改为 canceled；in-flight 失败不应覆盖
    const current = await db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1)
    if (current[0]?.status === 'canceled') {
      rtLog.info(`任务已被用户取消，跳过 error 写入`, { taskId })
      console.log(`[analyze-worker] task=${taskId} canceled by user, skip error write`)
      return
    }

    // 任务失败
    await db
      .update(tasks)
      .set({
        status: 'error',
        finishedAt: new Date(),
        errorMessage: errorMessage.slice(0, 500),
      })
      .where(eq(tasks.id, taskId))

    // 失败退款（幂等：与 stopAnalysis 的 canceled 退款互斥）
    await refundCredits({ taskId, reason: 'error' })

    const errorEvent: TaskEvent = {
      type: 'task_error',
      message: errorMessage,
      ts: Date.now(),
    }
    await persistEvent(taskId, errorEvent)

    throw e
  }
}

// Worker 实例（启动后自动消费 ANALYZE_QUEUE）
// concurrency=2：worker × 2 + fast 模式内部并发 × 2 = 瞬时 4 路 LLM 请求（规避 provider 限流）
// stalledInterval=10s：worker 崩溃后 10s 检测（默认 30s 太慢）
export const analyzeWorker = new Worker<AnalyzeJobData>(
  ANALYZE_QUEUE_NAME,
  async (job) => {
    return processAnalyzeJob(job.data)
  },
  {
    connection,
    concurrency: 2,
    stalledInterval: 10_000,
    maxStalledCount: 1,
  },
)

analyzeWorker.on('completed', (job) => {
  console.log(`[analyze-worker] completed job=${job.id}`)
})

analyzeWorker.on('failed', (job, err) => {
  console.error(`[analyze-worker] failed job=${job?.id}:`, err.message)
})

analyzeWorker.on('error', (err) => {
  console.error('[analyze-worker] worker error:', err.message)
})

// stalled 事件：worker 进程被 kill -9 或崩溃后，BullMQ 默认 30s 检测到 stalled job
// 这里仅记日志，BullMQ 会自动 reprocess（maxStalledCount=1）或标记 failed
// 不主动改 task.status，避免与重处理的 job 产生竞态
analyzeWorker.on('stalled', (jobId, prev) => {
  console.warn(
    `[analyze-worker] job=${jobId} stalled (prev state=${prev}) — BullMQ 将自动重处理或标记失败`,
  )
})

// stitchReport 重导出（p00 同款导出风格）
export { stitchReport }
export { scriptVersions }
