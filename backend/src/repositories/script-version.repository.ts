// 剧本版本 Repository（p00 同款简化）
// =============================================================================

import { eq, and } from 'drizzle-orm'
import { db } from '../db/client'
import { scriptVersions } from '../db/schema'
import type { ScoreDetails } from '../db/schema/script-versions'

class ScriptVersionRepository {
  // 查剧本的当前生效版本（isCurrent=true，p00 同款）
  async findCurrentByScriptId(scriptId: string) {
    const rows = await db
      .select()
      .from(scriptVersions)
      .where(
        and(eq(scriptVersions.scriptId, scriptId), eq(scriptVersions.isCurrent, true)),
      )
      .limit(1)
    return rows[0] ?? null
  }

  // 按 id 查（worker 内部用）
  async findById(id: string) {
    const rows = await db
      .select()
      .from(scriptVersions)
      .where(eq(scriptVersions.id, id))
      .limit(1)
    return rows[0] ?? null
  }

  // 写评分结果（worker 完成后调用，对齐 p00 scoreDetails 结构）
  async updateScore(versionId: string, scoreDetails: ScoreDetails) {
    await db
      .update(scriptVersions)
      .set({ scoreDetails })
      .where(eq(scriptVersions.id, versionId))
  }

  // 创建版本（创建剧本时同步插入 V1）
  async create(data: {
    scriptId: string
    versionNo?: number
    content: string
    isCurrent?: boolean
  }) {
    const rows = await db
      .insert(scriptVersions)
      .values({
        scriptId: data.scriptId,
        versionNo: data.versionNo ?? 1,
        content: data.content,
        isCurrent: data.isCurrent ?? true,
      })
      .returning()
    return rows[0]
  }
}

export const scriptVersionRepository = new ScriptVersionRepository()
