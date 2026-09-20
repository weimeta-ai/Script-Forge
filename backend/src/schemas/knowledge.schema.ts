// =============================================================================
// 知识库样本请求体校验（Zod）
// -----------------------------------------------------------------------------
// 关键约束：
//   - summary ≥120 字：评估口径要求每个最小分析单元正文 ≥120 字
//     （参考 commercial-evaluation.v1.md）
//   - 单批最多 500 条：避免长事务锁表（db pool max=20）
//   - grade 仅 A/B/C/D：与 analyses.grade 对齐
// =============================================================================

import { z } from 'zod'

// 单条样本校验
const knowledgeSampleSchema = z.object({
  title: z
    .string({ error: '标题不能为空' })
    .min(1, '标题不能为空')
    .max(255, '标题最长 255 字符'),
  genre: z
    .string({ error: '题材不能为空' })
    .min(1, '题材不能为空')
    .max(64, '题材最长 64 字符'),
  grade: z.enum(['A', 'B', 'C', 'D'], {
    error: '评级必须是 A/B/C/D 之一',
  }),
  overallScore: z.number().min(0).max(100).optional(),
  sixDimensions: z.record(z.string(), z.number()).optional(),
  summary: z
    .string({ error: '摘要不能为空' })
    .min(120, '摘要至少 120 字（LLM few-shot 需要足够上下文）')
    .max(5000, '摘要最长 5000 字'),
  highlights: z.array(z.string()).max(20, '亮点最多 20 条').optional(),
})

// 批量导入请求体
export const batchImportSchema = z.object({
  samples: z
    .array(knowledgeSampleSchema)
    .min(1, '至少导入 1 条样本')
    .max(500, '单批最多 500 条（事务压力考虑）'),
})

// 列表查询参数（admin 用）
export const listKnowledgeQuerySchema = z.object({
  genre: z.string().max(64).optional(),
  grade: z.enum(['A', 'B', 'C', 'D']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

// 检索查询参数（5e 评分引擎用，普通用户可调）
export const searchKnowledgeQuerySchema = z.object({
  genre: z.string({ error: 'genre 参数必填' }).max(64),
  grade: z.enum(['A', 'B', 'C', 'D']).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(5),
})

export type BatchImportInput = z.infer<typeof batchImportSchema>
export type ListKnowledgeQuery = z.infer<typeof listKnowledgeQuerySchema>
export type SearchKnowledgeQuery = z.infer<typeof searchKnowledgeQuerySchema>
export type KnowledgeSampleInput = z.infer<typeof knowledgeSampleSchema>
