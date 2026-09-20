// =============================================================================
// 图片模型配置请求体校验（Zod）
// -----------------------------------------------------------------------------
// 用于：
//   PUT  /image-config         更新配置
//   POST /image-config/test    测试连接
//   POST /image-config/generate 生成图片
// =============================================================================

import { z } from 'zod'

// 合法尺寸（与 OpenAI Images API 一致）
// 注意：768x768 已移除，部分 OpenAI 兼容网关不支持该尺寸
// 若未来有自建 SD/Flux 网关需要此尺寸，可在此处加回
const SIZE_OPTIONS = [
  '1024x1024',
  '1024x1792',
  '1792x1024',
] as const

// PUT /image-config 请求体
// apiKey 设计同 llm-config：留空表示沿用 DB 已存的值
export const updateImageConfigSchema = z.object({
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
    .string({ error: '模型不能为空' })
    .min(1, '模型不能为空')
    .max(128, '模型名最长 128 字符'),
  baseUrl: z
    .string({ error: '服务地址不能为空' })
    .min(1, '服务地址不能为空')
    .max(512, '服务地址最长 512 字符')
    .url('服务地址必须是合法 URL（如 https://api.openai.com/v1）'),
  timeoutMs: z.coerce
    .number()
    .int('超时必须是整数')
    .min(5000, '超时下限 5 秒')
    .max(600000, '超时上限 10 分钟')
    .default(120000),
  defaultSize: z
    .string()
    .refine((v) => SIZE_OPTIONS.includes(v as (typeof SIZE_OPTIONS)[number]), {
      message: `尺寸必须是 ${SIZE_OPTIONS.join(' / ')} 之一`,
    })
    .default('1024x1024'),
  defaultCount: z.coerce
    .number()
    .int('张数必须是整数')
    .min(1, '张数最少 1')
    .max(4, '张数最多 4')
    .default(1),
})

// POST /image-config/test 请求体（均可选）
export const testImageConfigSchema = z.object({
  apiKey: z.string().max(512).optional(),
  model: z.string().max(128).optional(),
  baseUrl: z.string().max(512).url().optional(),
})

// POST /image-config/generate 请求体
export const generateImageSchema = z.object({
  prompt: z
    .string({ error: '提示词不能为空' })
    .min(1, '提示词不能为空')
    .max(4000, '提示词最长 4000 字符'),
  size: z
    .string()
    .refine((v) => SIZE_OPTIONS.includes(v as (typeof SIZE_OPTIONS)[number]), {
      message: `尺寸必须是 ${SIZE_OPTIONS.join(' / ')} 之一`,
    })
    .optional(),
  count: z.coerce.number().int().min(1).max(4).optional(),
})

export type UpdateImageConfigInput = z.infer<typeof updateImageConfigSchema>
export type TestImageConfigInput = z.infer<typeof testImageConfigSchema>
export type GenerateImageInput = z.infer<typeof generateImageSchema>
