// =============================================================================
// 登录页轮播图请求体校验（Zod）
// -----------------------------------------------------------------------------
// 用于：
//   PATCH /login-banners/:id   更新标题 / 排序 / 启用
//   POST  /login-banners       multipart 上传（文件用 c.req.parseBody 解析，不在此校验）
// =============================================================================

import { z } from 'zod'

// 允许的图片 MIME（multipart 上传时校验）
export const ALLOWED_BANNER_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export const allowedBannerMimeSchema = z.enum(ALLOWED_BANNER_MIME)

// PATCH /login-banners/:id 请求体（所有字段可选）
// title 三态语义：
//   - undefined → 不更新
//   - null 或 trim 后为空 → 清空标题
//   - 非空字符串 → 更新
export const updateBannerSchema = z.object({
  title: z
    .string()
    .max(120, '标题最长 120 字符')
    .nullish()
    .transform((v) => {
      if (v === undefined) return undefined
      if (v === null) return null
      const trimmed = v.trim()
      return trimmed || null
    }),
  sortOrder: z.coerce
    .number()
    .int('排序必须是整数')
    .min(0, '排序下限 0')
    .max(99999, '排序上限 99999')
    .optional(),
  isActive: z.boolean().optional(),
})

export type UpdateBannerInput = z.infer<typeof updateBannerSchema>
