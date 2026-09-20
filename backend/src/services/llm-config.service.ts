// =============================================================================
// LLM 配置业务服务层
// -----------------------------------------------------------------------------
// 职责：
//   - getEffectiveConfig  当前生效配置（DB > env，无缓存，每次查 DB）
//   - getMasked           给前端展示（脱敏 apiKey）
//   - update              UPSERT + 不缓存（worker 进程独立读 DB）
//   - testConnection      用新/旧配置测试连接（发 1 条 hello world 消息）
//
// 设计要点：
//   - 不做内存缓存：worker 与 API server 是两个进程，跨进程缓存难同步
//     每次 worker 任务入口调 1 次 getEffectiveConfig，传给子调用即可
//   - testConnection 接受可选参数：用户改了配置先测试再保存
// =============================================================================

import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env'
import { llmSettingsRepository, maskApiKey, type LlmSettingsMasked } from '../repositories/llm-settings.repository'
import type { UpdateLlmConfigInput, TestLlmConfigInput } from '../schemas/llm-config.schema'
import { BusinessError } from '../lib/errors'
import { normalizeBaseURL, normalizeAnthropicBaseURL } from '../lib/llm-client'

// LLM 有效配置（给 llm-client/report-generator 用）
// - source='db'：来自 DB（运行时配置）
// - source='env'：来自 env（fallback，DB 为空时）
export interface LlmEffectiveConfig {
  apiKey: string
  baseURL: string
  model: string
  timeoutMs: number
  source: 'db' | 'env'
  // API 协议格式（openai: /v1/chat/completions | anthropic: /v1/messages）
  // 可选：per-user 链路（user_llm_settings 无此字段）缺省按 'openai' 处理
  apiFormat?: 'openai' | 'anthropic'
  // 配置名称（仅 db 来源有值）
  name?: string
  // 默认分析模式（仅 db 来源有值；env fallback 时为 standard）
  defaultAnalyzeMode?: 'standard' | 'fast' | 'ultra'
}

// 获取当前生效配置（每次查 DB，不缓存）
// worker 任务入口调 1 次即可，整个任务复用同一份 config
export async function getEffectiveLlmConfig(): Promise<LlmEffectiveConfig> {
  const fromDb = await llmSettingsRepository.getPlain()
  if (fromDb) {
    return {
      apiKey: fromDb.apiKey,
      baseURL: fromDb.baseUrl,
      model: fromDb.model,
      apiFormat: fromDb.apiFormat,
      timeoutMs: fromDb.timeoutMs,
      name: fromDb.name,
      defaultAnalyzeMode: fromDb.defaultAnalyzeMode,
      source: 'db',
    }
  }
  // fallback 到 env
  return {
    apiKey: env.LLM_API_KEY,
    baseURL: env.LLM_BASE_URL,
    model: env.LLM_MODEL,
    timeoutMs: env.LLM_TIMEOUT_MS,
    defaultAnalyzeMode: 'standard',
    source: 'env',
  }
}

// 给前端展示用（脱敏）
// 返回 null 表示 DB 无配置（前端可提示「未配置，使用 env 默认值」）
export async function getMaskedLlmConfig(): Promise<LlmSettingsMasked | null> {
  const plain = await llmSettingsRepository.getPlain()
  if (!plain) return null
  return {
    name: plain.name,
    apiKeyMasked: maskApiKey(plain.apiKey),
    model: plain.model,
    baseUrl: plain.baseUrl,
    apiFormat: plain.apiFormat,
    timeoutMs: plain.timeoutMs,
    defaultAnalyzeMode: plain.defaultAnalyzeMode,
    updatedAt: plain.updatedAt.toISOString(),
    hasApiKey: Boolean(plain.apiKey),
  }
}

// 更新配置（UPSERT）
// apiKey 设计：undefined（前端传空字符串转 undefined）→ 保留 DB 已存的值
// 避免用户改其他字段时被强制要求重输 API Key
export async function updateLlmConfig(input: UpdateLlmConfigInput) {
  // 首次保存（DB 无记录）+ 用户没填 apiKey：拒绝（不能凭空创建无 key 的配置）
  const existing = await llmSettingsRepository.getPlain()
  let finalApiKey = input.apiKey
  if (!finalApiKey) {
    if (!existing) {
      throw new BusinessError(
        'LLM_API_KEY_REQUIRED',
        '首次保存必须提供 API Key',
        400,
      )
    }
    // 用户没填 key 但 DB 已有 → 沿用旧值
    finalApiKey = existing.apiKey
  }

  const updated = await llmSettingsRepository.upsert({
    name: input.name,
    apiKey: finalApiKey,
    model: input.model,
    baseUrl: input.baseUrl,
    apiFormat: input.apiFormat,
    timeoutMs: input.timeoutMs,
    defaultAnalyzeMode: input.defaultAnalyzeMode,
  })
  return {
    name: updated.name,
    apiKeyMasked: maskApiKey(updated.apiKey),
    model: updated.model,
    baseUrl: updated.baseUrl,
    apiFormat: updated.apiFormat,
    timeoutMs: updated.timeoutMs,
    defaultAnalyzeMode: updated.defaultAnalyzeMode,
    updatedAt: updated.updatedAt.toISOString(),
    hasApiKey: true,
  }
}

// 测试连接（不依赖 DB，参数优先用 input，缺失字段用 DB 兜底）
// - 发 1 条 hello world 消息，max_tokens=10
// - 按 apiFormat 分流：openai → OpenAI SDK；anthropic → Anthropic SDK
// - 成功：返回 { ok: true, latencyMs, model }
// - 失败：抛 BusinessError（前端展示 code + message）
export async function testLlmConnection(input: TestLlmConfigInput): Promise<{
  ok: boolean
  latencyMs: number
  modelEcho: string
}> {
  // 解析最终配置：input 字段缺失时从 DB / env 兜底
  let finalApiKey = input.apiKey
  let finalBaseUrl = input.baseUrl
  let finalModel = input.model
  let finalApiFormat = input.apiFormat

  if (!finalApiKey || !finalBaseUrl || !finalModel || !finalApiFormat) {
    const effective = await getEffectiveLlmConfig()
    finalApiKey = finalApiKey ?? effective.apiKey
    finalBaseUrl = finalBaseUrl ?? effective.baseURL
    finalModel = finalModel ?? effective.model
    finalApiFormat = finalApiFormat ?? effective.apiFormat ?? 'openai'
  }

  if (!finalApiKey) {
    throw new BusinessError('LLM_TEST_NO_API_KEY', '缺少 API Key，无法测试', 400)
  }

  // Anthropic 原生协议分支（/v1/messages，baseURL 不带 /v1）
  if (finalApiFormat === 'anthropic') {
    return testAnthropicConnection(finalApiKey, finalBaseUrl!, finalModel!)
  }

  // baseURL 规范化（与 worker 调用保持一致，避免测试通过但实际调用失败）
  const normalizedBaseUrl = normalizeBaseURL(finalBaseUrl)

  const client = new OpenAI({
    apiKey: finalApiKey,
    baseURL: normalizedBaseUrl,
    timeout: 30000, // 测试连接固定 30 秒超时（避免用户等太久）
    maxRetries: 0, // 测试连接不重试
  })

  const startedAt = Date.now()
  try {
    const resp = await client.chat.completions.create({
      model: finalModel,
      // 256 而非 16：思考型模型（reasoning_content）会把小配额全部消耗在
      // 思考阶段，导致 message.content 为空（误报格式异常）
      max_tokens: 256,
      messages: [
        { role: 'user', content: '回复一个字「ok」用于连通性测试。' },
      ],
    })
    // 防御性校验：网关偶发返回 HTTP 200 但响应体非标准（如 HTML 登录页）
    // 此时 choices 为 undefined，SDK 内部已抛 "Cannot read properties of undefined"
    //
    // 判定标准：choices 结构合法 + finish_reason 存在 → 链路连通即算成功。
    // 不要求 message.content 非空：思考型模型（glm-5.2 / deepseek-r1 等）可能
    // 把 256 配额全部耗在思考阶段（finish_reason=length 无正文），属正常截断。
    const choice = resp?.choices?.[0]
    if (!choice || !choice.finish_reason) {
      throw new Error(
        `响应结构异常：choices/finish_reason 缺失。baseURL 可能配置错误` +
          `（当前: ${finalBaseUrl}，规范化后: ${normalizedBaseUrl}，OpenAI 兼容网关通常以 /v1 结尾）`,
      )
    }
    const latencyMs = Date.now() - startedAt
    return {
      ok: true,
      latencyMs,
      modelEcho: resp.model ?? finalModel,
    }
  } catch (e) {
    const err = e as { status?: number; code?: string; message?: string }
    // 复用 llm-client 的错误归一化（但这里要立即抛给前端）
    if (err.code === 'ETIMEDOUT' || err.status === 504) {
      throw new BusinessError('LLM_TIMEOUT', `连接超时（${Date.now() - startedAt}ms）`, 504)
    }
    if (err.status === 401) {
      throw new BusinessError('LLM_AUTH_FAILED', 'API Key 无效或被拒', 401)
    }
    if (err.status === 404) {
      throw new BusinessError('LLM_MODEL_NOT_FOUND', `模型 ${finalModel} 不存在或无权访问`, 404)
    }
    if (err.status === 429) {
      throw new BusinessError('LLM_RATE_LIMIT', '触发限流，请稍后再试', 429)
    }
    // SDK 内部解析失败（最常见：baseURL 配置错误返回 HTML）
    if (
      err.message?.includes("Cannot read properties of undefined (reading '0')") ||
      err.message?.includes('choices')
    ) {
      throw new BusinessError(
        'LLM_BASE_URL_INVALID',
        `baseURL 可能配置错误（当前: ${finalBaseUrl}）。OpenAI 兼容网关通常需要以 /v1 结尾，如 https://xxx.com/v1`,
        502,
      )
    }
    // 其他：把原始 message 透出，便于排查
    throw new BusinessError(
      'LLM_TEST_FAILED',
      `连接失败：${err.message ?? 'unknown error'}`,
      502,
    )
  }
}

// Anthropic 原生协议测试连接（/v1/messages，非流式快速验证）
// 错误码语义与 OpenAI 分支对齐，便于前端统一展示
async function testAnthropicConnection(
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<{ ok: boolean; latencyMs: number; modelEcho: string }> {
  // Anthropic SDK 自拼 /v1/messages：baseURL 不应带 /v1（与 OpenAI 方向相反）
  const normalizedBaseUrl = normalizeAnthropicBaseURL(baseUrl)

  const client = new Anthropic({
    apiKey,
    baseURL: normalizedBaseUrl,
    timeout: 30000,
    maxRetries: 0,
  })

  const startedAt = Date.now()
  try {
    const resp = await client.messages.create({
      model,
      // 256 而非 16：思考型模型（如 glm-5.2 / claude thinking）会把小配额
      // 全部消耗在 thinking 阶段，导致 content 无 text block（误报格式异常）
      max_tokens: 256,
      messages: [{ role: 'user', content: '回复一个字「ok」用于连通性测试。' }],
    })
    // 防御性校验：网关偶发返回 200 但响应体非标准（如 HTML 登录页）
    //
    // 判定标准：content 数组存在 + stop_reason 存在 → 链路连通即算成功。
    // 不要求 text block 非空：思考型模型可能把 256 配额全部耗在 thinking
    // 阶段（stop_reason=max_tokens 无正文），属正常截断。
    if (!Array.isArray(resp?.content) || resp.content.length === 0 || !resp?.stop_reason) {
      throw new Error(
        `响应结构异常：content/stop_reason 缺失。常见原因：模型不支持 Anthropic 协议 / baseURL 配置错误` +
          `（当前: ${baseUrl}，规范化后: ${normalizedBaseUrl}，Anthropic 地址不带 /v1）`,
      )
    }
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      modelEcho: resp.model ?? model,
    }
  } catch (e) {
    const err = e as { status?: number; code?: string; message?: string }
    if (err.code === 'ETIMEDOUT' || err.status === 504) {
      throw new BusinessError('LLM_TIMEOUT', `连接超时（${Date.now() - startedAt}ms）`, 504)
    }
    if (err.status === 401) {
      throw new BusinessError('LLM_AUTH_FAILED', 'API Key 无效或被拒', 401)
    }
    if (err.status === 404) {
      throw new BusinessError('LLM_MODEL_NOT_FOUND', `模型 ${model} 不存在或无权访问`, 404)
    }
    if (err.status === 429) {
      throw new BusinessError('LLM_RATE_LIMIT', '触发限流，请稍后再试', 429)
    }
    throw new BusinessError(
      'LLM_TEST_FAILED',
      `连接失败：${err.message ?? 'unknown error'}`,
      502,
    )
  }
}
