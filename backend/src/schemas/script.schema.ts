// 剧本请求体校验（p00 同款简化）
// -----------------------------------------------------------------------------
// 双模式：粘贴文本（createScriptSchema）+ 上传文件（multipart，title 在 route 层解析）
// =============================================================================

import { z } from 'zod'

// 粘贴文本模式：JSON body
export const createScriptSchema = z.object({
  title: z
    .string({ error: '标题不能为空' })
    .min(1, '标题不能为空')
    .max(255, '标题最长 255 字符'),
  genre: z.string().max(64, '题材最长 64 字符').optional(),
  sourceContent: z
    .string({ error: '剧本内容不能为空' })
    .min(50, '剧本内容至少 50 字（分析需要足够上下文）')
    .max(500000, '剧本内容最长 50 万字'),
})

export type CreateScriptInput = z.infer<typeof createScriptSchema>

// 上传文件模式：multipart/form-data 文本字段
export const uploadScriptSchema = z.object({
  title: z
    .string({ error: '标题不能为空' })
    .min(1, '标题不能为空')
    .max(255, '标题最长 255 字符'),
  genre: z.string().max(64, '题材最长 64 字符').optional(),
})

export type UploadScriptInput = z.infer<typeof uploadScriptSchema>

// 触发分析请求体（POST /scripts/:id/analyze）
// mode 为可选：用户在前端选择 standard / fast / ultra；未传时 service 层从 llm_settings 取默认
export const analyzeSchema = z.object({
  mode: z.enum(['standard', 'fast', 'ultra']).optional(),
})

export type AnalyzeInput = z.infer<typeof analyzeSchema>

// 重试分析请求体（POST /scripts/:id/analyze/retry）
// taskId 必传：指定用哪个旧 task 的 mode 来重试
export const retryAnalyzeSchema = z.object({
  taskId: z
    .string({ error: 'taskId 不能为空' })
    .uuid('taskId 必须是合法 UUID'),
})

export type RetryAnalyzeInput = z.infer<typeof retryAnalyzeSchema>
