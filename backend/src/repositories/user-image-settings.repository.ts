// =============================================================================
// 用户级 图片模型配置 Repository
// -----------------------------------------------------------------------------
// 与 user-llm-settings.repository 结构一致
// =============================================================================

import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { userImageSettings, type UserImageSettings } from '../db/schema'
import { maskApiKey } from './llm-settings.repository'

export interface UserImageSettingsPlain {
  name: string
  apiKey: string
  model: string
  baseUrl: string
  timeoutMs: number
  defaultSize: string
  defaultCount: number
  updatedAt: Date
}

export interface UserImageSettingsMasked {
  name: string
  apiKeyMasked: string
  model: string
  baseUrl: string
  timeoutMs: number
  defaultSize: string
  defaultCount: number
  updatedAt: string
  hasApiKey: boolean
}

class UserImageSettingsRepository {
  async findByUserId(userId: string): Promise<UserImageSettingsPlain | null> {
    const rows = await db
      .select()
      .from(userImageSettings)
      .where(eq(userImageSettings.userId, userId))
      .limit(1)
    if (rows.length === 0) return null
    return this.toPlain(rows[0])
  }

  async upsertByUserId(
    userId: string,
    input: {
      name: string
      apiKey: string
      model: string
      baseUrl: string
      timeoutMs: number
      defaultSize: string
      defaultCount: number
    },
  ): Promise<UserImageSettingsPlain> {
    const row = await db
      .insert(userImageSettings)
      .values({
        userId,
        name: input.name,
        apiKey: input.apiKey,
        model: input.model,
        baseUrl: input.baseUrl,
        timeoutMs: input.timeoutMs,
        defaultSize: input.defaultSize,
        defaultCount: input.defaultCount,
      })
      .onConflictDoUpdate({
        target: userImageSettings.userId,
        set: {
          name: input.name,
          apiKey: input.apiKey,
          model: input.model,
          baseUrl: input.baseUrl,
          timeoutMs: input.timeoutMs,
          defaultSize: input.defaultSize,
          defaultCount: input.defaultCount,
          updatedAt: new Date(),
        },
      })
      .returning()
    return this.toPlain(row[0])
  }

  async deleteByUserId(userId: string): Promise<void> {
    await db
      .delete(userImageSettings)
      .where(eq(userImageSettings.userId, userId))
  }

  async existsByUserIds(userIds: string[]): Promise<Map<string, boolean>> {
    if (userIds.length === 0) return new Map()
    const rows = await db
      .select({ userId: userImageSettings.userId })
      .from(userImageSettings)
      .where(sql`${userImageSettings.userId} = ANY(${userIds})`)
    const map = new Map<string, boolean>()
    for (const id of userIds) map.set(id, false)
    for (const row of rows) map.set(row.userId, true)
    return map
  }

  private toPlain(row: UserImageSettings): UserImageSettingsPlain {
    return {
      name: row.name,
      apiKey: row.apiKey,
      model: row.model,
      baseUrl: row.baseUrl,
      timeoutMs: row.timeoutMs,
      defaultSize: row.defaultSize,
      defaultCount: row.defaultCount,
      updatedAt: row.updatedAt,
    }
  }
}

export function toMasked(
  plain: UserImageSettingsPlain,
): UserImageSettingsMasked {
  return {
    name: plain.name,
    apiKeyMasked: maskApiKey(plain.apiKey),
    model: plain.model,
    baseUrl: plain.baseUrl,
    timeoutMs: plain.timeoutMs,
    defaultSize: plain.defaultSize,
    defaultCount: plain.defaultCount,
    updatedAt: plain.updatedAt.toISOString(),
    hasApiKey: Boolean(plain.apiKey),
  }
}

export const userImageSettingsRepository = new UserImageSettingsRepository()
