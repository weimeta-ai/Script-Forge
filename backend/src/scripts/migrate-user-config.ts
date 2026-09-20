// =============================================================================
// 一次性迁移脚本：为所有现有用户复制全局 LLM/图片模板到 per-user 配置
// -----------------------------------------------------------------------------
// 背景：
//   Phase 3 改造后，业务路径强制走 per-user 配置（user_llm_settings / user_image_settings）
//   未配置则抛 USER_LLM_NOT_CONFIGURED / IMAGE_NOT_CONFIGURED
//   原有 admin / 普通用户依赖全局 llm_settings，改造后会立即无法提交任务
//
// 用法：
//   tsx src/scripts/migrate-user-config.ts
//   或加到 package.json scripts: "migrate:user-config": "tsx src/scripts/migrate-user-config.ts"
//
// 行为：
//   - 遍历所有 users（含 admin / user / disabled）
//   - 已有 per-user 配置则跳过；否则从全局模板复制
//   - 全局模板未配置时打印警告，继续下一个（不阻塞）
//   - 失败的用户汇总输出
// =============================================================================

import { userRepository } from '../repositories/user.repository'
import * as userLlmConfigService from '../services/user-llm-config.service'
import * as userImageConfigService from '../services/user-image-config.service'
import { logger } from '../logger'

async function main() {
  logger.info('🚀 开始迁移：为现有用户复制全局模板到 per-user 配置')

  // 拉所有用户（不分 status：disabled 也复制，避免重新启用时无配置）
  const { items: users } = await userRepository.listWithStats({ pageSize: 1000 })
  logger.info(`找到 ${users.length} 个用户`)

  let llmOk = 0
  let llmSkip = 0
  let llmFail = 0
  let imageOk = 0
  let imageSkip = 0
  let imageFail = 0
  const failures: Array<{ userId: string; username: string; error: string }> = []

  for (const u of users) {
    // LLM：已有则跳过，无则从模板复制
    try {
      const existing = await userLlmConfigService.getMaskedByUser(u.id)
      if (existing) {
        llmSkip++
      } else {
        await userLlmConfigService.copyFromTemplate(u.id)
        llmOk++
        logger.info({ userId: u.id, username: u.username }, '✅ LLM 配置已复制')
      }
    } catch (e) {
      llmFail++
      failures.push({
        userId: u.id,
        username: u.username,
        error: `LLM: ${e instanceof Error ? e.message : String(e)}`,
      })
    }

    // 图片：同上
    try {
      const existing = await userImageConfigService.getMaskedByUser(u.id)
      if (existing) {
        imageSkip++
      } else {
        await userImageConfigService.copyFromTemplate(u.id)
        imageOk++
        logger.info({ userId: u.id, username: u.username }, '✅ 图片配置已复制')
      }
    } catch (e) {
      imageFail++
      failures.push({
        userId: u.id,
        username: u.username,
        error: `Image: ${e instanceof Error ? e.message : String(e)}`,
      })
    }
  }

  logger.info('----------------------------------------')
  logger.info('迁移结果汇总：')
  logger.info(`  LLM  : 成功 ${llmOk} / 跳过 ${llmSkip} / 失败 ${llmFail}`)
  logger.info(`  图片 : 成功 ${imageOk} / 跳过 ${imageSkip} / 失败 ${imageFail}`)
  if (failures.length > 0) {
    logger.warn(`失败明细（${failures.length} 条）：`)
    for (const f of failures) {
      logger.warn({ userId: f.userId, username: f.username, error: f.error }, '- 失败')
    }
  }
  logger.info('----------------------------------------')

  process.exit(0)
}

main().catch((err) => {
  logger.error({ err }, '❌ 迁移脚本执行失败')
  process.exit(1)
})
