// =============================================================================
// 积分规则管理路由（admin only）
// -----------------------------------------------------------------------------
// 端点（挂在 /api/admin/credit-rules 下）：
//   GET    /           列出所有规则
//   POST   /           创建规则
//   PATCH  /:id        更新规则
//   DELETE /:id        删除规则
// =============================================================================

import { Hono } from 'hono'
import { requireAuth, requireRole } from '../middlewares/auth.middleware'
import { ok, noContent } from '../lib/response'
import { badRequest, notFound, conflict } from '../lib/errors'
import type { AppJwtPayload } from '../lib/jwt'
import { createRuleSchema, updateRuleSchema } from '../schemas/credit.schema'
import { creditRuleRepository } from '../repositories/credit-rule.repository'

export const adminCreditRulesRoutes = new Hono<{
  Variables: { user: AppJwtPayload }
}>()

adminCreditRulesRoutes.use('*', requireAuth, requireRole('admin'))

// GET / — 列表
adminCreditRulesRoutes.get('/', async (c) => {
  const items = await creditRuleRepository.listAll()
  return ok(c, { items })
})

// POST / — 创建
adminCreditRulesRoutes.post('/', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) {
    throw badRequest('INVALID_BODY', '请求体不是合法 JSON')
  }
  const parsed = createRuleSchema.safeParse(body)
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '参数错误',
    )
  }

  // code 唯一约束兜底
  const existing = await creditRuleRepository.findByCode(parsed.data.code)
  if (existing) {
    throw conflict('RULE_CODE_TAKEN', '规则代码已存在')
  }

  const rule = await creditRuleRepository.create(parsed.data)
  return ok(c, rule, 201)
})

// PATCH /:id — 更新
adminCreditRulesRoutes.patch('/:id', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) {
    throw badRequest('INVALID_BODY', '请求体不是合法 JSON')
  }
  const parsed = updateRuleSchema.safeParse(body)
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '参数错误',
    )
  }

  // code 改动时检查唯一性
  if (parsed.data.code) {
    const existing = await creditRuleRepository.findByCode(parsed.data.code)
    if (existing && existing.id !== c.req.param('id')) {
      throw conflict('RULE_CODE_TAKEN', '规则代码已被其他规则占用')
    }
  }

  const updated = await creditRuleRepository.update(c.req.param('id'), parsed.data)
  if (!updated) {
    throw notFound('积分规则')
  }
  return ok(c, updated)
})

// DELETE /:id — 删除
adminCreditRulesRoutes.delete('/:id', async (c) => {
  await creditRuleRepository.deleteById(c.req.param('id'))
  return noContent(c)
})
