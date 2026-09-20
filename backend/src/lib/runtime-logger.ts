// =============================================================================
// 运行时日志（前端 Debug 面板用）
// -----------------------------------------------------------------------------
// 用途：让前端在 Cmd+Shift+L 调试面板里看到「分析情况」
//      （分析任务进度、封面生成、LLM 调用耗时、错误明细）
//
// 架构：
//   worker 进程  ─┐
//                 ├─ push → Redis List (runtime:logs, 保留最近 500 条)
//   API server  ─┤
//                 └─ GET /debug/logs ← 前端 polling
//
// 设计要点：
//   - 用 Redis 共享（worker 进程独立，进程内 buffer 拿不到）
//   - 专用 ioredis 连接（不与 BullMQ 共享，避免阻塞）
//   - 异步 fire-and-forget：日志失败不能影响主流程
//   - LPUSH + LTRIM 保证 FIFO（最新在前）+ 长度上限
// =============================================================================

import IORedis from 'ioredis'
import { env } from '../config/env'

const LOG_KEY = 'runtime:logs'
const MAX_LOGS = 500 // Redis 保留最近 500 条

// 专用连接：maxRetriesPerRequest=1 允许重试 1 次（与 BullMQ connection 区分）
const redis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  lazyConnect: false,
})

export type LogCategory =
  | 'system'
  | 'import'
  | 'analyze'
  | 'llm'
  | 'report'
  | 'cover'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface RuntimeLogEntry {
  id: string
  ts: number // ms timestamp
  level: LogLevel
  category: LogCategory
  message: string
  scriptId?: string
  projectId?: string
  jobId?: string
  taskId?: string // 分析任务 ID（仅 analyze category 用）
  dimensionKey?: string // 评分维度（仅 score category 用）
  meta?: Record<string, unknown> // 自由扩展（耗时、模型名、错误码等）
}

// 内部工具：生成短 id（避免 uuid 依赖）
function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// 推送一条运行时日志（fire-and-forget，调用方不需要 await）
// 异常静默吞掉，不影响主流程
export function pushRuntimeLog(
  entry: Omit<RuntimeLogEntry, 'id' | 'ts'>,
): void {
  const full: RuntimeLogEntry = {
    id: genId(),
    ts: Date.now(),
    ...entry,
  }
  const json = JSON.stringify(full)

  // 不 await：调用方 fire-and-forget
  Promise.all([
    redis.lpush(LOG_KEY, json),
    redis.ltrim(LOG_KEY, 0, MAX_LOGS - 1),
  ]).catch((e) => {
    // 日志失败仅本地 console，不再向上抛
    console.error('[runtime-logger] push failed:', e)
  })
}

// 读取最近 N 条日志（按时间倒序，最新在前）
// limit 上限 500，防止前端拉太多内存炸
export async function getRuntimeLogs(
  limit = 200,
): Promise<RuntimeLogEntry[]> {
  const safeLimit = Math.min(Math.max(limit, 1), MAX_LOGS)
  const items = await redis.lrange(LOG_KEY, 0, safeLimit - 1)
  return items.map((s) => JSON.parse(s) as RuntimeLogEntry)
}

// 便捷工厂：按 category 创建带上下文的 logger
// 用法：
//   const log = createRuntimeLogger('score', { scriptId, projectId })
//   log.info('开始评分')
//   log.info('完成第 1 维', { dimensionKey: 'hook_strength' })
export function createRuntimeLogger(
  category: LogCategory,
  context: { scriptId?: string; projectId?: string; jobId?: string; taskId?: string } = {},
) {
  const base = { category, ...context }
  return {
    debug: (message: string, meta?: Record<string, unknown>) =>
      pushRuntimeLog({ ...base, level: 'debug', message, meta }),
    info: (message: string, meta?: Record<string, unknown>) =>
      pushRuntimeLog({ ...base, level: 'info', message, meta }),
    warn: (message: string, meta?: Record<string, unknown>) =>
      pushRuntimeLog({ ...base, level: 'warn', message, meta }),
    error: (message: string, meta?: Record<string, unknown>) =>
      pushRuntimeLog({ ...base, level: 'error', message, meta }),
    // 子 logger：补充额外上下文（如 dimensionKey）
    child: (extra: Record<string, unknown>) =>
      createRuntimeLogger(category, { ...context, ...extra }),
  }
}

export type RuntimeLogger = ReturnType<typeof createRuntimeLogger>
