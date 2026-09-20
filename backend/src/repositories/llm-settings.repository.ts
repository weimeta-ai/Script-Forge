// =============================================================================
// LLM 配置 Repository（单行表）
// -----------------------------------------------------------------------------
// 设计要点：
//   - 全部走 singleton（WHERE id = 1），应用层无需关心 id
//   - upsert：INSERT ... ON CONFLICT DO UPDATE
//   - get：返回 null 时由上层 service fallback 到 env
//   - maskApiKey：出参脱敏（前 4 + 后 4 位，中间用 **** 替换）
// =============================================================================

import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import { llmSettings, type LlmSettings } from '../db/schema'

// 脱敏：sk-1234567890abcdef... → sk-1...cdef
// 长 key 保留前 4 + 后 4，短 key 保留前 2 + 后 2，最少 8 位时才脱敏
export function maskApiKey(key: string): string {
  if (key.length <= 8) return '****'
  const head = key.slice(0, 4)
  const tail = key.slice(-4)
  return `${head}****${tail}`
}

// 完整配置类型（含明文 apiKey）— 仅内部使用，不直接返回给前端
export interface LlmSettingsPlain {
  name: string
  apiKey: string
  model: string
  baseUrl: string
  apiFormat: 'openai' | 'anthropic'
  timeoutMs: number
  defaultAnalyzeMode: 'standard' | 'fast' | 'ultra'
  updatedAt: Date
}

// 脱敏配置类型（前端展示用）
export interface LlmSettingsMasked {
  name: string
  apiKeyMasked: string
  model: string
  baseUrl: string
  apiFormat: 'openai' | 'anthropic'
  timeoutMs: number
  defaultAnalyzeMode: 'standard' | 'fast' | 'ultra'
  updatedAt: string
  hasApiKey: boolean
}

class LlmSettingsRepository {
  // 查询当前配置（返回明文，仅 service 层使用）
  // 返回 null：表为空（首次部署，尚未配置）
  async getPlain(): Promise<LlmSettingsPlain | null> {
    const rows = await db
      .select()
      .from(llmSettings)
      .where(sql`id = 1`)
      .limit(1)
    if (rows.length === 0) return null
    return this.toPlain(rows[0])
  }

  // UPSERT（id 固定 1）
  async upsert(input: {
    name: string
    apiKey: string
    model: string
    baseUrl: string
    apiFormat: 'openai' | 'anthropic'
    timeoutMs: number
    defaultAnalyzeMode: 'standard' | 'fast' | 'ultra'
  }): Promise<LlmSettingsPlain> {
    const row = await db
      .insert(llmSettings)
      .values({
        id: 1,
        name: input.name,
        apiKey: input.apiKey,
        model: input.model,
        baseUrl: input.baseUrl,
        apiFormat: input.apiFormat,
        timeoutMs: input.timeoutMs,
        defaultAnalyzeMode: input.defaultAnalyzeMode,
      })
      .onConflictDoUpdate({
        target: llmSettings.id,
        set: {
          name: input.name,
          apiKey: input.apiKey,
          model: input.model,
          baseUrl: input.baseUrl,
          apiFormat: input.apiFormat,
          timeoutMs: input.timeoutMs,
          defaultAnalyzeMode: input.defaultAnalyzeMode,
          updatedAt: new Date(),
        },
      })
      .returning()
    return this.toPlain(row[0])
  }

  // 行映射：DB 行 → 内部 plain 对象
  private toPlain(row: LlmSettings): LlmSettingsPlain {
    return {
      name: row.name,
      apiKey: row.apiKey,
      model: row.model,
      baseUrl: row.baseUrl,
      apiFormat: (row.apiFormat ?? 'openai') as 'openai' | 'anthropic',
      timeoutMs: row.timeoutMs,
      defaultAnalyzeMode: (row.defaultAnalyzeMode ?? 'standard') as
        | 'standard'
        | 'fast'
        | 'ultra',
      updatedAt: row.updatedAt,
    }
  }
}

// 单例导出
export const llmSettingsRepository = new LlmSettingsRepository()
