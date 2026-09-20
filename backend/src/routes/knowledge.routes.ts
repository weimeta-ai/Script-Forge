// =============================================================================
// 知识库样本路由
// -----------------------------------------------------------------------------
// 4 个接口，权限分层：
//   GET    /knowledge/samples         admin   列表（分页 + genre/grade 过滤）
//   POST   /knowledge/samples/batch   admin   批量导入
//   DELETE /knowledge/samples/:id     admin   软删
//   GET    /knowledge/samples/search  user    检索（5e 评分引擎召回用）
//
// 设计要点：
//   - 每个路由单独挂中间件（避免 use('/samples/*') 把 search 也强制 admin）
//   - search 路由必须注册在 :id 之前（防路径冲突，虽然方法不同一般不会冲突）
// =============================================================================

import { Hono } from 'hono'
import { requireAuth, requireRole } from '../middlewares/auth.middleware'
import { ok, noContent } from '../lib/response'
import { badRequest } from '../lib/errors'
import {
  batchImportSchema,
  listKnowledgeQuerySchema,
  searchKnowledgeQuerySchema,
} from '../schemas/knowledge.schema'
import {
  listSamples,
  batchImport,
  deleteSample,
  searchSamples,
} from '../services/knowledge.service'

export const knowledgeRoutes = new Hono()

// -----------------------------------------------------------------------------
// GET /knowledge/samples — 列表（admin only）
// -----------------------------------------------------------------------------
knowledgeRoutes.get('/samples', requireAuth, requireRole('admin'), async (c) => {
  const parsed = listKnowledgeQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '查询参数错误'
    )
  }
  const result = await listSamples(parsed.data)
  return ok(c, result)
})

// -----------------------------------------------------------------------------
// POST /knowledge/samples/batch — 批量导入（admin only）
// -----------------------------------------------------------------------------
knowledgeRoutes.post('/samples/batch', requireAuth, requireRole('admin'), async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) {
    throw badRequest('INVALID_BODY', '请求体不是合法 JSON')
  }

  const parsed = batchImportSchema.safeParse(body)
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '参数错误'
    )
  }

  const result = await batchImport(parsed.data)
  return ok(c, result, 201)
})

// -----------------------------------------------------------------------------
// GET /knowledge/samples/search — 检索（登录用户即可，5e 评分引擎用）
// 注意：必须注册在 DELETE /:id 之前（虽然方法不同，但显式路径优先）
// -----------------------------------------------------------------------------
knowledgeRoutes.get('/samples/search', requireAuth, async (c) => {
  const parsed = searchKnowledgeQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '查询参数错误'
    )
  }
  const result = await searchSamples(parsed.data)
  return ok(c, result)
})

// -----------------------------------------------------------------------------
// GET /knowledge/samples/browse — 浏览可选锚点（登录用户，6 阶段锚点手选用）
// 与 /search 的区别：genre 可选（用于跨题材浏览），分页参数对齐 list
// 默认按 overallScore desc 排序（高分样本优先展示）
// -----------------------------------------------------------------------------
knowledgeRoutes.get('/samples/browse', requireAuth, async (c) => {
  const parsed = listKnowledgeQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '查询参数错误'
    )
  }
  const result = await listSamples(parsed.data)
  return ok(c, result)
})

// -----------------------------------------------------------------------------
// DELETE /knowledge/samples/:id — 软删（admin only）
// -----------------------------------------------------------------------------
knowledgeRoutes.delete('/samples/:id', requireAuth, requireRole('admin'), async (c) => {
  const id = c.req.param('id')
  if (!id) {
    throw badRequest('VALIDATION_ERROR', '缺少样本 id')
  }
  await deleteSample(id)
  return noContent(c)
})
