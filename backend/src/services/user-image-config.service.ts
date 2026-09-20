// =============================================================================
// 用户级 图片模型配置 业务服务层
// -----------------------------------------------------------------------------
// 职责：同 user-llm-config.service，针对图片模型
// =============================================================================

import {
  userImageSettingsRepository,
  toMasked,
  type UserImageSettingsMasked,
} from '../repositories/user-image-settings.repository'
import { imageSettingsRepository } from '../repositories/image-settings.repository'
import { BusinessError } from '../lib/errors'
import { normalizeBaseURL } from '../lib/llm-client'

export interface UserImageEffectiveConfig {
  apiKey: string
  baseURL: string
  model: string
  timeoutMs: number
  defaultSize: string
  defaultCount: number
  name?: string
}

// 业务调用入口（未配置抛 USER_IMAGE_NOT_CONFIGURED）
export async function getEffectiveByUser(
  userId: string,
): Promise<UserImageEffectiveConfig> {
  const plain = await userImageSettingsRepository.findByUserId(userId)
  if (!plain) {
    throw new BusinessError(
      'USER_IMAGE_NOT_CONFIGURED',
      '该用户尚未配置图片模型，请联系管理员在后台配置',
      400,
    )
  }
  return {
    apiKey: plain.apiKey,
    baseURL: plain.baseUrl,
    model: plain.model,
    timeoutMs: plain.timeoutMs,
    defaultSize: plain.defaultSize,
    defaultCount: plain.defaultCount,
    name: plain.name,
  }
}

export async function getMaskedByUser(
  userId: string,
): Promise<UserImageSettingsMasked | null> {
  const plain = await userImageSettingsRepository.findByUserId(userId)
  if (!plain) return null
  return toMasked(plain)
}

export async function upsertByUser(
  userId: string,
  input: {
    name: string
    apiKey?: string
    model: string
    baseUrl: string
    timeoutMs: number
    defaultSize: string
    defaultCount: number
  },
): Promise<UserImageSettingsMasked> {
  const existing = await userImageSettingsRepository.findByUserId(userId)
  let finalApiKey = input.apiKey
  if (!finalApiKey) {
    if (!existing) {
      throw new BusinessError(
        'USER_IMAGE_API_KEY_REQUIRED',
        '首次保存必须提供 API Key',
        400,
      )
    }
    finalApiKey = existing.apiKey
  }

  const updated = await userImageSettingsRepository.upsertByUserId(userId, {
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

// 测试连接：发一次 n=1 的图片调用
export async function testByUser(
  userId: string,
  input: { apiKey?: string; model?: string; baseUrl?: string },
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
  const endpoint = `${normalizedBaseUrl.replace(/\/+$/, '')}/images/generations`
  const startedAt = Date.now()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60000)

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${finalApiKey}`,
      },
      body: JSON.stringify({
        model: finalModel,
        prompt: 'a dot',
        n: 1,
        size: '1024x1024',
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!resp.ok) {
      const text = await resp.text()
      let serverMsg = `HTTP ${resp.status}`
      try {
        const errPayload = text ? JSON.parse(text) : null
        serverMsg = (errPayload && (errPayload.error?.message ?? errPayload.message)) || serverMsg
      } catch {
        if (text) serverMsg = text.slice(0, 300)
      }
      if (resp.status === 401) {
        throw new BusinessError('IMAGE_AUTH_FAILED', 'API Key 无效或被拒', 401)
      }
      if (resp.status === 404) {
        throw new BusinessError('IMAGE_MODEL_OR_ENDPOINT_NOT_FOUND', '模型或端点不存在（404）', 404)
      }
      if (resp.status === 429) {
        throw new BusinessError('IMAGE_RATE_LIMIT', '触发限流', 429)
      }
      throw new BusinessError('IMAGE_FAILED', `调用失败：${serverMsg}`, 502)
    }

    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      modelEcho: finalModel,
    }
  } catch (e) {
    clearTimeout(timer)
    if (e instanceof BusinessError) throw e
    const err = e as { code?: string; status?: number; message?: string }
    if (err.code === 'ETIMEDOUT' || err.status === 504) {
      throw new BusinessError('IMAGE_TIMEOUT', `连接超时（${Date.now() - startedAt}ms）`, 504)
    }
    throw new BusinessError(
      'IMAGE_FAILED',
      `连接失败：${err.message ?? 'unknown error'}`,
      502,
    )
  }
}

// 从全局模板复制
export async function copyFromTemplate(
  userId: string,
): Promise<UserImageSettingsMasked> {
  const template = await imageSettingsRepository.getPlain()
  if (!template) {
    throw new BusinessError(
      'IMAGE_TEMPLATE_EMPTY',
      '全局图片模板尚未配置，无法复制。请先在 /admin/image-config 配置全局模板',
      400,
    )
  }
  const created = await userImageSettingsRepository.upsertByUserId(userId, {
    name: template.name,
    apiKey: template.apiKey,
    model: template.model,
    baseUrl: template.baseUrl,
    timeoutMs: template.timeoutMs,
    defaultSize: template.defaultSize,
    defaultCount: template.defaultCount,
  })
  return toMasked(created)
}
