// =============================================================================
// 种子脚本：初始化 prompt_settings 表（report_system / cover_template 各 v1）
// -----------------------------------------------------------------------------
// 用法：
//   yarn db:seed:prompts
//
// 场景：
//   首次部署后，prompt_settings 表为空 → admin 后台无内容可编辑。
//   跑此脚本：
//     - report_system   从 refer/system_prompt.md 读取（保持原 fallback 一致）
//     - cover_template  内置默认模板（基于 src/lib/cover-prompt.ts 原硬编码反推）
//
// 幂等：每个 type 已有 is_current=true 行时跳过，可重复运行。
// =============================================================================

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/client'
import { promptSettings } from '../db/schema'
import { logger } from '../logger'

// report_system 默认内容：读 refer/system_prompt.md（保持与原 fallback 一致）
const SYSTEM_PROMPT_PATH = resolve(process.cwd(), 'refer/system_prompt.md')

// cover_template 默认模板（开源版占位，与 src/lib/cover-prompt.ts 的 FALLBACK_COVER_TEMPLATE 保持一致）
// - {{title}}: 剧本标题（缺失时 fallback "未命名剧本"）
// - {{genre}}: 题材（缺失时 fallback "都市情感"）
// - {{excerpt_block}}: excerpt 非空时展开为 "故事核心：{excerpt}。"，否则空串
// 完整业务模板请在管理后台（prompt_settings.cover_template）配置
const DEFAULT_COVER_TEMPLATE =
  '竖版海报封面：{{title}}，题材：{{genre}}。{{excerpt_block}}'

interface SeedItem {
  type: 'report_system' | 'cover_template'
  content: string
  note: string
}

async function seedOne(item: SeedItem): Promise<void> {
  // 已有 is_current=true → 跳过
  const existing = await db
    .select({ id: promptSettings.id })
    .from(promptSettings)
    .where(
      and(
        eq(promptSettings.type, item.type),
        eq(promptSettings.isCurrent, true),
      ),
    )
    .limit(1)
  if (existing.length > 0) {
    logger.info({ type: item.type }, '⚠️  已存在 is_current=true，跳过')
    return
  }

  await db.insert(promptSettings).values({
    type: item.type,
    content: item.content,
    note: item.note,
    version: 1,
    isCurrent: true,
    createdBy: 'system-seed',
  })
  logger.info(
    { type: item.type, contentLen: item.content.length },
    '✅ 已写入 v1',
  )
}

async function main() {
  logger.info('🌱 开始 seed prompt_settings...')

  // 1. report_system：读 refer/system_prompt.md
  const systemPromptContent = readFileSync(SYSTEM_PROMPT_PATH, 'utf-8')

  // 2. cover_template：内置默认
  const coverTemplateContent = DEFAULT_COVER_TEMPLATE

  await seedOne({
    type: 'report_system',
    content: systemPromptContent,
    note: '从 refer/system_prompt.md 初始化',
  })
  await seedOne({
    type: 'cover_template',
    content: coverTemplateContent,
    note: '从 src/lib/cover-prompt.ts 默认拼接逻辑反推',
  })

  logger.info('----------------------------------------')
  logger.info('prompt_settings seed 完成')
  logger.info('----------------------------------------')

  process.exit(0)
}

main().catch((err) => {
  logger.error({ err }, '❌ seed-prompts 执行失败')
  process.exit(1)
})
