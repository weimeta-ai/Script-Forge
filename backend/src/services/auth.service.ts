// =============================================================================
// 鉴权业务服务层
// -----------------------------------------------------------------------------
// 职责：
//   - register  注册新用户
//   - login     用户登录（验证密码 + 签发 JWT）
//   - getMe     获取当前登录用户信息
//   - refresh   刷新 token（一期可选）
//
// 不做：
//   - HTTP 请求/响应处理（在 routes 层）
//   - 数据库 SQL（在 repository 层）
//   - 密码哈希算法（在 lib/password.ts）
//
// 分层好处：
//   - 业务逻辑可测试（不依赖 HTTP）
//   - 一个 service 可被多个 route 复用（如 Agent 调用）
// =============================================================================

import { userRepository } from '../repositories/user.repository'
import { hashPassword, verifyPassword, validatePasswordStrength } from '../lib/password'
import { signToken, type AppJwtPayload } from '../lib/jwt'
import { badRequest, unauthorized, notFound } from '../lib/errors'

// -----------------------------------------------------------------------------
// 注册服务
// 入：{ username, password, displayName }
// 出：{ user, token }（注册即登录）
// -----------------------------------------------------------------------------
export async function registerUser(input: {
  username: string
  password: string
  displayName?: string
}) {
  // 1. 校验密码强度
  const pwdError = validatePasswordStrength(input.password)
  if (pwdError) {
    throw badRequest('WEAK_PASSWORD', pwdError)
  }

  // 2. 检查用户名是否已存在
  const existing = await userRepository.findByUsername(input.username)
  if (existing) {
    throw badRequest('USERNAME_TAKEN', '用户名已被使用')
  }

  // 3. 哈希密码（绝不存明文）
  const passwordHash = await hashPassword(input.password)

  // 4. 创建用户
  const user = await userRepository.create({
    username: input.username,
    passwordHash,
    displayName: input.displayName ?? input.username,
    role: 'user',          // 一期注册都是普通用户；admin 通过 seed 创建
  })

  // 5. 签发 token
  const token = await signToken({
    userId: user.id,
    username: user.username,
    role: user.role,
  })

  return { user: sanitizeUser(user), token }
}

// -----------------------------------------------------------------------------
// 登录服务
// 入：{ username, password }
// 出：{ user, token }
// -----------------------------------------------------------------------------
export async function loginUser(input: { username: string; password: string }) {
  // 1. 查用户（含 password_hash）
  const user = await userRepository.findByUsername(input.username)
  if (!user) {
    // 安全建议：用户不存在和密码错误返回同样信息（防枚举攻击）
    throw unauthorized('用户名或密码错误')
  }

  // 2. 验证密码
  const ok = await verifyPassword(input.password, user.passwordHash)
  if (!ok) {
    throw unauthorized('用户名或密码错误')
  }

  // 3. 签发 token
  const token = await signToken({
    userId: user.id,
    username: user.username,
    role: user.role,
  })

  return { user: sanitizeUser(user), token }
}

// -----------------------------------------------------------------------------
// 获取当前用户信息（根据 JWT payload）
// 出：脱敏后的 user 对象（不含 password_hash）
// -----------------------------------------------------------------------------
export async function getCurrentUser(payload: AppJwtPayload) {
  const user = await userRepository.findById(payload.userId)
  if (!user) {
    throw notFound('用户')
  }
  return sanitizeUser(user)
}

// -----------------------------------------------------------------------------
// 脱敏：移除 passwordHash，避免泄露给前端
// -----------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sanitizeUser(user: any) {
  const { passwordHash, ...safe } = user
  return safe
}
