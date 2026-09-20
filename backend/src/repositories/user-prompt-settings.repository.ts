// =============================================================================
// 用户级 Prompt 配置 Repository（多版本表，按 user_id + type 分组）
// -----------------------------------------------------------------------------
// 设计要点（与 prompt-settings.repository 镜像）：
//   - 单表 + is_current 标记：每个 (user_id, type) 同时只有一行 is_current=true
//   - saveVersionWithTx：单事务"旧 current 置 false + 插入新 current"，并发安全
//   - 不脱敏：prompt 无敏感字段
//   - 不走 BaseRepository：本表 serial + 复合查询，与 prompt-settings 同款设计
// =============================================================================

import { eq, and, desc, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { userPromptSettings, type UserPromptType } from '../db/schema'

// 完整行类型（含 content）
export interface UserPromptSettingsRow {
  id: number
  userId: string
  type: UserPromptType
  content: string
  note: string | null
  version: number
  isCurrent: boolean
  createdBy: string
  createdAt: Date
}

// 历史版本摘要（不含 content，避免列表过大）
export interface UserPromptVersionSummary {
  id: number
  version: number
  note: string | null
  createdBy: string
  createdAt: string
  isCurrent: boolean
}

function toRow(
  row: typeof userPromptSettings.$inferSelect,
): UserPromptSettingsRow {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type as UserPromptType,
    content: row.content,
    note: row.note,
    version: row.version,
    isCurrent: row.isCurrent,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  }
}

function toSummary(
  row: typeof userPromptSettings.$inferSelect,
): UserPromptVersionSummary {
  return {
    id: row.id,
    version: row.version,
    note: row.note,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    isCurrent: row.isCurrent,
  }
}

class UserPromptSettingsRepository {
  // 取当前生效版本（worker 调用，按 userId + type 查询）
  async getCurrentByUserAndType(
    userId: string,
    type: UserPromptType,
  ): Promise<UserPromptSettingsRow | null> {
    const rows = await db
      .select()
      .from(userPromptSettings)
      .where(
        and(
          eq(userPromptSettings.userId, userId),
          eq(userPromptSettings.type, type),
          eq(userPromptSettings.isCurrent, true),
        ),
      )
      .limit(1)
    return rows.length > 0 ? toRow(rows[0]) : null
  }

  // 取指定 id 的版本（任意状态，回滚/查看用）
  // 校验 userId + type 防止跨用户越权访问
  async getVersionByIdForUser(
    id: number,
    userId: string,
    type: UserPromptType,
  ): Promise<UserPromptSettingsRow | null> {
    const rows = await db
      .select()
      .from(userPromptSettings)
      .where(
        and(
          eq(userPromptSettings.id, id),
          eq(userPromptSettings.userId, userId),
          eq(userPromptSettings.type, type),
        ),
      )
      .limit(1)
    return rows.length > 0 ? toRow(rows[0]) : null
  }

  // 取指定 (user_id, type) 的所有历史版本摘要，按 version 倒序
  async listVersionsByUserAndType(
    userId: string,
    type: UserPromptType,
  ): Promise<UserPromptVersionSummary[]> {
    const rows = await db
      .select()
      .from(userPromptSettings)
      .where(
        and(
          eq(userPromptSettings.userId, userId),
          eq(userPromptSettings.type, type),
        ),
      )
      .orderBy(desc(userPromptSettings.version))
    return rows.map(toSummary)
  }

  // 取某用户所有 type 的当前生效版本（用于 GET /admin/users/:id/prompt-config 摘要）
  async listCurrentByUser(
    userId: string,
  ): Promise<UserPromptSettingsRow[]> {
    const rows = await db
      .select()
      .from(userPromptSettings)
      .where(
        and(
          eq(userPromptSettings.userId, userId),
          eq(userPromptSettings.isCurrent, true),
        ),
      )
    return rows.map(toRow)
  }

  // 单事务：保存新版本（旧 current 置 false + 插入新 current）
  // 返回新插入行的完整数据
  async saveVersionWithTx(input: {
    userId: string
    type: UserPromptType
    content: string
    note: string | null
    createdBy: string
  }): Promise<UserPromptSettingsRow> {
    return await db.transaction(async (tx) => {
      // 1. 计算新 version（同 user_id + type 内 MAX + 1）
      const maxRows = await tx
        .select({
          max: sql<number>`MAX(${userPromptSettings.version})`,
        })
        .from(userPromptSettings)
        .where(
          and(
            eq(userPromptSettings.userId, input.userId),
            eq(userPromptSettings.type, input.type),
          ),
        )
      const nextVersion = (maxRows[0]?.max ?? 0) + 1

      // 2. 旧 current 置 false
      await tx
        .update(userPromptSettings)
        .set({ isCurrent: false })
        .where(
          and(
            eq(userPromptSettings.userId, input.userId),
            eq(userPromptSettings.type, input.type),
            eq(userPromptSettings.isCurrent, true),
          ),
        )

      // 3. 插入新 current
      const inserted = await tx
        .insert(userPromptSettings)
        .values({
          userId: input.userId,
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
}

export const userPromptSettingsRepository =
  new UserPromptSettingsRepository()
