// LLM 客户端（简化版，对齐 p00/lib/llm.ts 的 chatCompletion 接口）
// -----------------------------------------------------------------------------
// 重构说明：
// =============================================================================
//   - chatCompletion 按 apiFormat 分流：openai → OpenAI SDK；anthropic → Anthropic SDK
//   - 保留 normalizeBaseURL / normalizeLLMError / getEffectiveLlmConfig 集成
//   - 用户管理扩展：options 增加 userId/taskId/scriptId，业务路径强制走 per-user 配置
//     并写 usage_log（type=llm）
//   - apiFormat 仅全局 llm_settings 支持（admin 可选）；per-user 链路缺省 'openai'
// =============================================================================

import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { BusinessError, extractUpstreamErrorMessage } from './errors'
import { pushRuntimeLog } from './runtime-logger'
import { getEffectiveLlmConfig, type LlmEffectiveConfig } from '../services/llm-config.service'
import { getEffectiveByUser as getEffectiveByUserLlm } from '../services/user-llm-config.service'
import { logUsage } from '../services/usage-log.service'

// 规范化 baseURL：仅当 URL 不含 /v1 等 version 段时才补全
// 修正点：阿里云 DashScope 的 OpenAI 兼容地址已含 /v1，
//   原逻辑会重复添加变成 /v1/v1 导致 404
// 现逻辑：检测到 /v1/v1 等重复时去重，否则按需补充
export function normalizeBaseURL(url: string): string {
  if (!url) return url
  const trimmed = url.replace(/\/+$/, '')
  // 已含 /vN（如 /v1, /v2）→ 不重复补
  if (/\/v\d+(?:\/|$)/.test(trimmed)) {
    // 去重 /v1/v1 这类重复
    return trimmed.replace(/(\/v\d+)\/\1$/, '$1')
  }
  return `${trimmed}/v1`
}

// 规范化 Anthropic baseURL：与 OpenAI 方向相反，去掉末尾 /v1
// 原因：Anthropic SDK 自拼 /v1/messages，baseURL 带 /v1 会变成 /v1/v1/messages
// 用户填 https://api.anthropic.com 或 https://api.anthropic.com/v1 都能正确工作
export function normalizeAnthropicBaseURL(url: string): string {
  if (!url) return url
  const trimmed = url.replace(/\/+$/, '')
  return trimmed.replace(/\/v\d+$/, '')
}

// chatCompletion：对齐 p00 接口（messages 数组 + options）
// 用于 8 节点分析器等异步任务调用
//
// 流式 + 双计时器设计（规避 LLM provider 静默降速限流导致的误杀）：
//   - absoluteTimer：总超时上限，不重置（默认 360s）
//   - idleTimer：chunk 间无进展超时，每收到一个 token 重置（默认 60s）
//   场景：provider 限流时单 chunk 间隔可能数十秒，但只要持续吐 token，
//         就不会触发误杀；真挂掉（TCP 连着但 0 吐字）60s 内快速失败。
//
// options.userId：业务路径必传（强制 per-user 配置 + 写 usage_log）
//   - 有 userId → 走 user_llm_settings；查不到抛 USER_LLM_NOT_CONFIGURED
//   - 无 userId → fallback 到全局（保留给 admin 测试连接用）
export async function chatCompletion(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: {
    maxTokens?: number
    // 总超时（绝对上限），默认 360s
    timeoutMs?: number
    // 无进展超时（chunk 间最大间隔），默认 60s
    // 调用方一般不需要传，仅测试连接等短任务需要缩短
    idleTimeoutMs?: number
    temperature?: number
    config?: LlmEffectiveConfig
    // 需要严格 JSON 输出时开启 OpenAI SDK 的 json_object 模式
    responseFormat?: 'json' | 'text'
    // runtime log 区分阶段（analyze）
    phase?: string
    // 用户管理扩展：业务路径必传，写 usage_log + per-user 配置
    userId?: string
    taskId?: string
    scriptId?: string
  },
): Promise<string> {
  // 配置解析：userId 优先走 per-user；否则 fallback 全局（admin 测试兼容）
  // 显式 if/else（让 TS 类型推断稳定，避免 `??` 三元联合后变成 undefined）
  let effective: LlmEffectiveConfig
  if (options?.config) {
    effective = options.config
  } else if (options?.userId) {
    const c = await getEffectiveByUserLlm(options.userId)
    effective = {
      apiKey: c.apiKey,
      baseURL: c.baseURL,
      model: c.model,
      timeoutMs: c.timeoutMs,
      source: 'db',
      name: c.name,
      defaultAnalyzeMode: c.defaultAnalyzeMode,
    }
  } else {
    effective = await getEffectiveLlmConfig()
  }

  // apiFormat 分流：anthropic → Anthropic 原生 /v1/messages；缺省 openai
  // （per-user 配置无 apiFormat 字段，走默认 openai 分支）
  if ((effective.apiFormat ?? 'openai') === 'anthropic') {
    return anthropicChatCompletion(messages, effective, options)
  }

  const normalizedBaseURL = normalizeBaseURL(effective.baseURL)
  const phase = options?.phase ?? 'analyze'
  const timeoutMs = options?.timeoutMs ?? 360000
  const idleTimeoutMs = options?.idleTimeoutMs ?? 60_000

  // 双计时器：absoluteTimer 不重置；idleTimer 每收到 chunk 重置
  // 用 AbortController 绝对中断（替代 SDK 的 timeout 选项）
  // 原因：SDK timeout 对「连接已建立但 provider 不返回数据」场景不可靠
  // （TCP keep-alive 包会重置计时器，导致挂起的请求永不超时）
  const controller = new AbortController()
  const absoluteTimer = setTimeout(() => controller.abort(), timeoutMs)
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => controller.abort(), idleTimeoutMs)
  }
  resetIdle()

  const client = new OpenAI({
    apiKey: effective.apiKey,
    baseURL: normalizedBaseURL,
    maxRetries: 0,
  })

  const startedAt = Date.now()
  pushRuntimeLog({
    level: 'debug',
    category: 'llm',
    message: `LLM 调用开始 phase=${phase} (stream)`,
    meta: {
      phase,
      model: effective.model,
      baseURL: normalizedBaseURL,
      source: effective.source,
      userId: options?.userId,
      taskId: options?.taskId,
      messagesCount: messages.length,
      responseFormat: options?.responseFormat ?? 'text',
      timeoutMs,
      idleTimeoutMs,
    },
  })

  try {
    // 流式输出：规避 provider 静默降速限流
    // stream_options.include_usage：让最后一个 chunk 带 token 用量（OpenAI 规范）
    // 国产 provider（DeepSeek/通义/智谱）均支持；个别不支持时 usage 为 undefined，
    // usage_log 的 token 字段同步为 undefined，不影响主流程
    const stream = await client.chat.completions.create(
      {
        model: effective.model,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 4096,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        // 严格 JSON 输出模式
        ...(options?.responseFormat === 'json'
          ? { response_format: { type: 'json_object' as const } }
          : {}),
      },
      { signal: controller.signal },
    )

    let raw = ''
    let responseModel: string | undefined
    let usage:
      | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
      | undefined

    for await (const chunk of stream) {
      // 每个 chunk 携带部分 delta，收到即重置 idleTimer
      resetIdle()
      const choice = chunk.choices?.[0]
      const delta = choice?.delta?.content ?? ''
      if (delta) {
        raw += delta
      }
      // 模型名通常在首个 chunk
      if (!responseModel && chunk.model) {
        responseModel = chunk.model
      }
      // usage 通常在最后一个 chunk（include_usage: true 时）
      if (chunk.usage) {
        usage = chunk.usage
      }
    }

    clearTimeout(absoluteTimer)
    if (idleTimer) clearTimeout(idleTimer)
    const latencyMs = Date.now() - startedAt

    pushRuntimeLog({
      level: 'info',
      category: 'llm',
      message: `LLM 调用成功 phase=${phase} (${latencyMs}ms, raw=${raw.length} chars)`,
      meta: {
        phase,
        latencyMs,
        model: effective.model,
        responseModel,
        rawLength: raw.length,
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        totalTokens: usage?.total_tokens,
        // 流式速率（粗略：总输出字符 / 总耗时秒数）
        charsPerSec: latencyMs > 0 ? Math.round((raw.length / latencyMs) * 1000) : 0,
      },
    })

    // 写 usage_log（仅业务路径有 userId 时）
    if (options?.userId) {
      await logUsage({
        userId: options.userId,
        taskId: options.taskId,
        scriptId: options.scriptId,
        type: 'llm',
        phase: phase as 'analyze' | 'cover' | 'test',
        model: responseModel ?? effective.model,
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        totalTokens: usage?.total_tokens,
        latencyMs,
        success: true,
      })
    }

    return raw
  } catch (e) {
    clearTimeout(absoluteTimer)
    if (idleTimer) clearTimeout(idleTimer)
    const latencyMs = Date.now() - startedAt

    // 错误归一化（保留原逻辑）
    let normalized: BusinessError
    if (controller.signal.aborted) {
      // 区分是哪个计时器触发的：超过总超时 vs 无进展超时
      const isAbsolute = latencyMs >= timeoutMs - 500 // 500ms 容差
      const timeoutLabel = isAbsolute
        ? `${timeoutMs}ms 总超时`
        : `${idleTimeoutMs}ms 无进展超时（chunk 间无新 token）`
      normalized = new BusinessError(
        'LLM_TIMEOUT',
        `LLM 调用超时（${timeoutLabel}）`,
        504,
      )
      pushRuntimeLog({
        level: 'error',
        category: 'llm',
        message: `LLM 调用超时 phase=${phase} (${timeoutLabel}, 已等待 ${latencyMs}ms)`,
        meta: {
          phase,
          model: effective.model,
          baseURL: normalizedBaseURL,
          timeoutMs,
          idleTimeoutMs,
          latencyMs,
        },
      })
    } else {
      normalized = normalizeLLMError(e, {
        model: effective.model,
        baseURL: normalizedBaseURL,
        phase,
      })
    }

    // 失败也写一条 usage_log（success=false + errorCode）
    if (options?.userId) {
      await logUsage({
        userId: options.userId,
        taskId: options.taskId,
        scriptId: options.scriptId,
        type: 'llm',
        phase: phase as 'analyze' | 'cover' | 'test',
        model: effective.model,
        latencyMs,
        success: false,
        errorCode: normalized.code,
      })
    }

    throw normalized
  }
}

// 测试连接（admin 后台用）
export async function testConnection(config?: LlmEffectiveConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const reply = await chatCompletion(
      [
        { role: 'system', content: '你是一个测试助手。' },
        { role: 'user', content: '请回复连接成功' },
      ],
      { maxTokens: 50, timeoutMs: 15000, temperature: 0, config },
    )
    return { ok: true, message: reply || '连接成功' }
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    }
  }
}

// 错误归一化（保留原逻辑）
function normalizeLLMError(
  e: unknown,
  context?: { model?: string; baseURL?: string; phase?: string },
): BusinessError {
  if (e instanceof BusinessError) return e
  const err = e as {
    status?: number
    code?: string
    message?: string
    error?: { message?: string; type?: string; code?: string } & Record<string, unknown>
  }
  const status = err.status
  // 提取上游错误描述（兼容 OpenAI { error: { message } } 与 ResponseMetadata 风格 { ResponseMetadata.Error.Message }）
  const innerMsg = extractUpstreamErrorMessage(err) ?? err.message ?? 'unknown error'
  const errCode = err.code ?? err.error?.code ?? err.error?.type ?? 'UNKNOWN'
  const meta = {
    status,
    sdkCode: errCode,
    model: context?.model,
    baseURL: context?.baseURL,
    phase: context?.phase,
    sdkMessage: innerMsg,
  }

  pushRuntimeLog({
    level: 'error',
    category: 'llm',
    message: `LLM 调用失败 status=${status ?? 'N/A'} phase=${context?.phase ?? 'unknown'}`,
    meta,
  })

  if (err.code === 'ETIMEDOUT' || status === 504) {
    return new BusinessError('LLM_TIMEOUT', `LLM 调用超时（${innerMsg}）`, 504)
  }
  if (status === 429) {
    return new BusinessError('LLM_RATE_LIMIT', `LLM 限流（${innerMsg}）`, 429)
  }
  if (status === 401) {
    return new BusinessError('LLM_AUTH_FAILED', `API Key 无效（${innerMsg}）`, 502)
  }
  if (status === 404) {
    return new BusinessError(
      'LLM_ENDPOINT_NOT_FOUND',
      `接口或模型不存在（404）：${innerMsg}。请检查服务地址和模型名`,
      502,
    )
  }
  if (status && status >= 500) {
    return new BusinessError('LLM_UPSTREAM_ERROR', `LLM 网关异常（${status}）：${innerMsg}`, 502)
  }
  if (status && status >= 400) {
    return new BusinessError(
      'LLM_BAD_REQUEST',
      `LLM 拒绝请求（${status}）：${innerMsg}。常见原因：模型名错 / 请求格式不兼容 / 配额耗尽`,
      502,
    )
  }
  return new BusinessError('LLM_PARSE_ERROR', `LLM 调用失败（${errCode}）：${innerMsg}`, 502)
}

// =============================================================================
// Anthropic 原生协议分支（/v1/messages）
// -----------------------------------------------------------------------------
// 与 OpenAI 分支对齐：流式 + 双计时器 + runtime log + usage_log + 错误归一化
// 协议差异点：
//   - system 消息不在 messages 数组，单独传顶层 system 字段
//   - 无 response_format: json_object → json 模式降级为 system 注入约束
//   - usage 结构：input_tokens / output_tokens（message_start / message_delta 事件携带）
// =============================================================================

// chatCompletion 的 options 类型（两个分支共用，单独抽出避免重复内联）
interface ChatCompletionOptions {
  maxTokens?: number
  timeoutMs?: number
  idleTimeoutMs?: number
  temperature?: number
  // 严格 JSON 输出模式
  responseFormat?: 'json' | 'text'
  // runtime log 区分阶段（analyze）
  phase?: string
  // 业务路径必传，写 usage_log
  userId?: string
  taskId?: string
  scriptId?: string
}

async function anthropicChatCompletion(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  effective: LlmEffectiveConfig,
  options?: ChatCompletionOptions,
): Promise<string> {
  const normalizedBaseURL = normalizeAnthropicBaseURL(effective.baseURL)
  const phase = options?.phase ?? 'analyze'
  const timeoutMs = options?.timeoutMs ?? 360000
  const idleTimeoutMs = options?.idleTimeoutMs ?? 60_000

  // Anthropic 协议：system 单独传顶层字段；json 模式降级为 system 约束
  const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content)
  if (options?.responseFormat === 'json') {
    systemParts.push('输出要求：必须且只能输出一个合法的 JSON 对象，不要包含 markdown 代码块标记或任何 JSON 之外的文本。')
  }
  const chatMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  // 双计时器（与 OpenAI 分支一致）
  const controller = new AbortController()
  const absoluteTimer = setTimeout(() => controller.abort(), timeoutMs)
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => controller.abort(), idleTimeoutMs)
  }
  resetIdle()

  const client = new Anthropic({
    apiKey: effective.apiKey,
    baseURL: normalizedBaseURL,
    maxRetries: 0,
  })

  const startedAt = Date.now()
  pushRuntimeLog({
    level: 'debug',
    category: 'llm',
    message: `LLM 调用开始 phase=${phase} (stream, anthropic)`,
    meta: {
      phase,
      model: effective.model,
      baseURL: normalizedBaseURL,
      apiFormat: 'anthropic',
      source: effective.source,
      userId: options?.userId,
      taskId: options?.taskId,
      messagesCount: messages.length,
      responseFormat: options?.responseFormat ?? 'text',
      timeoutMs,
      idleTimeoutMs,
    },
  })

  try {
    const stream = client.messages.stream(
      {
        model: effective.model,
        max_tokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature ?? 0.7,
        ...(systemParts.length > 0 ? { system: systemParts.join('\n\n') } : {}),
        messages: chatMessages,
      },
      { signal: controller.signal },
    )

    let raw = ''
    let responseModel: string | undefined
    // Anthropic usage：input_tokens 在 message_start，output_tokens 在 message_delta
    let inputTokens: number | undefined
    let outputTokens: number | undefined

    for await (const event of stream) {
      resetIdle()
      if (event.type === 'message_start') {
        responseModel = event.message.model
        inputTokens = event.message.usage?.input_tokens
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        raw += event.delta.text
      } else if (event.type === 'message_delta') {
        outputTokens = event.usage?.output_tokens
      }
    }

    clearTimeout(absoluteTimer)
    if (idleTimer) clearTimeout(idleTimer)
    const latencyMs = Date.now() - startedAt

    // usage 字段映射到 OpenAI 命名（usage_log 统一结构）
    const usage = {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens:
        inputTokens !== undefined || outputTokens !== undefined
          ? (inputTokens ?? 0) + (outputTokens ?? 0)
          : undefined,
    }

    pushRuntimeLog({
      level: 'info',
      category: 'llm',
      message: `LLM 调用成功 phase=${phase} (${latencyMs}ms, raw=${raw.length} chars, anthropic)`,
      meta: {
        phase,
        latencyMs,
        model: effective.model,
        responseModel,
        rawLength: raw.length,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        charsPerSec: latencyMs > 0 ? Math.round((raw.length / latencyMs) * 1000) : 0,
      },
    })

    if (options?.userId) {
      await logUsage({
        userId: options.userId,
        taskId: options.taskId,
        scriptId: options.scriptId,
        type: 'llm',
        phase: phase as 'analyze' | 'cover' | 'test',
        model: responseModel ?? effective.model,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        latencyMs,
        success: true,
      })
    }

    return raw
  } catch (e) {
    clearTimeout(absoluteTimer)
    if (idleTimer) clearTimeout(idleTimer)
    const latencyMs = Date.now() - startedAt

    // 错误归一化（与 OpenAI 分支一致：双计时器区分 + normalizeLLMError 复用）
    let normalized: BusinessError
    if (controller.signal.aborted) {
      const isAbsolute = latencyMs >= timeoutMs - 500
      const timeoutLabel = isAbsolute
        ? `${timeoutMs}ms 总超时`
        : `${idleTimeoutMs}ms 无进展超时（chunk 间无新 token）`
      normalized = new BusinessError(
        'LLM_TIMEOUT',
        `LLM 调用超时（${timeoutLabel}）`,
        504,
      )
      pushRuntimeLog({
        level: 'error',
        category: 'llm',
        message: `LLM 调用超时 phase=${phase} (${timeoutLabel}, 已等待 ${latencyMs}ms, anthropic)`,
        meta: {
          phase,
          model: effective.model,
          baseURL: normalizedBaseURL,
          timeoutMs,
          idleTimeoutMs,
          latencyMs,
        },
      })
    } else {
      normalized = normalizeLLMError(e, {
        model: effective.model,
        baseURL: normalizedBaseURL,
        phase,
      })
    }

    if (options?.userId) {
      await logUsage({
        userId: options.userId,
        taskId: options.taskId,
        scriptId: options.scriptId,
        type: 'llm',
        phase: phase as 'analyze' | 'cover' | 'test',
        model: effective.model,
        latencyMs,
        success: false,
        errorCode: normalized.code,
      })
    }

    throw normalized
  }
}
