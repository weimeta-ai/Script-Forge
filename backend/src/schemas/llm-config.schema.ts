// =============================================================================
// LLM 配置请求体校验（Zod）
// -----------------------------------------------------------------------------
// 用于 PUT /llm-config（更新配置）和 POST /llm-config/test（测试连接）
//
// apiFormat：admin 可选协议格式
//   - 'openai'：OpenAI 兼容 /v1/chat/completions（默认，绝大多数网关）
//   - 'anthropic'：Anthropic 原生 /v1/messages（直连官方或 Claude 系网关）
// =============================================================================

import { z } from 'zod'

// PUT /llm-config 请求体
// apiKey 设计为可选：用户不想改 key 时留空，后端保留 DB 已存的值（避免每次保存都要重新输 key）
export const updateLlmConfigSchema = z.object({
  name: z
    .string({ error: '配置名称不能为空' })
    .min(1, '配置名称不能为空')
    .max(64, '配置名称最长 64 字符'),
  apiKey: z
    .string()
    .max(512, 'API Key 最长 512 字符')
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  model: z
    .string({ error: '默认模型不能为空' })
    .min(1, '默认模型不能为空')
    .max(128, '默认模型最长 128 字符'),
  baseUrl: z
    .string({ error: '服务地址不能为空' })
    .min(1, '服务地址不能为空')
    .max(512, '服务地址最长 512 字符')
    .url('服务地址必须是合法 URL（如 https://your-newapi/v1）'),
  // API 协议格式（openai 兼容 / anthropic 原生）
  // 默认 'openai'：兼容存量配置（迁移前无此字段的记录按 openai 处理）
  apiFormat: z.enum(['openai', 'anthropic']).default('openai'),
  timeoutMs: z.coerce
    .number()
    .int('超时必须是整数')
    .min(5000, '超时下限 5 秒')
    .max(300000, '超时上限 5 分钟')
    .default(90000),
  // 默认分析模式（前端未显式选择时使用此值）
  defaultAnalyzeMode: z
    .enum(['standard', 'fast', 'ultra'])
    .default('standard'),
})

// POST /llm-config/test 请求体（可选填，不传则用当前 DB 配置测试）
export const testLlmConfigSchema = z.object({
  // 不传 apiKey 时：用 DB 已保存的（避免前端拿到明文回填）
  // 传了 apiKey 时：用新值测试（用户改了 key 还没保存，先测试再保存）
  apiKey: z.string().max(512).optional(),
  model: z.string().max(128).optional(),
  baseUrl: z.string().max(512).url().optional(),
  apiFormat: z.enum(['openai', 'anthropic']).optional(),
})

export type UpdateLlmConfigInput = z.infer<typeof updateLlmConfigSchema>
export type TestLlmConfigInput = z.infer<typeof testLlmConfigSchema>
