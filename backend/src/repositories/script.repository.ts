// 剧本 Repository（p00 同款简化）
// -----------------------------------------------------------------------------
// 重构说明：
//   - 删除 listByProjectId（无项目概念）
//   - 新增 listByUserId（p00 同款：列出当前用户的所有剧本）
//   - 删除 updateStageStatus / updateCurrentStage（5 阶段流水线废弃，事件流改在 tasks.events）
// =============================================================================

import { eq, and, ne, desc, sql } from 'drizzle-orm'
import { db } from '../db/client'
import {
  scripts,
  scriptVersions,
  tasks,
  type Script,
  type NewScript,
  type ScoreDetails,
} from '../db/schema'

// 最近一次 analyze 任务（用于历史卡片识别 canceled/error 终态）
export interface LastTaskInfo {
  id: string
  status: string
  mode: string
}

// 列表查询返回的精简类型（不含 sourceContent 大字段，但附带最新版本的 score/grade/durationMs）
export type ScriptListItem = Omit<Script, 'sourceContent'> & {
  scoreDetails: ScoreDetails | null
  lastTask: LastTaskInfo | null
}

class ScriptRepository {
  // 列表：列出当前用户的所有非软删剧本 + JOIN 最新版本的 scoreDetails
  // 附带最近一次任务的 id/status/mode（让前端 History 卡片识别 canceled/error 终态）
  async listByUserId(userId: string): Promise<ScriptListItem[]> {
    const rows = await db
      .select({
        id: scripts.id,
        userId: scripts.userId,
        title: scripts.title,
        genre: scripts.genre,
        fileName: scripts.fileName,
        wordCount: scripts.wordCount,
        status: scripts.status,
        coverUrl: scripts.coverUrl,
        createdAt: scripts.createdAt,
        updatedAt: scripts.updatedAt,
        scoreDetails: scriptVersions.scoreDetails,
        // 相关子查询：取该剧本最近一条 task（任意 type）的状态
        // Why：History 卡片需要据此区分「已停止」「分析失败」终态并屏蔽详情入口
        lastTaskId: sql<string | null>`(
          SELECT t.id FROM ${tasks} t
          WHERE t.script_id = ${scripts.id}
          ORDER BY t.created_at DESC
          LIMIT 1
        )`.as('last_task_id'),
        lastTaskStatus: sql<string | null>`(
          SELECT t.status FROM ${tasks} t
          WHERE t.script_id = ${scripts.id}
          ORDER BY t.created_at DESC
          LIMIT 1
        )`.as('last_task_status'),
        lastTaskMode: sql<string | null>`(
          SELECT t.mode FROM ${tasks} t
          WHERE t.script_id = ${scripts.id}
          ORDER BY t.created_at DESC
          LIMIT 1
        )`.as('last_task_mode'),
      })
      .from(scripts)
      .leftJoin(
        scriptVersions,
        and(
          eq(scriptVersions.scriptId, scripts.id),
          eq(scriptVersions.isCurrent, true),
        ),
      )
      .where(and(eq(scripts.userId, userId), ne(scripts.status, 'deleted')))
      .orderBy(desc(scripts.createdAt))

    // 把三个标量子查询字段组装为嵌套对象，对齐 ScriptListItem 类型
    return rows.map(({ lastTaskId, lastTaskStatus, lastTaskMode, ...rest }) => ({
      ...rest,
      lastTask:
        lastTaskId && lastTaskStatus && lastTaskMode
          ? { id: lastTaskId, status: lastTaskStatus, mode: lastTaskMode }
          : null,
    })) as ScriptListItem[]
  }

  // 详情（含 sourceContent）
  async findById(id: string): Promise<Script | null> {
    const rows = await db
      .select()
      .from(scripts)
      .where(and(eq(scripts.id, id), ne(scripts.status, 'deleted')))
      .limit(1)
    return rows[0] ?? null
  }

  // 创建
  async create(data: NewScript): Promise<Script> {
    const rows = await db.insert(scripts).values(data).returning()
    return rows[0]
  }

  // 软删
  async softDelete(id: string): Promise<boolean> {
    const rows = await db
      .update(scripts)
      .set({ status: 'deleted', updatedAt: new Date() })
      .where(and(eq(scripts.id, id), ne(scripts.status, 'deleted')))
      .returning()
    return rows.length > 0
  }
}

export const scriptRepository = new ScriptRepository()
