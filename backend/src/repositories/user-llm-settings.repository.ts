// =============================================================================
// 用户级 LLM 配置 Repository
// -----------------------------------------------------------------------------
// 设计要点：
//   - 每用户仅 1 条（UNIQUE 索引保证）
//   - findByUserId 返回明文（仅 service 层用）
//   - upsertByUserId：INSERT ... ON CONFLICT (user_id) DO UPDATE
//   - 复用 llm-settings.repository 的 maskApiKey 脱敏
// =============================================================================

import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { userLlmSettings, type UserLlmSettings } from '../db/schema'
import { maskApiKey } from './llm-settings.repository'

// 内部明文类型（service 层用，含 apiKey 明文）
export interface UserLlmSettingsPlain {
  name: string
  apiKey: string
  model: string
  baseUrl: string
  timeoutMs: number
  defaultAnalyzeMode: 'standard' | 'fast' | 'ultra'
  updatedAt: Date
}

// 脱敏类型（前端展示用）
export interface UserLlmSettingsMasked {
  name: string
  apiKeyMasked: string
  model: string
  baseUrl: string
  timeoutMs: number
  defaultAnalyzeMode: 'standard' | 'fast' | 'ultra'
  updatedAt: string
  hasApiKey: boolean
}

class UserLlmSettingsRepository {
  // 按 userId 查明文（未配置返回 null，由 service 抛错）
  async findByUserId(userId: string): Promise<UserLlmSettingsPlain | null> {
    const rows = await db
      .select()
      .from(userLlmSettings)
      .where(eq(userLlmSettings.userId, userId))
      .limit(1)
    if (rows.length === 0) return null
    return this.toPlain(rows[0])
  }

  // UPSERT（user_id 唯一）
  async upsertByUserId(
    userId: string,
    input: {
      name: string
      apiKey: string
      model: string
      baseUrl: string
      timeoutMs: number
      defaultAnalyzeMode: 'standard' | 'fast' | 'ultra'
    },
  ): Promise<UserLlmSettingsPlain> {
    const row = await db
      .insert(userLlmSettings)
      .values({
        userId,
        name: input.name,
        apiKey: input.apiKey,
        model: input.model,
        baseUrl: input.baseUrl,
        timeoutMs: input.timeoutMs,
        defaultAnalyzeMode: input.defaultAnalyzeMode,
      })
      .onConflictDoUpdate({
        target: userLlmSettings.userId,
        set: {
          name: input.name,
          apiKey: input.apiKey,
          model: input.model,
          baseUrl: input.baseUrl,
          timeoutMs: input.timeoutMs,
          defaultAnalyzeMode: input.defaultAnalyzeMode,
          updatedAt: new Date(),
        },
      })
      .returning()
    return this.toPlain(row[0])
  }

  // 物理删除（admin 删用户时由外键 CASCADE 自动清理，本方法供调试/重置用）
  async deleteByUserId(userId: string): Promise<void> {
    await db.delete(userLlmSettings).where(eq(userLlmSettings.userId, userId))
  }

  // 批量查询：检查多个用户是否已配置（admin 列表展示用）
  async existsByUserIds(userIds: string[]): Promise<Map<string, boolean>> {
    if (userIds.length === 0) return new Map()
    const rows = await db
      .select({ userId: userLlmSettings.userId })
      .from(userLlmSettings)
      .where(sql`${userLlmSettings.userId} = ANY(${userIds})`)
    const map = new Map<string, boolean>()
    for (const id of userIds) map.set(id, false)
    for (const row of rows) map.set(row.userId, true)
    return map
  }

  private toPlain(row: UserLlmSettings): UserLlmSettingsPlain {
    return {
      name: row.name,
      apiKey: row.apiKey,
      model: row.model,
      baseUrl: row.baseUrl,
      timeoutMs: row.timeoutMs,
      defaultAnalyzeMode: (row.defaultAnalyzeMode ?? 'standard') as
        | 'standard'
        | 'fast'
        | 'ultra',
      updatedAt: row.updatedAt,
    }
  }
}

// 脱敏工具（service 层用）
export function toMasked(plain: UserLlmSettingsPlain): UserLlmSettingsMasked {
  return {
    name: plain.name,
    apiKeyMasked: maskApiKey(plain.apiKey),
    model: plain.model,
    baseUrl: plain.baseUrl,
    timeoutMs: plain.timeoutMs,
    defaultAnalyzeMode: plain.defaultAnalyzeMode,
    updatedAt: plain.updatedAt.toISOString(),
    hasApiKey: Boolean(plain.apiKey),
  }
}

export const userLlmSettingsRepository = new UserLlmSettingsRepository()
