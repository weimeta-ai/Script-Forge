// =============================================================================
// 种子脚本：创建初始 admin 账号
// -----------------------------------------------------------------------------
// 用法：
//   yarn db:seed
//
// 场景：
//   第一次部署系统时，数据库是空的，没法登录。
//   跑这个脚本，会创建一个 admin 账号。
//   管理员账号和密码必须通过 SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD 注入。
// =============================================================================

import { userRepository } from '../repositories/user.repository'
import { hashPassword } from '../lib/password'
import { logger } from '../logger'

async function main() {
  logger.info('🌱 开始执行种子脚本...')

  // 所有初始凭据都从环境变量读取，避免仓库内出现可复用的默认密码。
  const username = process.env.SEED_ADMIN_USERNAME || 'admin'
  const password = process.env.SEED_ADMIN_PASSWORD?.trim()
  if (!password) {
    throw new Error(
      'SEED_ADMIN_PASSWORD 未设置。请通过环境变量提供一次性初始管理员密码，至少 6 位。',
    )
  }
  const displayName = process.env.SEED_ADMIN_DISPLAY_NAME || '管理员'

  // 检查是否已存在
  const existing = await userRepository.findByUsername(username)
  if (existing) {
    logger.info({ username }, '⚠️  admin 账号已存在，跳过创建')
    process.exit(0)
  }

  // 哈希密码
  const passwordHash = await hashPassword(password)

  // 创建 admin
  const user = await userRepository.create({
    username,
    passwordHash,
    displayName,
    role: 'admin',
  })

  logger.info({ userId: user.id, username }, '✅ admin 账号创建成功')
  logger.info('----------------------------------------')
  logger.info(`用户名：${username}`)
  logger.info(`密码：${password}（建议立即在前端修改）`)
  logger.info('----------------------------------------')

  process.exit(0)
}

// 错误处理
main().catch((err) => {
  logger.error({ err }, '❌ 种子脚本执行失败')
  process.exit(1)
})

// 优雅关闭数据库连接
process.on('exit', async () => {
  // postgres.js 在进程退出时自动关闭连接
})
