// =============================================================================
// JWT 工具（基于 jose 库）
// -----------------------------------------------------------------------------
// 【前端转全栈知识点】
// JWT 是什么：
//   一段服务器签发的"防伪通行证"，前端拿到后存起来，每次请求带上。
//   服务器收到后用密钥验签，确认是合法签发的。
//
// JWT 三段式（用 . 分隔）：
//   header.payload.signature
//   - header    算法信息（如 HS256）
//   - payload   实际数据（如 { userId, role, exp }）
//   - signature 用 JWT_SECRET 对 header+payload 计算的签名
//
// 为什么用 jose 而不是 jsonwebtoken：
//   - jose 纯 TypeScript，无 native 依赖（jsonwebtoken 依赖 crypto）
//   - jose 支持边缘运行时（Cloudflare Workers）
//   - jose API 更现代（async/await）
//
// 安全要点：
//   - JWT_SECRET 永远不能泄露（泄露=任何人都能伪造 token）
//   - payload 不要放敏感信息（token 可被 base64 解码读出内容）
//   - 必须设过期时间（exp），即使泄露也只影响一段时间
// =============================================================================

import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { env } from '../config/env'

// -----------------------------------------------------------------------------
// 将字符串密钥转换为 Uint8Array（jose 要求）
// -----------------------------------------------------------------------------
// TextEncoder 编码字符串为 UTF-8 字节数组
const secretKey = new TextEncoder().encode(env.JWT_SECRET)

// 自定义 JWT payload 类型（继承 jose 的 JWTPayload）
// 让 ctx.user 在中间件中有类型推断
export interface AppJwtPayload extends JWTPayload {
  userId: string          // 用户 ID（必填）
  username: string        // 用户名（方便日志）
  role: string            // 角色（admin/user）
}

// -----------------------------------------------------------------------------
// 签发 JWT
// 用法：const token = await signToken({ userId, username, role })
// -----------------------------------------------------------------------------
export async function signToken(payload: Omit<AppJwtPayload, keyof JWTPayload>): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })           // 用 HMAC-SHA256 算法
    .setIssuedAt()                                   // iat：签发时间
    .setIssuer('drama-predict-backend')              // iss：签发者
    .setAudience('drama-predict-frontend')           // aud：受众（前端）
    .setExpirationTime(env.JWT_EXPIRES_IN)           // exp：过期时间（如 '7d'）
    .sign(secretKey)                                 // 用密钥签名
}

// -----------------------------------------------------------------------------
// 验证 JWT
// 失败抛错（让上层中间件捕获）
// 用法：const payload = await verifyToken(token)
// -----------------------------------------------------------------------------
export async function verifyToken(token: string): Promise<AppJwtPayload> {
  const { payload } = await jwtVerify(token, secretKey, {
    issuer: 'drama-predict-backend',
    audience: 'drama-predict-frontend',
  })
  return payload as AppJwtPayload
}
