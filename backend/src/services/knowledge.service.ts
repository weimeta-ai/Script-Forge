// =============================================================================
// 知识库样本业务服务层
// -----------------------------------------------------------------------------
// 职责：
//   - listSamples     admin 列表（分页 + genre/grade 过滤）
//   - batchImport     批量导入（事务包装，保证原子性）
//   - deleteSample    软删（不存在抛 notFound）
//   - searchSamples   5e 召回接口（普通用户可调）
//
// 错误处理：复用 lib/errors.ts 工厂（5b 教训：throw 普通对象不被 onError 捕获）
// =============================================================================

import { db } from '../db/client'
import { knowledgeSamples } from '../db/schema'
import { knowledgeRepository } from '../repositories/knowledge.repository'
import { notFound } from '../lib/errors'
import type {
  BatchImportInput,
  ListKnowledgeQuery,
  SearchKnowledgeQuery,
} from '../schemas/knowledge.schema'

// admin: 列表查询
export async function listSamples(query: ListKnowledgeQuery) {
  const offset = (query.page - 1) * query.pageSize
  const [items, total] = await Promise.all([
    knowledgeRepository.list({
      genre: query.genre,
      grade: query.grade,
      offset,
      limit: query.pageSize,
    }),
    knowledgeRepository.count({ genre: query.genre, grade: query.grade }),
  ])
  return { items, total }
}

// admin: 批量导入（事务包装）
export async function batchImport(input: BatchImportInput) {
  const rows = await db.transaction(async (tx) => {
    // 事务内直接调 tx.insert，不走 repository（repository 内部用全局 db）
    if (input.samples.length === 0) return []
    // Drizzle decimal 列在 TS 层是 string（与 PG numeric 序列化对齐）
    // 用户提交 number 更自然，这里统一转 string
    const rows = input.samples.map((s) => ({
      title: s.title,
      genre: s.genre,
      grade: s.grade,
      summary: s.summary,
      overallScore: s.overallScore !== undefined ? String(s.overallScore) : null,
      sixDimensions: s.sixDimensions ?? null,
      highlights: s.highlights ?? [],
    }))
    return tx.insert(knowledgeSamples).values(rows).returning()
  })
  return { inserted: rows.length }
}

// admin: 软删（不存在抛 notFound）
export async function deleteSample(id: string) {
  const ok = await knowledgeRepository.softDelete(id)
  if (!ok) {
    throw notFound('知识库样本')
  }
}

// user: 检索（5e 评分引擎召回锚点用）
export async function searchSamples(query: SearchKnowledgeQuery) {
  return knowledgeRepository.search({
    genre: query.genre,
    grade: query.grade,
    limit: query.limit,
  })
}
