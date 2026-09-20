// =============================================================================
// 图片模型配置业务服务层
// -----------------------------------------------------------------------------
// 职责：
//   - getEffectiveConfig  当前生效配置（DB > env）
//   - getMasked           给前端展示（脱敏 apiKey）
//   - update              UPSERT
//   - testConnection      用新/旧配置发一次轻量调用
//   - generate            生成图片（OpenAI Images API 兼容）
//
// 设计要点：
//   - env 不强制要求 IMAGE_* 变量（图片功能可选）
//   - 测试连接走 fetchImages with n=1（最便宜的调用）
//   - generate 返回图片 URL（可能是 data: base64 或 CDN URL）
//   - 不使用 OpenAI SDK：SDK 强类型化为 { data: [{ url }] }，
//     会丢失中转网关的非标准字段（如 { images: ["url"] }），
//     改用 fetch 直调 + extractImageUrls 多格式兼容。
// =============================================================================

import {
  imageSettingsRepository,
  type ImageSettingsMasked,
  type ImageSettingsPlain,
} from '../repositories/image-settings.repository'
import { maskApiKey } from '../repositories/llm-settings.repository'
import { BusinessError, extractUpstreamErrorMessage } from '../lib/errors'
import { normalizeBaseURL } from '../lib/llm-client'
import { logUsage } from './usage-log.service'
import * as userImageConfigService from './user-image-config.service'
import type {
  UpdateImageConfigInput,
  TestImageConfigInput,
  GenerateImageInput,
} from '../schemas/image-config.schema'

// env 兜底（图片功能可选，env 缺失时返回空字符串）
function getImageEnvFallback() {
  return {
    model: process.env.IMAGE_MODEL ?? '',
    baseUrl: process.env.IMAGE_BASE_URL ?? '',
    provider: process.env.IMAGE_PROVIDER ?? '',
    timeoutMs: Number(process.env.IMAGE_TIMEOUT_MS ?? 120000),
  }
}

export interface ImageEffectiveConfig {
  apiKey: string
  baseURL: string
  model: string
  timeoutMs: number
  defaultSize: string
  defaultCount: number
  source: 'db' | 'env'
  name?: string
}

// 获取当前生效配置（DB 优先，env 兜底）
// 注意：env 没有 apiKey 字段，如果 DB 没配置且 env 缺失，则 apiKey 为空
export async function getEffectiveImageConfig(): Promise<ImageEffectiveConfig> {
  const fromDb = await imageSettingsRepository.getPlain()
  if (fromDb) {
    return {
      apiKey: fromDb.apiKey,
      baseURL: fromDb.baseUrl,
      model: fromDb.model,
      timeoutMs: fromDb.timeoutMs,
      defaultSize: fromDb.defaultSize,
      defaultCount: fromDb.defaultCount,
      name: fromDb.name,
      source: 'db',
    }
  }
  const env = getImageEnvFallback()
  return {
    apiKey: process.env.IMAGE_API_KEY ?? '',
    baseURL: env.baseUrl,
    model: env.model,
    timeoutMs: env.timeoutMs,
    defaultSize: '1024x1024',
    defaultCount: 1,
    source: 'env',
  }
}

// 给前端展示用（脱敏）
export async function getMaskedImageConfig(): Promise<ImageSettingsMasked | null> {
  const plain = await imageSettingsRepository.getPlain()
  if (!plain) return null
  return toMasked(plain)
}

// 更新配置（UPSERT）
// apiKey 留空时沿用 DB 已存值（与 llm-config 一致）
export async function updateImageConfig(input: UpdateImageConfigInput) {
  const existing = await imageSettingsRepository.getPlain()
  let finalApiKey = input.apiKey
  if (!finalApiKey) {
    if (!existing) {
      throw new BusinessError(
        'IMAGE_API_KEY_REQUIRED',
        '首次保存必须提供 API Key',
        400,
      )
    }
    finalApiKey = existing.apiKey
  }

  const updated = await imageSettingsRepository.upsert({
    name: input.name,
    apiKey: finalApiKey,
    model: input.model,
    baseUrl: input.baseUrl,
    timeoutMs: input.timeoutMs,
    defaultSize: input.defaultSize,
    defaultCount: input.defaultCount,
  })
  return toMasked(updated)
}

// 测试连接：发一次 n=1 的图片生成调用
export async function testImageConnection(input: TestImageConfigInput): Promise<{
  ok: boolean
  latencyMs: number
  modelEcho: string
}> {
  let finalApiKey = input.apiKey
  let finalBaseUrl = input.baseUrl
  let finalModel = input.model

  if (!finalApiKey || !finalBaseUrl || !finalModel) {
    const effective = await getEffectiveImageConfig()
    finalApiKey = finalApiKey ?? effective.apiKey
    finalBaseUrl = finalBaseUrl ?? effective.baseURL
    finalModel = finalModel ?? effective.model
  }

  if (!finalApiKey) {
    throw new BusinessError('IMAGE_TEST_NO_API_KEY', '缺少 API Key，无法测试', 400)
  }
  if (!finalBaseUrl || !finalModel) {
    throw new BusinessError(
      'IMAGE_TEST_NO_CONFIG',
      '缺少 baseUrl 或 model，请先保存配置或传入测试参数',
      400,
    )
  }

  const normalizedBaseUrl = normalizeBaseURL(finalBaseUrl)
  const startedAt = Date.now()
  try {
    const result = await fetchImages({
      apiKey: finalApiKey,
      baseURL: normalizedBaseUrl,
      model: finalModel,
      // 极简 prompt：测试只需验证链路，不需要画质
      prompt: 'a dot',
      n: 1,
      size: '1024x1024',
      // 图像生成本身较慢（高质量模型 15-40s 常见），给到 60s
      timeoutMs: 60000,
    })
    if (result.images.length === 0) {
      throw new Error('响应未返回任何图片字段（既无 data[].url 也无 images[]）')
    }
    // 多数图片网关响应不返回 model 字段，直接用请求的 model 回显
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      modelEcho: finalModel,
    }
  } catch (e) {
    throw normalizeImageError(e, finalBaseUrl, normalizedBaseUrl, startedAt)
  }
}

// 生成图片
// userId/taskId/scriptId 业务路径必传，写 usage_log + per-user 配置
export async function generateImage(
  input: GenerateImageInput & {
    userId?: string
    taskId?: string
    scriptId?: string
    phase?: 'cover' | 'test'
  },
): Promise<{
  images: Array<{ url: string; revisedPrompt?: string }>
  model: string
  latencyMs: number
}> {
  // 配置解析：userId 优先走 per-user；否则 fallback 全局（admin 测试兼容）
  let apiKey: string
  let baseURL: string
  let model: string
  let timeoutMs: number
  let defaultSize: string
  let defaultCount: number

  if (input.userId) {
    const userConfig = await userImageConfigService.getEffectiveByUser(input.userId)
    apiKey = userConfig.apiKey
    baseURL = userConfig.baseURL
    model = userConfig.model
    timeoutMs = userConfig.timeoutMs
    defaultSize = userConfig.defaultSize
    defaultCount = userConfig.defaultCount
  } else {
    const effective = await getEffectiveImageConfig()
    if (!effective.apiKey) {
      throw new BusinessError(
        'IMAGE_NOT_CONFIGURED',
        '尚未配置图片模型，请先在管理后台保存 API Key',
        400,
      )
    }
    apiKey = effective.apiKey
    baseURL = effective.baseURL
    model = effective.model
    timeoutMs = effective.timeoutMs
    defaultSize = effective.defaultSize
    defaultCount = effective.defaultCount
  }

  const size = input.size ?? defaultSize
  const count = input.count ?? defaultCount
  const normalizedBaseUrl = normalizeBaseURL(baseURL)

  const startedAt = Date.now()
  try {
    const result = await fetchImages({
      apiKey,
      baseURL: normalizedBaseUrl,
      model,
      prompt: input.prompt,
      n: count,
      size,
      timeoutMs,
    })
    const latencyMs = Date.now() - startedAt

    // 写 usage_log（仅业务路径有 userId 时）
    if (input.userId) {
      await logUsage({
        userId: input.userId,
        taskId: input.taskId,
        scriptId: input.scriptId,
        type: 'image',
        phase: input.phase ?? 'cover',
        model,
        imageCount: result.images.length,
        latencyMs,
        success: true,
      })
    }

    return {
      images: result.images,
      // 多数图片网关不返回 model，用请求时的 model 回显
      model,
      latencyMs,
    }
  } catch (e) {
    const latencyMs = Date.now() - startedAt
    const normalized = normalizeImageError(e, baseURL, normalizedBaseUrl, startedAt)

    // 失败也写一条 usage_log
    if (input.userId) {
      await logUsage({
        userId: input.userId,
        taskId: input.taskId,
        scriptId: input.scriptId,
        type: 'image',
        phase: input.phase ?? 'cover',
        model,
        latencyMs,
        success: false,
        errorCode: normalized.code,
      })
    }

    throw normalized
  }
}

// 行 → 脱敏对象
function toMasked(plain: ImageSettingsPlain): ImageSettingsMasked {
  return {
    name: plain.name,
    apiKeyMasked: maskApiKey(plain.apiKey),
    model: plain.model,
    baseUrl: plain.baseUrl,
    timeoutMs: plain.timeoutMs,
    defaultSize: plain.defaultSize,
    defaultCount: plain.defaultCount,
    updatedAt: plain.updatedAt.toISOString(),
    hasApiKey: Boolean(plain.apiKey),
  }
}

// =============================================================================
// HTTP 直调 + 多格式响应兼容
// -----------------------------------------------------------------------------
// 为什么不用 OpenAI SDK：
//   SDK 把响应对齐到 { data: [{ url, revised_prompt }] }，
//   中转网关常返回 { images: ["url"] } / { output: [{ url }] } / { url }，
//   SDK 会丢字段，extractImageUrls 直接从原始 payload 兜底取值。
// =============================================================================

type ExtractedImage = { url: string; revisedPrompt?: string }

// 从响应 payload 提取图片 URL 列表（兼容多种网关格式）
// 优先级：data[].url|b64_json > images[]（字符串或对象） > output[].url > url
function extractImageUrls(payload: unknown): ExtractedImage[] {
  if (!payload || typeof payload !== 'object') return []
  const p = payload as Record<string, unknown>

  // 1) OpenAI 标准：data: [{ url | b64_json, revised_prompt }]
  if (Array.isArray(p.data)) {
    return p.data
      .map((item) => mapImageItem(item))
      .filter((x): x is ExtractedImage => x !== null)
  }

  // 2) 非标准：images: ["url1", "url2"] 或 images: [{ url }]
  if (Array.isArray(p.images)) {
    return p.images
      .map((item) => mapImageItem(item))
      .filter((x): x is ExtractedImage => x !== null)
  }

  // 3) 部分网关：output: [{ url }]
  if (Array.isArray(p.output)) {
    return p.output
      .map((item) => mapImageItem(item))
      .filter((x): x is ExtractedImage => x !== null)
  }

  // 4) 顶层 url（极少数网关直接平铺）
  if (typeof p.url === 'string' && p.url) {
    return [{ url: p.url }]
  }

  return []
}

// 单个图片项归一化（接受 string、{ url }、{ b64_json }）
function mapImageItem(item: unknown): ExtractedImage | null {
  if (typeof item === 'string') {
    return item ? { url: item } : null
  }
  if (item && typeof item === 'object') {
    const obj = item as Record<string, unknown>
    const url = typeof obj.url === 'string' ? obj.url : ''
    const b64 = typeof obj.b64_json === 'string' ? obj.b64_json : ''
    const finalUrl = url || (b64 ? `data:image/png;base64,${b64}` : '')
    if (!finalUrl) return null
    const revisedPrompt =
      typeof obj.revised_prompt === 'string' ? obj.revised_prompt : undefined
    return { url: finalUrl, revisedPrompt }
  }
  return null
}

// fetch 直调 OpenAI 兼容的 /images/generations 端点
async function fetchImages(params: {
  apiKey: string
  baseURL: string // 已规范化的 baseURL（带 /v1）
  model: string
  prompt: string
  n: number
  size: string
  timeoutMs: number
}): Promise<{ images: ExtractedImage[]; raw: unknown }> {
  const endpoint = `${params.baseURL.replace(/\/+$/, '')}/images/generations/`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), params.timeoutMs)

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        prompt: params.prompt,
        n: params.n,
        size: params.size,
      }),
      signal: controller.signal,
    })

    const text = await resp.text()

    if (!resp.ok) {
      // 解析错误信息（兼容 OpenAI { error: { message } } 与 ResponseMetadata 风格 { ResponseMetadata.Error.Message }）
      let serverMsg = `HTTP ${resp.status}`
      try {
        const errPayload = text ? JSON.parse(text) : null
        serverMsg = extractUpstreamErrorMessage(errPayload) ?? serverMsg
      } catch {
        if (text) serverMsg = text.slice(0, 300)
      }
      const err = new Error(serverMsg) as Error & { status?: number }
      err.status = resp.status
      throw err
    }

    let payload: unknown
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      const err = new Error(
        `响应不是合法 JSON：${text.slice(0, 200)}`,
      ) as Error & { status?: number }
      err.status = resp.status
      throw err
    }

    return { images: extractImageUrls(payload), raw: payload }
  } catch (e) {
    // AbortController 触发的超时
    if (e instanceof Error && e.name === 'AbortError') {
      const err = new Error('ETIMEDOUT') as Error & { code?: string; status?: number }
      err.code = 'ETIMEDOUT'
      err.status = 504
      throw err
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

// 错误归一化（与 llm-config.service 保持一致的 code 命名风格）
function normalizeImageError(
  e: unknown,
  finalBaseUrl: string,
  normalizedBaseUrl: string,
  startedAt: number,
): BusinessError {
  const err = e as { status?: number; code?: string; message?: string }
  if (err.code === 'ETIMEDOUT' || err.status === 504) {
    return new BusinessError(
      'IMAGE_TIMEOUT',
      `连接超时（${Date.now() - startedAt}ms）`,
      504,
    )
  }
  if (err.status === 401) {
    return new BusinessError('IMAGE_AUTH_FAILED', 'API Key 无效或被拒', 401)
  }
  if (err.status === 404) {
    return new BusinessError(
      'IMAGE_MODEL_OR_ENDPOINT_NOT_FOUND',
      `模型或端点不存在（404）。检查 baseURL（${finalBaseUrl} → ${normalizedBaseUrl}）是否支持 /images/generations，以及模型名拼写。`,
      404,
    )
  }
  if (err.status === 429) {
    return new BusinessError('IMAGE_RATE_LIMIT', '触发限流，请稍后再试', 429)
  }
  return new BusinessError(
    'IMAGE_FAILED',
    `图片调用失败：${err.message ?? 'unknown error'}`,
    502,
  )
}
