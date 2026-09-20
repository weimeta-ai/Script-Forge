// =============================================================================
// Redis 连接（BullMQ 共享）
// -----------------------------------------------------------------------------
// BullMQ 要求 maxRetriesPerRequest 必须为 null（不允许在请求内重试）
// 这里从 env.REDIS_URL 解析，避免新增 REDIS_HOST/PORT 配置
//
// 类型说明：bullmq 自带一份 ioredis 副本（node_modules/bullmq/node_modules/ioredis）
// 与项目根 ioredis 类型签名不同，需要 unknown 中转一次
// =============================================================================

import IORedis from 'ioredis'
import { env } from '../config/env'

// BullMQ 共享连接（Queue 与 Worker 用同一个）
export const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // BullMQ 硬性要求
}) as unknown as Parameters<typeof import('bullmq').Queue.prototype.add>[0] extends unknown
  ? import('bullmq').ConnectionOptions
  : never
