// =============================================================================
// 阿里云 OSS 图床配置路由（admin only）
// -----------------------------------------------------------------------------
// 5 个接口：
//   GET   /oss-config              admin   读取当前配置（脱敏）+ env 兜底
//   PUT   /oss-config              admin   更新配置（UPSERT）
//   POST  /oss-config/test         admin   测试连接（不写 DB）
//   POST  /oss-config/upload-by-url  admin 远程 URL 转存（AI 图片持久化核心）
//   POST  /oss-config/upload       admin   multipart 上传（预留扩展，本期不实现）
// =============================================================================

import { Hono } from 'hono'
import { requireAuth, requireRole } from '../middlewares/auth.middleware'
import { ok } from '../lib/response'
import { badRequest } from '../lib/errors'
import {
  updateOssConfigSchema,
  testOssConfigSchema,
  uploadByUrlSchema,
} from '../schemas/oss-config.schema'
import {
  getMaskedOssConfig,
  updateOssConfig,
  testOssConnection,
  uploadImageFromUrl,
} from '../services/oss-config.service'

export const ossConfigRoutes = new Hono()

// GET /oss-config — 读取当前配置（脱敏）+ env 兜底
ossConfigRoutes.get('/', requireAuth, requireRole('admin'), async (c) => {
  const config = await getMaskedOssConfig()
  return ok(c, {
    current: config,
    fallback: {
      provider: process.env.OSS_PROVIDER === 'minio' ? ('minio' as const) : ('aliyun' as const),
      accessKeyId: process.env.OSS_ACCESS_KEY_ID ?? '',
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET ?? '',
      region: process.env.OSS_REGION ?? '',
      bucket: process.env.OSS_BUCKET ?? '',
      endpoint: process.env.OSS_ENDPOINT ?? '',
      customDomain: process.env.OSS_CUSTOM_DOMAIN ?? '',
      pathPrefix: process.env.OSS_PATH_PREFIX ?? 'drama/images',
      timeoutMs: Number(process.env.OSS_TIMEOUT_MS ?? 60000),
    },
    // 当前生效的存储模式（DB 未配置时取 env）
    provider: (config?.provider === 'minio' ? 'minio' : 'aliyun-oss') as 'aliyun-oss' | 'minio',
  })
})

// PUT /oss-config — 更新配置（UPSERT）
ossConfigRoutes.put('/', requireAuth, requireRole('admin'), async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) {
    throw badRequest('INVALID_BODY', '请求体不是合法 JSON')
  }

  const parsed = updateOssConfigSchema.safeParse(body)
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '参数错误',
    )
  }

  const updated = await updateOssConfig(parsed.data)
  return ok(c, updated)
})

// POST /oss-config/test — 测试连接（不写 DB）
ossConfigRoutes.post('/test', requireAuth, requireRole('admin'), async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const parsed = testOssConfigSchema.safeParse(body ?? {})
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '参数错误',
    )
  }

  const result = await testOssConnection(parsed.data)
  return ok(c, result)
})

// POST /oss-config/upload-by-url — 远程 URL 转存到 OSS（核心：AI 图片持久化）
ossConfigRoutes.post('/upload-by-url', requireAuth, requireRole('admin'), async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) {
    throw badRequest('INVALID_BODY', '请求体不是合法 JSON')
  }

  const parsed = uploadByUrlSchema.safeParse(body)
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '参数错误',
    )
  }

  const result = await uploadImageFromUrl(parsed.data)
  return ok(c, result)
})
