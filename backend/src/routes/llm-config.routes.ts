// =============================================================================
// LLM 配置路由（admin only）
// -----------------------------------------------------------------------------
// 3 个接口：
//   GET  /llm-config          admin   读取当前配置（脱敏）
//   PUT  /llm-config          admin   更新配置（UPSERT）
//   POST /llm-config/test     admin   测试连接（不发 DB 写）
//
// 设计要点：
//   - 全部 requireRole('admin')：LLM Key 是敏感资源，仅运维可改
//   - 路径前缀 /llm-config（注册在 app.ts 时 app.route('/llm-config', ...)）
//   - 测试连接返回 latencyMs + modelEcho，前端展示「连接成功，延时 230ms」
// =============================================================================

import { Hono } from 'hono'
import { requireAuth, requireRole } from '../middlewares/auth.middleware'
import { ok } from '../lib/response'
import { badRequest } from '../lib/errors'
import {
  updateLlmConfigSchema,
  testLlmConfigSchema,
} from '../schemas/llm-config.schema'
import {
  getMaskedLlmConfig,
  updateLlmConfig,
  testLlmConnection,
} from '../services/llm-config.service'

export const llmConfigRoutes = new Hono()

// -----------------------------------------------------------------------------
// GET /llm-config — 读取当前配置（脱敏）
// 返回 null 表示 DB 无配置，前端展示「使用 env 默认值」
// -----------------------------------------------------------------------------
llmConfigRoutes.get('/', requireAuth, requireRole('admin'), async (c) => {
  const config = await getMaskedLlmConfig()
  // 同时返回 env 的默认值（前端展示「未配置时使用」的兜底）
  return ok(c, {
    current: config, // null | { name, apiKeyMasked, model, baseUrl, apiFormat, timeoutMs, updatedAt, hasApiKey }
    fallback: {
      // 仅展示用，不暴露 key
      model: process.env.LLM_MODEL ?? '',
      baseUrl: process.env.LLM_BASE_URL ?? '',
      provider: process.env.LLM_PROVIDER ?? '',
      timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 90000),
    },
    // 当前生效的协议格式（DB 无配置时默认 openai）
    apiFormat: config?.apiFormat ?? 'openai',
  })
})

// -----------------------------------------------------------------------------
// PUT /llm-config — 更新配置（UPSERT）
// -----------------------------------------------------------------------------
llmConfigRoutes.put('/', requireAuth, requireRole('admin'), async (c) => {
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

  const updated = await updateLlmConfig(parsed.data)
  return ok(c, updated)
})

// -----------------------------------------------------------------------------
// POST /llm-config/test — 测试连接（不写 DB）
// 请求体可选：{ apiKey?, baseUrl?, model? }（缺失字段从 DB / env 兜底）
// -----------------------------------------------------------------------------
llmConfigRoutes.post('/test', requireAuth, requireRole('admin'), async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const parsed = testLlmConfigSchema.safeParse(body ?? {})
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '参数错误',
    )
  }

  const result = await testLlmConnection(parsed.data)
  return ok(c, result)
})
