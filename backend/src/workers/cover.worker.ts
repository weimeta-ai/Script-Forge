// 封面生成 Worker（独立队列，concurrency=1）
// -----------------------------------------------------------------------------
// 流程：
//   1. 推 cover_start 事件
//   2. buildCoverPrompt → 调 generateImage（AI 网关返回临时 URL 或 data:base64）
//   3. uploadImageFromUrl：临时 URL → OSS 永久 URL
//   4. 写 scripts.coverUrl + 推 cover_done（携带最终 URL）
//
// 失败：推 cover_error + tasks.status='error'
// 取消：与 analyze 一致，写 done 前检查 status 是否已被用户改 canceled
// =============================================================================

import { Worker } from 'bullmq'
import { eq } from 'drizzle-orm'
import { connection } from '../lib/redis'
import { db } from '../db/client'
import { tasks, scripts } from '../db/schema'
import { persistEvent } from '../lib/task-events'
import { createRuntimeLogger } from '../lib/runtime-logger'
import { formatErrorForUser } from '../lib/errors'
import { buildCoverPrompt } from '../lib/cover-prompt'
import { generateImage } from '../services/image-config.service'
import { uploadImageFromUrl } from '../services/oss-config.service'
import { consumeCredits, refundCredits } from '../services/credit.service'
import type { TaskEvent } from '../db/schema'
import { COVER_QUEUE, type CoverJobData } from '../services/cover.service'

export async function processCoverJob(input: CoverJobData): Promise<void> {
  const { taskId, scriptId, title, genre, reportMarkdown } = input
  const startedAt = Date.now()
  const rtLog = createRuntimeLogger('cover', { scriptId, taskId })

  rtLog.info(`封面生成任务开始`, { taskId, scriptId })
  console.log(`[cover-worker] start task=${taskId} script=${scriptId}`)

  try {
    // 反查 script → userId（per-user 配置透传）
    const scriptRow = await db
      .select({ userId: scripts.userId })
      .from(scripts)
      .where(eq(scripts.id, scriptId))
      .limit(1)
    const userId = scriptRow[0]?.userId
    if (!userId) {
      throw new Error(`剧本 ${scriptId} 无归属用户，无法生成封面`)
    }

    // 1. 推 cover_start
    const startEvent: TaskEvent = { type: 'cover_start', ts: Date.now() }
    await persistEvent(taskId, startEvent)

    // 2. 构造 prompt + 调图片模型（一次生成 3 张候选）
    // userId 透传：强制走 per-user 图片配置 + per-user 封面话术 + 写 usage_logs
    const prompt = await buildCoverPrompt({ title, genre, reportMarkdown, userId })
    rtLog.info(`封面 prompt 构造完成`, { taskId, promptLen: prompt.length })

    const imageResult = await generateImage({
      prompt,
      size: '1024x1024',
      count: 3,
      userId,
      taskId,
      scriptId,
      phase: 'cover',
    })
    if (!imageResult.images || imageResult.images.length === 0) {
      throw new Error('图片模型未返回任何图片')
    }

    // 3. 循环上传 OSS，得到 object key 数组
    // 文件名加索引避免覆盖；串行上传（concurrency=1，频率低，无并发压力）
    const objectKeys: string[] = []
    for (let i = 0; i < imageResult.images.length; i++) {
      const img = imageResult.images[i]
      const uploaded = await uploadImageFromUrl({
        url: img.url,
        filename: `${title || 'cover'}-${i + 1}.png`,
        contentType: 'image/png',
      })
      objectKeys.push(uploaded.key)
    }

    // 4. 写 scripts.coverUrlCandidates（候选数组）；coverUrl 留空，等用户在 UI 选定后再写
    await db
      .update(scripts)
      .set({ coverUrlCandidates: objectKeys, updatedAt: new Date() })
      .where(eq(scripts.id, scriptId))

    // 5. 写 done 前检查是否已被用户取消
    const current = await db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1)
    if (current[0]?.status === 'canceled') {
      rtLog.info(`任务已被用户取消，跳过 done 写入`, { taskId })
      return
    }

    // 6. task done
    await db
      .update(tasks)
      .set({ status: 'done', finishedAt: new Date() })
      .where(eq(tasks.id, taskId))

    // 实扣积分（幂等：BullMQ 重试时若已 consume 则跳过）
    await consumeCredits({ taskId })

    // 7. 推 cover_done（携带候选 object key 数组，由 routes 层在读取时签名）
    const doneEvent: TaskEvent = {
      type: 'cover_done',
      coverUrls: objectKeys,
      ts: Date.now(),
    }
    await persistEvent(taskId, doneEvent)

    rtLog.info(`封面生成完成`, { taskId, count: objectKeys.length, durationMs: Date.now() - startedAt })
    console.log(
      `[cover-worker] done task=${taskId} script=${scriptId} count=${objectKeys.length} duration=${Date.now() - startedAt}ms`,
    )
  } catch (e) {
    const errorMessage = formatErrorForUser(e)
    rtLog.error(`封面生成失败`, { taskId, errorMessage })
    console.error(`[cover-worker] failed task=${taskId}:`, errorMessage)

    // 失败前同样检查取消状态（避免覆盖 canceled）
    const current = await db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1)
    if (current[0]?.status === 'canceled') {
      rtLog.info(`任务已被用户取消，跳过 error 写入`, { taskId })
      return
    }

    await db
      .update(tasks)
      .set({
        status: 'error',
        finishedAt: new Date(),
        errorMessage: errorMessage.slice(0, 500),
      })
      .where(eq(tasks.id, taskId))

    // 失败退款（幂等：与 stopCoverGeneration 的 canceled 退款互斥）
    await refundCredits({ taskId, reason: 'error' })

    const errorEvent: TaskEvent = {
      type: 'cover_error',
      message: errorMessage,
      ts: Date.now(),
    }
    await persistEvent(taskId, errorEvent)

    throw e
  }
}

// Worker 实例（concurrency=1：封面频率低，给 analyze 让路）
export const coverWorker = new Worker<CoverJobData>(
  COVER_QUEUE,
  async (job) => {
    return processCoverJob(job.data)
  },
  {
    connection,
    concurrency: 1,
    stalledInterval: 10_000,
    maxStalledCount: 1,
  },
)

coverWorker.on('completed', (job) => {
  console.log(`[cover-worker] completed job=${job.id}`)
})

coverWorker.on('failed', (job, err) => {
  console.error(`[cover-worker] failed job=${job?.id}:`, err.message)
})

coverWorker.on('error', (err) => {
  console.error('[cover-worker] worker error:', err.message)
})

coverWorker.on('stalled', (jobId, prev) => {
  console.warn(
    `[cover-worker] job=${jobId} stalled (prev state=${prev}) — BullMQ 将自动重处理或标记失败`,
  )
})
