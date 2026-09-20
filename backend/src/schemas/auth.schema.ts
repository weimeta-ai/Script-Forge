// =============================================================================
// 鉴权请求体校验（Zod）
// -----------------------------------------------------------------------------
// 为什么单独成文件：
//   Zod schema 可被 Hono 中间件复用，也可在前端共享类型
// =============================================================================

import { z } from 'zod'

// 登录请求体
export const loginSchema = z.object({
  username: z.string().min(1, '用户名不能为空').max(64),
  password: z.string().min(1, '密码不能为空').max(64),
})

// 注册请求体
export const registerSchema = z.object({
  username: z
    .string()
    .min(3, '用户名至少 3 个字符')
    .max(64)
    .regex(/^[a-zA-Z0-9_]+$/, '用户名只能含字母、数字、下划线'),
  password: z.string().min(6, '密码至少 6 位').max(64),
  displayName: z.string().max(64).optional(),
})

// 推导类型（前端可以共享这些类型）
export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
