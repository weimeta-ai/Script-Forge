// =============================================================================
// 种子脚本：初始化 credit_rules 表
// -----------------------------------------------------------------------------
// 用法：
//   pnpm tsx src/scripts/seed-credit-rules.ts
//
// 展会场景：
//   每次剧本分析统一消耗 2,000 积分（analyze.standard）。
//   cover 任务保留规则但默认禁用，避免误扣费。
//
// 幂等：每个 code 已存在时跳过；若 creditsPerUnit/enabled 与种子不一致则更新（修复旧数据）
//   例如：旧库 analyze.standard=10，重跑本脚本会自动更新为 2000
//   若需手动改其他字段（name），可先 DELETE 再重跑
// =============================================================================

import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { creditRules } from '../db/schema'
import { logger } from '../logger'

interface SeedRule {
  code: string
  name: string
  creditsPerUnit: number
  unitType: 'per_call'
  enabled: boolean
}

const DEFAULT_RULES: SeedRule[] = [
  // 展会场景：唯一启用的扣费规则
  { code: 'analyze.standard', name: '剧本分析', creditsPerUnit: 2000, unitType: 'per_call', enabled: true },
  // 以下规则保留但默认禁用（展会场景不用，避免回退代码）
  // 注：analyze.fast / analyze.ultra 已删除（后端 resolveRuleCode 统一返回 analyze.standard，不再引用）
  { code: 'cover.default', name: '封面生成（一次 3 张）', creditsPerUnit: 5, unitType: 'per_call', enabled: false },
]

// 幂等：每个 code 已存在时跳过；若 creditsPerUnit/enabled 与种子不一致则更新（修复旧数据）
//   例如：旧库 analyze.standard=10，重跑本脚本会自动更新为 2000
async function seedOne(rule: SeedRule): Promise<void> {
  const existing = await db
    .select()
    .from(creditRules)
    .where(eq(creditRules.code, rule.code))
    .limit(1)
  if (existing.length === 0) {
    await db.insert(creditRules).values(rule)
    logger.info({ code: rule.code, creditsPerUnit: rule.creditsPerUnit }, '✓ 已创建规则')
    return
  }

  const cur = existing[0]
  if (cur.creditsPerUnit !== rule.creditsPerUnit || cur.enabled !== rule.enabled) {
    await db
      .update(creditRules)
      .set({ creditsPerUnit: rule.creditsPerUnit, enabled: rule.enabled, name: rule.name })
      .where(eq(creditRules.id, cur.id))
    logger.info(
      { code: rule.code, from: { creditsPerUnit: cur.creditsPerUnit, enabled: cur.enabled }, to: { creditsPerUnit: rule.creditsPerUnit, enabled: rule.enabled } },
      '✓ 已更新规则（修复旧数据）',
    )
    return
  }

  logger.info({ code: rule.code }, '⚠️  规则已存在且一致，跳过')
}

async function main(): Promise<void> {
  logger.info('开始初始化 credit_rules ...')
  for (const rule of DEFAULT_RULES) {
    await seedOne(rule)
  }
  logger.info('✅ credit_rules 初始化完成')
  process.exit(0)
}

main().catch((err) => {
  logger.error({ err }, '❌ credit_rules 初始化失败')
  process.exit(1)
})
