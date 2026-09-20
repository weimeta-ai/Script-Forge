// =============================================================================
// 图片模型配置路由（admin only）
// -----------------------------------------------------------------------------
// 4 个接口：
//   GET   /image-config          admin   读取当前配置（脱敏）+ env 兜底
//   PUT   /image-config          admin   更新配置（UPSERT）
//   POST  /image-config/test     admin   测试连接（不写 DB）
//   POST  /image-config/generate user    生成图片（所有登录用户可用）
//
// 注意：generate 接口未限制 admin（业务用户需生成封面），
//       但需要 requireAuth 保证登录态
// =============================================================================

import { Hono } from 'hono'
import { requireAuth, requireRole } from '../middlewares/auth.middleware'
import { ok } from '../lib/response'
import { badRequest } from '../lib/errors'
import {
  updateImageConfigSchema,
  testImageConfigSchema,
  generateImageSchema,
} from '../schemas/image-config.schema'
import {
  getMaskedImageConfig,
  updateImageConfig,
  testImageConnection,
  generateImage,
} from '../services/image-config.service'

export const imageConfigRoutes = new Hono()

// GET /image-config — 读取当前配置（脱敏）+ env 兜底
imageConfigRoutes.get('/', requireAuth, requireRole('admin'), async (c) => {
  const config = await getMaskedImageConfig()
  return ok(c, {
    current: config,
    fallback: {
      model: process.env.IMAGE_MODEL ?? '',
      baseUrl: process.env.IMAGE_BASE_URL ?? '',
      provider: process.env.IMAGE_PROVIDER ?? '',
      timeoutMs: Number(process.env.IMAGE_TIMEOUT_MS ?? 120000),
    },
    apiFormat: 'openai-image' as const,
  })
})

// PUT /image-config — 更新配置（UPSERT）
imageConfigRoutes.put('/', requireAuth, requireRole('admin'), async (c) => {
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

  const updated = await updateImageConfig(parsed.data)
  return ok(c, updated)
})

// POST /image-config/test — 测试连接（不写 DB）
imageConfigRoutes.post('/test', requireAuth, requireRole('admin'), async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const parsed = testImageConfigSchema.safeParse(body ?? {})
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '参数错误',
    )
  }

  const result = await testImageConnection(parsed.data)
  return ok(c, result)
})

// POST /image-config/generate — 生成图片（登录用户可用，用于封面生成）
imageConfigRoutes.post('/generate', requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) {
    throw badRequest('INVALID_BODY', '请求体不是合法 JSON')
  }

  const parsed = generateImageSchema.safeParse(body)
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '参数错误',
    )
  }

  const result = await generateImage(parsed.data)
  return ok(c, result)
})
