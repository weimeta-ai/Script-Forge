// =============================================================================
// 用法日志业务服务层
// -----------------------------------------------------------------------------
// 职责：
//   - logUsage：写入一条流水（chatCompletion / generateImage 调用）
//
// 设计要点：
//   - fire-and-forget：不阻塞业务流程，写入失败仅记日志
//   - 不冗余更新 users 累计字段（统计走实时聚合）
// =============================================================================

import { usageLogRepository } from '../repositories/usage-log.repository'

// logUsage 入参（type=llm / type=image 字段不同）
export interface LogUsageInput {
  userId: string
  taskId?: string
  scriptId?: string
  type: 'llm' | 'image'
  phase: 'analyze' | 'cover' | 'test'
  model?: string
  // LLM 字段
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  // 图片字段
  imageCount?: number
  latencyMs: number
  success: boolean
  errorCode?: string
  costCredits?: number // V1 默认 0；V2 由扣费服务回填
}

export async function logUsage(input: LogUsageInput): Promise<void> {
  await usageLogRepository.insert({
    userId: input.userId,
    taskId: input.taskId,
    scriptId: input.scriptId,
    type: input.type,
    phase: input.phase,
    model: input.model,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    totalTokens: input.totalTokens,
    imageCount: input.imageCount,
    latencyMs: input.latencyMs,
    success: input.success,
    errorCode: input.errorCode,
    costCredits: input.costCredits ?? 0,
  })
}
