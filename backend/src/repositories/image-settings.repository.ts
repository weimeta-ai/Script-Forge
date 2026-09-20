// =============================================================================
// 图片模型配置 Repository（单行表）
// -----------------------------------------------------------------------------
// 设计要点（与 llm-settings 一致）：
//   - 全部走 singleton（WHERE id = 1）
//   - upsert：INSERT ... ON CONFLICT DO UPDATE
//   - get：返回 null 时由上层 service fallback 到 env
//   - maskApiKey：复用 llm-settings 的脱敏逻辑
// =============================================================================

import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import { imageSettings, type ImageSettings } from '../db/schema'

// 完整配置类型（含明文 apiKey）— 仅内部使用
export interface ImageSettingsPlain {
  name: string
  apiKey: string
  model: string
  baseUrl: string
  timeoutMs: number
  defaultSize: string
  defaultCount: number
  updatedAt: Date
}

// 脱敏配置类型（前端展示用）
export interface ImageSettingsMasked {
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

class ImageSettingsRepository {
  async getPlain(): Promise<ImageSettingsPlain | null> {
    const rows = await db
      .select()
      .from(imageSettings)
      .where(sql`id = 1`)
      .limit(1)
    if (rows.length === 0) return null
    return this.toPlain(rows[0])
  }

  async upsert(input: {
    name: string
    apiKey: string
    model: string
    baseUrl: string
    timeoutMs: number
    defaultSize: string
    defaultCount: number
  }): Promise<ImageSettingsPlain> {
    const row = await db
      .insert(imageSettings)
      .values({
        id: 1,
        name: input.name,
        apiKey: input.apiKey,
        model: input.model,
        baseUrl: input.baseUrl,
        timeoutMs: input.timeoutMs,
        defaultSize: input.defaultSize,
        defaultCount: input.defaultCount,
      })
      .onConflictDoUpdate({
        target: imageSettings.id,
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

  private toPlain(row: ImageSettings): ImageSettingsPlain {
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

export const imageSettingsRepository = new ImageSettingsRepository()
