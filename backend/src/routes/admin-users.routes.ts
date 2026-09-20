// =============================================================================
// 用户管理路由（admin only）
// -----------------------------------------------------------------------------
// 端点（挂在 /api/admin/users 下）：
//   GET    /                       列表（带统计 + 筛选 + 分页）
//   POST   /                       创建用户
//   GET    /:id                    详情（含配置 + 统计）
//   PATCH  /:id                    编辑（displayName/role/status/password/credit）
//   GET    /:id/llm-config         读取用户 LLM 配置（脱敏）
//   PUT    /:id/llm-config         UPSERT
//   POST   /:id/llm-config/test    测试连接
//   GET    /:id/image-config       读取用户图片配置（脱敏）
//   PUT    /:id/image-config       UPSERT
//   POST   /:id/image-config/test  测试连接
//   GET    /:id/prompt-config                摘要（所有 type 当前版本）
//   GET    /:id/prompt-config/:type          详情（当前 + 历史列表）
//   GET    /:id/prompt-config/:type/versions/:versionId  单版本完整 content
//   PUT    /:id/prompt-config/:type          保存新版本（含校验）
//   POST   /:id/prompt-config/:type/rollback/:versionId 回滚
//   POST   /:id/prompt-config/copy-template  从全局模板复制（body: { type }）
//   POST   /:id/copy-template      从全局模板复制 LLM + 图片配置
// =============================================================================

import { Hono } from 'hono'
import { requireAuth, requireRole } from '../middlewares/auth.middleware'
import { ok } from '../lib/response'
import { badRequest } from '../lib/errors'
import type { AppJwtPayload } from '../lib/jwt'
import {
  listUsersQuerySchema,
  createUserSchema,
  updateUserSchema,
} from '../schemas/admin-user.schema'
import {
  updateLlmConfigSchema,
  testLlmConfigSchema,
} from '../schemas/llm-config.schema'
import {
  updateImageConfigSchema,
  testImageConfigSchema,
} from '../schemas/image-config.schema'
import {
  adjustCreditsSchema,
  listTransactionsQuerySchema,
} from '../schemas/credit.schema'
import {
  savePromptSchema,
  isValidPromptType,
} from '../schemas/prompt-config.schema'
import * as adminUserService from '../services/admin-user.service'
import * as userLlmConfigService from '../services/user-llm-config.service'
import * as userImageConfigService from '../services/user-image-config.service'
import * as userPromptConfigService from '../services/user-prompt-config.service'
import * as creditService from '../services/credit.service'

export const adminUserRoutes = new Hono<{
  Variables: { user: AppJwtPayload }
}>()

// 所有路由统一走 requireAuth + requireRole('admin')
adminUserRoutes.use('*', requireAuth, requireRole('admin'))

// -----------------------------------------------------------------------------
// 列表 + 创建
// -----------------------------------------------------------------------------

// GET /admin/users — 列表（统计聚合 + 筛选 + 分页）
adminUserRoutes.get('/', async (c) => {
  const parsed = listUsersQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '参数错误',
    )
  }
  const result = await adminUserService.listUsers(parsed.data)
  return ok(c, result)
})

// POST /admin/users — 创建用户
adminUserRoutes.post('/', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) {
    throw badRequest('INVALID_BODY', '请求体不是合法 JSON')
  }
  const parsed = createUserSchema.safeParse(body)
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '参数错误',
    )
  }
  const created = await adminUserService.createUser(parsed.data)
  return ok(c, created, 201)
})

// -----------------------------------------------------------------------------
// 单用户详情 + 编辑
// -----------------------------------------------------------------------------

// GET /admin/users/:id — 详情
adminUserRoutes.get('/:id', async (c) => {
  const detail = await adminUserService.getUserDetail(c.req.param('id'))
  return ok(c, detail)
})

// PATCH /admin/users/:id — 编辑
adminUserRoutes.patch('/:id', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) {
    throw badRequest('INVALID_BODY', '请求体不是合法 JSON')
  }
  const parsed = updateUserSchema.safeParse(body)
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '参数错误',
    )
  }
  const updated = await adminUserService.updateUser(c.req.param('id'), parsed.data)
  return ok(c, updated)
})

// -----------------------------------------------------------------------------
// 用户积分（admin 调整 + 流水查询）
// -----------------------------------------------------------------------------

// POST /admin/users/:id/credits/adjust — 调整积分（充值/扣减，强制写流水审计）
adminUserRoutes.post('/:id/credits/adjust', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) {
    throw badRequest('INVALID_BODY', '请求体不是合法 JSON')
  }
  const parsed = adjustCreditsSchema.safeParse(body)
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '参数错误',
    )
  }
  const admin = c.get('user') as AppJwtPayload
  const result = await creditService.adjustCredits({
    userId: c.req.param('id'),
    delta: parsed.data.delta,
    remark: parsed.data.remark,
    adminId: admin.userId,
    category: parsed.data.category,
  })
  return ok(c, result)
})

// GET /admin/users/:id/credits/transactions — 流水（支持 type / refTaskId / 分页）
adminUserRoutes.get('/:id/credits/transactions', async (c) => {
  const parsed = listTransactionsQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '参数错误',
    )
  }
  const result = await creditService.listUserTransactions(
    c.req.param('id'),
    parsed.data,
  )
  return ok(c, result)
})

// -----------------------------------------------------------------------------
// 用户级 LLM 配置
// -----------------------------------------------------------------------------

// GET /:id/llm-config
adminUserRoutes.get('/:id/llm-config', async (c) => {
  const config = await userLlmConfigService.getMaskedByUser(c.req.param('id'))
  return ok(c, { config })
})

// PUT /:id/llm-config
adminUserRoutes.put('/:id/llm-config', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) {
    throw badRequest('INVALID_BODY', '请求体不是合法 JSON')
  }
  const parsed = updateLlmConfigSchema.safeParse(body)
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '参数错误',
    )
  }
  const updated = await userLlmConfigService.upsertByUser(
    c.req.param('id'),
    parsed.data,
  )
  return ok(c, updated)
})

// POST /:id/llm-config/test
adminUserRoutes.post('/:id/llm-config/test', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const parsed = testLlmConfigSchema.safeParse(body ?? {})
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '参数错误',
    )
  }
  const result = await userLlmConfigService.testByUser(c.req.param('id'), parsed.data)
  return ok(c, result)
})

// -----------------------------------------------------------------------------
// 用户级 图片模型配置
// -----------------------------------------------------------------------------

// GET /:id/image-config
adminUserRoutes.get('/:id/image-config', async (c) => {
  const config = await userImageConfigService.getMaskedByUser(c.req.param('id'))
  return ok(c, { config })
})

// PUT /:id/image-config
adminUserRoutes.put('/:id/image-config', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) {
    throw badRequest('INVALID_BODY', '请求体不是合法 JSON')
  }
  const parsed = updateImageConfigSchema.safeParse(body)
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '参数错误',
    )
  }
  const updated = await userImageConfigService.upsertByUser(
    c.req.param('id'),
    parsed.data,
  )
  return ok(c, updated)
})

// POST /:id/image-config/test
adminUserRoutes.post('/:id/image-config/test', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const parsed = testImageConfigSchema.safeParse(body ?? {})
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '参数错误',
    )
  }
  const result = await userImageConfigService.testByUser(c.req.param('id'), parsed.data)
  return ok(c, result)
})

// -----------------------------------------------------------------------------
// 用户级 Prompt 话术配置（admin 在用户详情下编辑）
// -----------------------------------------------------------------------------

// GET /:id/prompt-config - 摘要（所有 type 当前版本）
adminUserRoutes.get('/:id/prompt-config', async (c) => {
  const summary = await userPromptConfigService.getSummaryByUser(c.req.param('id'))
  return ok(c, { items: summary })
})

// GET /:id/prompt-config/copy-template 必须在 /:type 之前注册，避免 :type 抢占
// POST /:id/prompt-config/copy-template - 从全局模板复制指定 type 到用户级 v1
adminUserRoutes.post('/:id/prompt-config/copy-template', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.type || !isValidPromptType(body.type)) {
    throw badRequest('VALIDATION_ERROR', 'type 必须为 report_system 或 cover_template')
  }
  const admin = c.get('user') as AppJwtPayload
  const created = await userPromptConfigService.copyFromTemplate(
    c.req.param('id'),
    body.type,
    admin.username,
  )
  return ok(c, created, 201)
})

// GET /:id/prompt-config/:type - 当前完整 + 历史列表
adminUserRoutes.get('/:id/prompt-config/:type', async (c) => {
  const type = c.req.param('type')
  if (!isValidPromptType(type)) {
    throw badRequest('VALIDATION_ERROR', 'type 必须为 report_system 或 cover_template')
  }
  const detail = await userPromptConfigService.getDetailByUser(c.req.param('id'), type)
  return ok(c, detail)
})

// GET /:id/prompt-config/:type/versions/:versionId - 单版本完整 content
adminUserRoutes.get('/:id/prompt-config/:type/versions/:versionId', async (c) => {
  const type = c.req.param('type')
  if (!isValidPromptType(type)) {
    throw badRequest('VALIDATION_ERROR', 'type 必须为 report_system 或 cover_template')
  }
  const versionId = Number(c.req.param('versionId'))
  if (!Number.isInteger(versionId) || versionId <= 0) {
    throw badRequest('VALIDATION_ERROR', 'versionId 必须为正整数')
  }
  const content = await userPromptConfigService.getVersionContentByUser(
    c.req.param('id'),
    type,
    versionId,
  )
  return ok(c, content)
})

// PUT /:id/prompt-config/:type - 保存新版本（含校验，与全局话术口径一致）
adminUserRoutes.put('/:id/prompt-config/:type', async (c) => {
  const type = c.req.param('type')
  if (!isValidPromptType(type)) {
    throw badRequest('VALIDATION_ERROR', 'type 必须为 report_system 或 cover_template')
  }
  const body = await c.req.json().catch(() => null)
  if (!body) {
    throw badRequest('INVALID_BODY', '请求体不是合法 JSON')
  }
  const parsed = savePromptSchema.safeParse(body)
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '参数错误',
    )
  }
  const admin = c.get('user') as AppJwtPayload
  const saved = await userPromptConfigService.saveVersionByUser({
    userId: c.req.param('id'),
    type,
    content: parsed.data.content,
    note: parsed.data.note,
    createdBy: admin.username,
  })
  return ok(c, saved)
})

// POST /:id/prompt-config/:type/rollback/:versionId - 回滚到指定版本
adminUserRoutes.post('/:id/prompt-config/:type/rollback/:versionId', async (c) => {
  const type = c.req.param('type')
  if (!isValidPromptType(type)) {
    throw badRequest('VALIDATION_ERROR', 'type 必须为 report_system 或 cover_template')
  }
  const versionId = Number(c.req.param('versionId'))
  if (!Number.isInteger(versionId) || versionId <= 0) {
    throw badRequest('VALIDATION_ERROR', 'versionId 必须为正整数')
  }
  const admin = c.get('user') as AppJwtPayload
  const rolled = await userPromptConfigService.rollbackByUser({
    userId: c.req.param('id'),
    type,
    versionId,
    createdBy: admin.username,
  })
  return ok(c, rolled)
})

// -----------------------------------------------------------------------------
// 从全局模板复制配置（一键）
// -----------------------------------------------------------------------------

// POST /:id/copy-template
// body 可选 { llm?: boolean, image?: boolean }，默认两个都复制
adminUserRoutes.post('/:id/copy-template', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const wantLlm = body?.llm !== false
  const wantImage = body?.image !== false

  const results = await Promise.allSettled([
    wantLlm ? userLlmConfigService.copyFromTemplate(c.req.param('id')) : Promise.resolve(null),
    wantImage ? userImageConfigService.copyFromTemplate(c.req.param('id')) : Promise.resolve(null),
  ])

  // 任一失败抛错（但不影响已成功的那个）
  const failed = results.find((r) => r.status === 'rejected')
  if (failed && failed.status === 'rejected') {
    throw failed.reason
  }

  return ok(c, {
    llm: results[0].status === 'fulfilled' ? (results[0] as PromiseFulfilledResult<unknown>).value : null,
    image: results[1].status === 'fulfilled' ? (results[1] as PromiseFulfilledResult<unknown>).value : null,
  })
})
