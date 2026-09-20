// =============================================================================
// Prompt 配置请求体校验（Zod）
// -----------------------------------------------------------------------------
// 用于：
//   PUT   /prompt-config/:type                  保存新版本
// =============================================================================

import { z } from 'zod'

// 合法 type 集合（与 db/schema/prompt-settings.ts 保持一致）
const TYPE_OPTIONS = ['report_system', 'cover_template'] as const

// PUT /prompt-config/:type 请求体
//   - content: 模板原文（cover_template 含 {{title}} 等占位符）
//   - note:    保存备注（可选，最长 200 字）
export const savePromptSchema = z.object({
  content: z
    .string({ error: '内容不能为空' })
    .min(1, '内容不能为空')
    .max(200000, '单条 prompt 最长 200KB'),
  note: z
    .string()
    .max(200, '备注最长 200 字符')
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null)),
})

// 路由参数 :type 合法性（Hono 的 c.req.param() 不走 zod，单独校验）
export function isValidPromptType(type: string): type is (typeof TYPE_OPTIONS)[number] {
  return (TYPE_OPTIONS as readonly string[]).includes(type)
}

export type SavePromptInput = z.infer<typeof savePromptSchema>
