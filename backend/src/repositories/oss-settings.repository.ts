// =============================================================================
// 阿里云 OSS 图床配置 Repository（单行表）
// -----------------------------------------------------------------------------
// 设计要点（与 image-settings / llm-settings 一致）：
//   - 全部走 singleton（WHERE id = 1）
//   - upsert：INSERT ... ON CONFLICT DO UPDATE
//   - get：返回 null 时由上层 service fallback 到 env
//   - maskApiKey：复用 llm-settings 的脱敏逻辑（head 4 + **** + tail 4）
// =============================================================================

import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import { ossSettings, type OssSettings } from '../db/schema'
import { maskApiKey } from './llm-settings.repository'

// 完整配置类型（含明文 AK/SK）— 仅内部使用
export interface OssSettingsPlain {
  name: string
  provider: string
  accessKeyId: string
  accessKeySecret: string
  region: string
  bucket: string
  endpoint: string | null
  customDomain: string | null
  pathPrefix: string
  timeoutMs: number
  updatedAt: Date
}

// 脱敏配置类型（前端展示用）
export interface OssSettingsMasked {
  name: string
  provider: string
  accessKeyIdMasked: string
  accessKeySecretMasked: string
  region: string
  bucket: string
  endpoint: string | null
  customDomain: string | null
  pathPrefix: string
  timeoutMs: number
  updatedAt: string
  hasAccessKeySecret: boolean
}

class OssSettingsRepository {
  async getPlain(): Promise<OssSettingsPlain | null> {
    const rows = await db
      .select()
      .from(ossSettings)
      .where(sql`id = 1`)
      .limit(1)
    if (rows.length === 0) return null
    return this.toPlain(rows[0])
  }

  async upsert(input: {
    name: string
    provider: string
    accessKeyId: string
    accessKeySecret: string
    region: string
    bucket: string
    endpoint: string | null
    customDomain: string | null
    pathPrefix: string
    timeoutMs: number
  }): Promise<OssSettingsPlain> {
    const row = await db
      .insert(ossSettings)
      .values({
        id: 1,
        name: input.name,
        provider: input.provider,
        accessKeyId: input.accessKeyId,
        accessKeySecret: input.accessKeySecret,
        region: input.region,
        bucket: input.bucket,
        endpoint: input.endpoint,
        customDomain: input.customDomain,
        pathPrefix: input.pathPrefix,
        timeoutMs: input.timeoutMs,
      })
      .onConflictDoUpdate({
        target: ossSettings.id,
        set: {
          name: input.name,
          provider: input.provider,
          accessKeyId: input.accessKeyId,
          accessKeySecret: input.accessKeySecret,
          region: input.region,
          bucket: input.bucket,
          endpoint: input.endpoint,
          customDomain: input.customDomain,
          pathPrefix: input.pathPrefix,
          timeoutMs: input.timeoutMs,
          updatedAt: new Date(),
        },
      })
      .returning()
    return this.toPlain(row[0])
  }

  private toPlain(row: OssSettings): OssSettingsPlain {
    return {
      name: row.name,
      provider: row.provider,
      accessKeyId: row.accessKeyId,
      accessKeySecret: row.accessKeySecret,
      region: row.region,
      bucket: row.bucket,
      endpoint: row.endpoint,
      customDomain: row.customDomain,
      pathPrefix: row.pathPrefix,
      timeoutMs: row.timeoutMs,
      updatedAt: row.updatedAt,
    }
  }
}

export const ossSettingsRepository = new OssSettingsRepository()

// 行 → 脱敏对象（独立导出，service 层也会用到）
export function toOssMasked(plain: OssSettingsPlain): OssSettingsMasked {
  return {
    name: plain.name,
    provider: plain.provider,
    accessKeyIdMasked: maskApiKey(plain.accessKeyId),
    accessKeySecretMasked: maskApiKey(plain.accessKeySecret),
    region: plain.region,
    bucket: plain.bucket,
    endpoint: plain.endpoint,
    customDomain: plain.customDomain,
    pathPrefix: plain.pathPrefix,
    timeoutMs: plain.timeoutMs,
    updatedAt: plain.updatedAt.toISOString(),
    hasAccessKeySecret: Boolean(plain.accessKeySecret),
  }
}
