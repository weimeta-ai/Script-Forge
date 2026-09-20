// =============================================================================
// 知识库样本 Repository
// -----------------------------------------------------------------------------
// 全局共享数据（无 userId 归属），admin 维护
// 关键设计：
//   - count 用 SELECT count(*) 单独实现，不复用 BaseRepository.count（性能）
//   - createBatch 直接调 Drizzle 批量 insert（postgres 驱动自动分片）
//   - 软删走 isActive=false（与 projects.status='deleted' 不同，因为没有业务状态机）
// =============================================================================

import { eq, and, sql, desc, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { knowledgeSamples, type KnowledgeSample } from '../db/schema'

class KnowledgeRepository {
  // 列表查询（分页 + genre/grade 过滤，admin 用）
  async list(opts: {
    genre?: string
    grade?: string
    offset: number
    limit: number
  }): Promise<KnowledgeSample[]> {
    const conditions = [eq(knowledgeSamples.isActive, true)]
    if (opts.genre) conditions.push(eq(knowledgeSamples.genre, opts.genre))
    if (opts.grade) conditions.push(eq(knowledgeSamples.grade, opts.grade))

    return db
      .select()
      .from(knowledgeSamples)
      .where(and(...conditions))
      .orderBy(desc(knowledgeSamples.createdAt))
      .limit(opts.limit)
      .offset(opts.offset)
  }

  // 统计符合条件的总数（独立 SELECT count(*)，不复用 BaseRepository.count）
  async count(opts: { genre?: string; grade?: string }): Promise<number> {
    const conditions = [eq(knowledgeSamples.isActive, true)]
    if (opts.genre) conditions.push(eq(knowledgeSamples.genre, opts.genre))
    if (opts.grade) conditions.push(eq(knowledgeSamples.grade, opts.grade))

    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(knowledgeSamples)
      .where(and(...conditions))
    return result[0]?.count ?? 0
  }

  // 软删（isActive=false）
  async softDelete(id: string): Promise<boolean> {
    const rows = await db
      .update(knowledgeSamples)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(knowledgeSamples.id, id), eq(knowledgeSamples.isActive, true)))
      .returning()
    return rows.length > 0
  }

  // 检索（5e 评分引擎用，按 genre + grade? 召回 N 条）
  async search(opts: {
    genre: string
    grade?: string
    limit: number
  }): Promise<KnowledgeSample[]> {
    const conditions = [
      eq(knowledgeSamples.genre, opts.genre),
      eq(knowledgeSamples.isActive, true),
    ]
    if (opts.grade) conditions.push(eq(knowledgeSamples.grade, opts.grade))

    // 按 overallScore desc 优先返回高分样本
    return db
      .select()
      .from(knowledgeSamples)
      .where(and(...conditions))
      .orderBy(desc(knowledgeSamples.overallScore))
      .limit(opts.limit)
  }

  // 按 ID 列表批量查询（6 阶段：用户手选锚点后，worker 用此方法 override 自动召回）
  async findByIds(ids: string[]): Promise<KnowledgeSample[]> {
    if (ids.length === 0) return []
    return db
      .select()
      .from(knowledgeSamples)
      .where(
        and(
          inArray(knowledgeSamples.id, ids),
          eq(knowledgeSamples.isActive, true),
        ),
      )
      .orderBy(desc(knowledgeSamples.overallScore))
  }
}

// 单例导出
export const knowledgeRepository = new KnowledgeRepository()
