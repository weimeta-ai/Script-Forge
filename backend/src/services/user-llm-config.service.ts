// =============================================================================
// 用户级 LLM 配置业务服务层
// -----------------------------------------------------------------------------
// 职责：
//   - getEffectiveByUser(userId)：获取生效配置（强制 per-user，未配置抛错）
//   - getMaskedByUser(userId)：给前端展示（脱敏）
//   - upsertByUser(userId, input)：UPSERT
//   - testByUser(userId, input)：用 input 或 DB 配置测试连接
//   - copyFromTemplate(userId)：从全局 llm_settings 复制到 user_llm_settings
//
// 设计要点：
//   - 业务路径强制 per-user：getEffectiveByUser 查不到则抛 USER_LLM_NOT_CONFIGURED
//   - apiKey 留空时沿用 DB 已存值（与全局 service 一致）
// =============================================================================

import OpenAI from 'openai'
import {
  userLlmSettingsRepository,
  toMasked,
  type UserLlmSettingsMasked,
} from '../repositories/user-llm-settings.repository'
import { llmSettingsRepository } from '../repositories/llm-settings.repository'
import { BusinessError } from '../lib/errors'
import { normalizeBaseURL } from '../lib/llm-client'

// 业务调用使用的有效配置类型（对齐全局 LlmEffectiveConfig，但仅 source='user'）
export interface UserLlmEffectiveConfig {
  apiKey: string
  baseURL: string
  model: string
  timeoutMs: number
  defaultAnalyzeMode: 'standard' | 'fast' | 'ultra'
  name?: string
}

// 业务调用入口（worker / lib 内部使用）
// 未配置时抛 USER_LLM_NOT_CONFIGURED，由全局错误中间件转换为 400
export async function getEffectiveByUser(
  userId: string,
): Promise<UserLlmEffectiveConfig> {
  const plain = await userLlmSettingsRepository.findByUserId(userId)
  if (!plain) {
    throw new BusinessError(
      'USER_LLM_NOT_CONFIGURED',
      '该用户尚未配置 LLM，请联系管理员在后台配置',
      400,
    )
  }
  return {
    apiKey: plain.apiKey,
    baseURL: plain.baseUrl,
    model: plain.model,
    timeoutMs: plain.timeoutMs,
    defaultAnalyzeMode: plain.defaultAnalyzeMode,
    name: plain.name,
  }
}

// 给前端展示（脱敏）
// 返回 null 表示用户未配置（前端提示「未配置」）
export async function getMaskedByUser(
  userId: string,
): Promise<UserLlmSettingsMasked | null> {
  const plain = await userLlmSettingsRepository.findByUserId(userId)
  if (!plain) return null
  return toMasked(plain)
}

// UPSERT（apiKey 留空时沿用旧值）
export async function upsertByUser(
  userId: string,
  input: {
    name: string
    apiKey?: string
    model: string
    baseUrl: string
    timeoutMs: number
    defaultAnalyzeMode: 'standard' | 'fast' | 'ultra'
  },
): Promise<UserLlmSettingsMasked> {
  const existing = await userLlmSettingsRepository.findByUserId(userId)
  let finalApiKey = input.apiKey
  if (!finalApiKey) {
    if (!existing) {
      throw new BusinessError(
        'USER_LLM_API_KEY_REQUIRED',
        '首次保存必须提供 API Key',
        400,
      )
    }
    finalApiKey = existing.apiKey
  }

  const updated = await userLlmSettingsRepository.upsertByUserId(userId, {
    name: input.name,
    apiKey: finalApiKey,
    model: input.model,
    baseUrl: input.baseUrl,
    timeoutMs: input.timeoutMs,
    defaultAnalyzeMode: input.defaultAnalyzeMode,
  })
  return toMasked(updated)
}

// 测试连接（参数缺失时用 DB 配置兜底）
export async function testByUser(
  userId: string,
  input: {
    apiKey?: string
    model?: string
    baseUrl?: string
  },
): Promise<{ ok: boolean; latencyMs: number; modelEcho: string }> {
  let finalApiKey = input.apiKey
  let finalBaseUrl = input.baseUrl
  let finalModel = input.model

  if (!finalApiKey || !finalBaseUrl || !finalModel) {
    const effective = await getEffectiveByUser(userId)
    finalApiKey = finalApiKey ?? effective.apiKey
    finalBaseUrl = finalBaseUrl ?? effective.baseURL
    finalModel = finalModel ?? effective.model
  }

  const normalizedBaseUrl = normalizeBaseURL(finalBaseUrl)
  const client = new OpenAI({
    apiKey: finalApiKey,
    baseURL: normalizedBaseUrl,
    timeout: 30000,
    maxRetries: 0,
  })

  const startedAt = Date.now()
  try {
    const resp = await client.chat.completions.create({
      model: finalModel,
      // 思考型模型（如 glm-5.2 / deepseek-r1）会先消耗 tokens 做推理
      // max_tokens 太小（如 16）会全部用于 reasoning，导致 content="" + finish_reason="length"
      // 给到 128 留出思考预算，常规模型也不会浪费太多
      max_tokens: 128,
      messages: [{ role: 'user', content: '回复一个字「ok」用于连通性测试。' }],
    })
    // 成功判定：只要返回 choices 数组（即使 content 为空）就视为连通成功
    // 上游连通性测试目的是验证 apiKey/baseUrl/model 是否可用，不要求模型实际输出内容
    if (!resp?.choices || resp.choices.length === 0) {
      throw new Error(
        `响应格式异常：choices 为空（原始响应：${JSON.stringify(resp).slice(0, 300)}）`,
      )
    }
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      // 上游可能不返回 model 字段，用请求 model 兜底
      modelEcho: resp.model ?? finalModel,
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
      throw new BusinessError('LLM_MODEL_NOT_FOUND', `模型 ${finalModel} 不存在`, 404)
    }
    if (err.status === 429) {
      throw new BusinessError('LLM_RATE_LIMIT', '触发限流', 429)
    }
    throw new BusinessError(
      'LLM_TEST_FAILED',
      `连接失败：${err.message ?? 'unknown error'}`,
      502,
    )
  }
}

// 从全局模板复制（admin 创建用户时一键复制）
// 全局未配置则抛 LLM_TEMPLATE_EMPTY
export async function copyFromTemplate(userId: string): Promise<UserLlmSettingsMasked> {
  const template = await llmSettingsRepository.getPlain()
  if (!template) {
    throw new BusinessError(
      'LLM_TEMPLATE_EMPTY',
      '全局 LLM 模板尚未配置，无法复制。请先在 /admin/llm-config 配置全局模板',
      400,
    )
  }
  const created = await userLlmSettingsRepository.upsertByUserId(userId, {
    name: template.name,
    apiKey: template.apiKey,
    model: template.model,
    baseUrl: template.baseUrl,
    timeoutMs: template.timeoutMs,
    defaultAnalyzeMode: template.defaultAnalyzeMode,
  })
  return toMasked(created)
}
