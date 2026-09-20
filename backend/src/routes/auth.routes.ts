// =============================================================================
// 鉴权路由
// -----------------------------------------------------------------------------
// 路由 = HTTP 接口定义
//   - 接收请求 + 校验参数
//   - 调用 service
//   - 返回统一响应
// 不做：业务逻辑（在 service）
// =============================================================================

import { Hono } from 'hono'
import { loginSchema, registerSchema } from '../schemas/auth.schema'
import { registerUser, loginUser, getCurrentUser } from '../services/auth.service'
import { requireAuth } from '../middlewares/auth.middleware'
import { ok } from '../lib/response'
import { env } from '../config/env'
import type { AppJwtPayload } from '../lib/jwt'
import type { BusinessError } from '../lib/errors'

export const authRoutes = new Hono<{
  Variables: {
    user: AppJwtPayload
  }
}>()

// -----------------------------------------------------------------------------
// POST /auth/register
// 注册新用户（默认关闭，admin 通过后台创建账号）
// -----------------------------------------------------------------------------
authRoutes.post('/register', async (c) => {
  // 软关闭：env.REGISTRATION_ENABLED 默认 false，admin 需要时显式开启
  if (!env.REGISTRATION_ENABLED) {
    const err: BusinessError = {
      name: 'BusinessError',
      code: 'REGISTRATION_DISABLED',
      message: '已关闭自助注册，请联系管理员',
      status: 403,
    }
    throw err
  }

  // 1. 解析请求体
  const body = await c.req.json().catch(() => null)
  if (!body) {
    const err: BusinessError = {
      name: 'BusinessError',
      code: 'INVALID_BODY',
      message: '请求体不是合法 JSON',
      status: 400,
    }
    throw err
  }

  // 2. Zod 校验
  const parsed = registerSchema.safeParse(body)
  if (!parsed.success) {
    const err: BusinessError = {
      name: 'BusinessError',
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message ?? '参数错误',
      status: 400,
    }
    throw err
  }

  // 3. 调 service
  const result = await registerUser(parsed.data)

  // 4. 返回成功响应
  return ok(c, result, 201)
})

// -----------------------------------------------------------------------------
// POST /auth/login
// 用户登录
// -----------------------------------------------------------------------------
authRoutes.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) {
    const err: BusinessError = {
      name: 'BusinessError',
      code: 'INVALID_BODY',
      message: '请求体不是合法 JSON',
      status: 400,
    }
    throw err
  }

  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) {
    const err: BusinessError = {
      name: 'BusinessError',
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message ?? '参数错误',
      status: 400,
    }
    throw err
  }

  const result = await loginUser(parsed.data)
  return ok(c, result)
})

// -----------------------------------------------------------------------------
// GET /auth/me
// 获取当前登录用户信息（需要 token）
// -----------------------------------------------------------------------------
authRoutes.get('/me', requireAuth, async (c) => {
  const payload = c.get('user') as AppJwtPayload
  const user = await getCurrentUser(payload)
  return ok(c, user)
})

// -----------------------------------------------------------------------------
// POST /auth/logout
// 登出（前端清除本地 token 即可，后端仅返回成功；JWT 无状态，无需服务端撤销）
// -----------------------------------------------------------------------------
authRoutes.post('/logout', requireAuth, async (c) => {
  return ok(c, { loggedOut: true })
})
