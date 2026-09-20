// =============================================================================
// Prompt 配置 Repository（多版本表，按 type 分组）
// -----------------------------------------------------------------------------
// 设计要点：
//   - 单表 + is_current 标记：每个 type 同时只有一行 is_current=true（DB 索引强制）
//   - saveVersionWithTx：单事务内"旧 current 置 false + 插入新 current"，避免并发写冲突
//   - 不脱敏：prompt 无敏感字段（与 llm/image-settings 不同）
//   - 不走 BaseRepository：BaseRepository 假设单表主键字符串 id，本表是 serial + 复合查询
// =============================================================================

import { eq, and, desc, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { promptSettings, type PromptType } from '../db/schema'

// 完整行类型（含 content）
export interface PromptSettingsRow {
  id: number
  type: PromptType
  content: string
  note: string | null
  version: number
  isCurrent: boolean
  createdBy: string
  createdAt: Date
}

// 历史版本摘要（不含 content，避免列表过大）
export interface PromptVersionSummary {
  id: number
  version: number
  note: string | null
  createdBy: string
  createdAt: string
  isCurrent: boolean
}

function toRow(row: typeof promptSettings.$inferSelect): PromptSettingsRow {
  return {
    id: row.id,
    type: row.type as PromptType,
    content: row.content,
    note: row.note,
    version: row.version,
    isCurrent: row.isCurrent,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  }
}

function toSummary(
  row: typeof promptSettings.$inferSelect,
): PromptVersionSummary {
  return {
    id: row.id,
    version: row.version,
    note: row.note,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    isCurrent: row.isCurrent,
  }
}

class PromptSettingsRepository {
  // 取当前生效版本（worker 调用）
  async getCurrentByType(
    type: PromptType,
  ): Promise<PromptSettingsRow | null> {
    const rows = await db
      .select()
      .from(promptSettings)
      .where(
        and(
          eq(promptSettings.type, type),
          eq(promptSettings.isCurrent, true),
        ),
      )
      .limit(1)
    return rows.length > 0 ? toRow(rows[0]) : null
  }

  // 取指定 id 的版本（任意状态，回滚/查看用）
  async getVersionById(id: number): Promise<PromptSettingsRow | null> {
    const rows = await db
      .select()
      .from(promptSettings)
      .where(eq(promptSettings.id, id))
      .limit(1)
    return rows.length > 0 ? toRow(rows[0]) : null
  }

  // 取指定 type 的所有历史版本摘要（不含 content），按 version 倒序
  async listVersionsByType(type: PromptType): Promise<PromptVersionSummary[]> {
    const rows = await db
      .select()
      .from(promptSettings)
      .where(eq(promptSettings.type, type))
      .orderBy(desc(promptSettings.version))
    return rows.map(toSummary)
  }

  // 单事务：保存新版本（旧 current 置 false + 插入新 current）
  // 返回新插入行的完整数据
  async saveVersionWithTx(input: {
    type: PromptType
    content: string
    note: string | null
    createdBy: string
  }): Promise<PromptSettingsRow> {
    return await db.transaction(async (tx) => {
      // 1. 计算新 version（MAX + 1）
      const maxRows = await tx
        .select({ max: sql<number>`MAX(${promptSettings.version})` })
        .from(promptSettings)
        .where(eq(promptSettings.type, input.type))
      const nextVersion = (maxRows[0]?.max ?? 0) + 1

      // 2. 旧 current 置 false
      await tx
        .update(promptSettings)
        .set({ isCurrent: false })
        .where(
          and(
            eq(promptSettings.type, input.type),
            eq(promptSettings.isCurrent, true),
          ),
        )

      // 3. 插入新 current
      const inserted = await tx
        .insert(promptSettings)
        .values({
          type: input.type,
          content: input.content,
          note: input.note,
          version: nextVersion,
          isCurrent: true,
          createdBy: input.createdBy,
        })
        .returning()

      return toRow(inserted[0])
    })
  }

  // 取所有 type 的当前生效版本（用于 GET /prompt-config 摘要列表）
  async listCurrent(): Promise<PromptSettingsRow[]> {
    const rows = await db
      .select()
      .from(promptSettings)
      .where(eq(promptSettings.isCurrent, true))
    return rows.map(toRow)
  }
}

export const promptSettingsRepository = new PromptSettingsRepository()
