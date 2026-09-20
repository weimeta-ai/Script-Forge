// =============================================================================
// 日志模块（基于 pino）
// -----------------------------------------------------------------------------
// 【前端转全栈知识点】
// 为什么不用 console.log：
//   1. console.log 是同步阻塞的，大量日志会拖慢服务
//   2. console.log 输出不带时间戳、级别、上下文，难追溯
//   3. 生产环境需要把日志写到文件/SLS，console.log 做不到
//   4. 无法按级别过滤（debug/info/warn/error）
//
// 为什么选 pino：
//   - 性能最高（比 winston 快 5-10 倍）
//   - JSON 输出，方便 ELK/Loki 采集
//   - pino-pretty 提供漂亮的开发期输出（彩色 + 对齐）
//
// 日志级别（从低到高）：
//   debug → info → warn → error
//   生产环境 LOG_LEVEL=info 时，debug 不输出
// =============================================================================

import pino from 'pino'
import { env, isDev } from '../config/env'

// -----------------------------------------------------------------------------
// 创建 logger 实例
// -----------------------------------------------------------------------------
export const logger = pino({
  // 最低输出级别（低于此级别的日志会被丢弃）
  level: env.LOG_LEVEL,

  // 开发期用漂亮的彩色输出，生产期输出 JSON
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,                    // 彩色
          translateTime: 'yyyy-mm-dd HH:MM:ss', // 时间格式
          ignore: 'pid,hostname',            // 不打印 pid/hostname（开发期不需要）
        },
      }
    : undefined,                             // 生产环境用默认 JSON 输出

  // 默认字段（每条日志都会带上）
  base: {
    service: 'drama-predict-backend',
    env: env.NODE_ENV,
  },
})

// -----------------------------------------------------------------------------
// 业务 logger（带上下文）
// -----------------------------------------------------------------------------
// 用法：
//   import { logger } from '@/logger'
//   logger.info({ userId: '123', scriptId: '456' }, '开始分析')
//
// 输出：
//   {"level":30,"time":1234567890,"userId":"123","scriptId":"456","msg":"开始分析"}
//
// 为什么要"带上下文"：
//   生产环境日志非常多，需要快速过滤"某个用户某个剧本的日志"
//   把 userId/scriptId 作为字段而不是塞进 msg 字符串，方便检索
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// 创建子 logger（绑定固定上下文）
// 用法：
//   const authLogger = logger.child({ module: 'auth' })
//   authLogger.info('用户登录成功')
// -----------------------------------------------------------------------------
export function createLogger(module: string) {
  return logger.child({ module })
}
