// =============================================================================
// 鉴权中间件（JWT 校验）
// -----------------------------------------------------------------------------
// 【前端转全栈知识点】
// 中间件做什么：
//   拦截请求，从 Authorization 头提取 JWT，验证签名
//   验证通过 → 把用户信息塞到 ctx.set('user', payload)，业务路由直接用
//   验证失败 → 抛 401 错误（让全局 onError 处理）
//
// HTTP Authorization 头格式：
//   Authorization: Bearer eyJhbGc...
//   ↑ 标准名     ↑ 固定前缀 ↑ JWT 三段
//
// 为什么用 "Bearer" 前缀：
//   HTTP 规范 RFC 6750 规定的认证方案
//   "Bearer" 表示"持有此 token 即有权限"
// =============================================================================

import type { Context, Next } from 'hono'
import { verifyToken, type AppJwtPayload } from '../lib/jwt'
import { unauthorized } from '../lib/errors'
import { userRepository } from '../repositories/user.repository'

// -----------------------------------------------------------------------------
// 用户存在性缓存
// -----------------------------------------------------------------------------
// 为什么需要：requireAuth 之前只验 JWT 签名，不查 users 表
//   → 当 user 被删 / DB 被重建但前端持有旧 token 时，会一路放行到 INSERT
//   → 最终在业务代码里炸外键错误（scripts_user_id_users_id_fk 等）
//   → 加一次 findById 校验，失效 token 主动返回 401，前端自动清 token 跳登录
//
// 缓存策略：TTL 60s 的 Map<userId, { exists, expireAt }>
//   - 命中且未过期：直接返回，避免每个鉴权请求都查库
//   - 未命中或过期：查库并写入缓存
//   - 用户被删后最长 60s 内旧 token 仍可用，可接受（远好于炸外键）
// -----------------------------------------------------------------------------
const USER_EXIST_CACHE_TTL = 60_000
const userExistCache = new Map<string, { exists: boolean; expireAt: number }>()

async function checkUserExists(userId: string): Promise<boolean> {
  const now = Date.now()
  const cached = userExistCache.get(userId)
  if (cached && cached.expireAt > now) {
    return cached.exists
  }
  const user = await userRepository.findById(userId)
  const exists = !!user
  userExistCache.set(userId, { exists, expireAt: now + USER_EXIST_CACHE_TTL })
  return exists
}

// -----------------------------------------------------------------------------
// 必须登录中间件
// 用法：app.use('/api/*', requireAuth)
// -----------------------------------------------------------------------------
export async function requireAuth(c: Context, next: Next) {
  // 1. 从请求头取 Authorization
  const authHeader = c.req.header('Authorization')

  if (!authHeader) {
    throw unauthorized('缺少 Authorization 头')
  }

  // 2. 校验 Bearer 前缀
  if (!authHeader.startsWith('Bearer ')) {
    throw unauthorized('Authorization 格式错误，应为 "Bearer <token>"')
  }

  const token = authHeader.slice(7) // 'Bearer '.length === 7

  // 3. 验证 token
  let payload: AppJwtPayload
  try {
    payload = await verifyToken(token)
  } catch {
    throw unauthorized('Token 无效或已过期')
  }

  // 4. 校验 user 在 users 表中仍存在（防止旧 token 触发下游外键错误）
  const exists = await checkUserExists(payload.userId)
  if (!exists) {
    userExistCache.delete(payload.userId)
    throw unauthorized('用户不存在或已被删除，请重新登录')
  }

  // 5. 把用户信息塞到 context，后续路由直接取
  c.set('user', payload)

  // 6. 继续执行下一个中间件 / 路由 handler
  await next()
}

// -----------------------------------------------------------------------------
// 可选登录中间件（不强制，但有 token 就解析）
// 用法：公开接口但想识别登录用户（如首页推荐）
// -----------------------------------------------------------------------------
export async function optionalAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization')

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    try {
      const payload = await verifyToken(token)
      c.set('user', payload)
    } catch {
      // token 无效就当未登录处理，不报错
    }
  }

  await next()
}

// -----------------------------------------------------------------------------
// 角色校验中间件（在 requireAuth 后用）
// 用法：app.use('/admin/*', requireAuth, requireRole('admin'))
// -----------------------------------------------------------------------------
export function requireRole(role: string) {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as AppJwtPayload | undefined

    if (!user) {
      throw unauthorized('未登录')
    }

    if (user.role !== role) {
      throw unauthorized('权限不足')
    }

    await next()
  }
}
