// =============================================================================
// admin 用户管理 zod 校验
// -----------------------------------------------------------------------------
// 复用 auth.schema 的密码强度规则；user-config 直接复用现有 llm-config / image-config schema
// =============================================================================

import { z } from 'zod'

// GET /admin/users 查询参数（query）
export const listUsersQuerySchema = z.object({
  keyword: z.string().max(64).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  role: z.enum(['admin', 'user']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

// POST /admin/users 创建用户
export const createUserSchema = z.object({
  username: z
    .string()
    .min(3, '用户名至少 3 个字符')
    .max(64)
    .regex(/^[a-zA-Z0-9_]+$/, '用户名只能含字母、数字、下划线'),
  password: z
    .string()
    .min(6, '密码至少 6 位')
    .max(64, '密码最长 64 字符'),
  displayName: z.string().max(64).optional(),
  role: z.enum(['admin', 'user']).default('user'),
  status: z.enum(['active', 'disabled']).default('active'),
  copyTemplateConfig: z.boolean().default(false),
})

// PATCH /admin/users/:id 编辑用户（全部可选）
// 注意：creditBalance 不在此接口调整，改用 POST /admin/users/:id/credits/adjust
export const updateUserSchema = z.object({
  displayName: z.string().max(64).optional(),
  role: z.enum(['admin', 'user']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  password: z
    .string()
    .min(6, '密码至少 6 位')
    .max(64, '密码最长 64 字符')
    .optional(),
})

export type ListUsersQueryInput = z.infer<typeof listUsersQuerySchema>
export type CreateUserInputParsed = z.infer<typeof createUserSchema>
export type UpdateUserInputParsed = z.infer<typeof updateUserSchema>
