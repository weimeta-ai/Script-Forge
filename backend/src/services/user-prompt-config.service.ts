// =============================================================================
// 用户级 Prompt 配置业务服务层
// -----------------------------------------------------------------------------
// 职责：
//   - getEffectiveReportPromptByUser(userId)  worker 用：用户级 > 全局 > 文件 fallback
//   - getEffectiveCoverTemplateByUser(userId) worker 用：用户级 > 全局 > 内置 fallback
//   - getSummaryByUser(userId)                admin 读：所有 type 当前摘要
//   - getDetailByUser(userId, type)           admin 读：当前 + 历史列表
//   - getVersionContentByUser(userId, type, versionId) admin 读：单版本完整
//   - saveVersionByUser(userId, type, input)  admin 写：保存新版本（含校验）
//   - rollbackByUser(userId, type, versionId) admin 写：回滚
//   - copyFromTemplate(userId, type)          admin 写：从全局当前版本复制为用户级 v1
//
// 设计要点（KISS + DRY）：
//   - 校验口径与全局一致：复用 prompt-config.service 的 validatePromptContent
//   - fallback 链清晰：用户级 > 全局 > 内置兜底
//   - copyFromTemplate 仅在用户级"无任何版本"时使用，避免覆盖已有用户配置
// =============================================================================

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PromptType, UserPromptType } from '../db/schema'
import { badRequest, notFound } from '../lib/errors'
import {
  userPromptSettingsRepository,
  type UserPromptSettingsRow,
  type UserPromptVersionSummary,
} from '../repositories/user-prompt-settings.repository'
import {
  getEffectiveCoverTemplate,
  getEffectiveReportPrompt,
  validatePromptContent,
} from './prompt-config.service'

// =============================================================================
// 文件 fallback 路径（与全局 service 同款）
// =============================================================================
const SYSTEM_PROMPT_PATH = resolve(process.cwd(), 'refer/system_prompt.md')

// =============================================================================
// worker 取效：用户级 > 全局 > 内置 fallback
// =============================================================================

// 报告 system prompt（worker 用）
// 优先级：用户级 DB > 全局 DB > refer/system_prompt.md
export async function getEffectiveReportPromptByUser(
  userId: string,
): Promise<{
	content: string
	source: 'user' | 'db' | 'file'
	version: number | null
}> {
  // 1. 优先取用户级当前版本
  const userCurrent =
		await userPromptSettingsRepository.getCurrentByUserAndType(
		  userId,
		  'report_system',
		)
  if (userCurrent) {
    return {
      content: userCurrent.content,
      source: 'user',
      version: userCurrent.version,
    }
  }

  // 2. fallback 到全局
  const global = await getEffectiveReportPrompt()
  return {
    content: global.content,
    // 全局 source 为 'db' 或 'file'，保持原值传递
    source: global.source,
    version: global.version,
  }
}

// 封面模板（worker 用）
// 优先级：用户级 DB > 全局 DB > 内置默认
export async function getEffectiveCoverTemplateByUser(
  userId: string,
): Promise<{
	content: string
	source: 'user' | 'db' | 'builtin'
	version: number | null
}> {
  const userCurrent =
		await userPromptSettingsRepository.getCurrentByUserAndType(
		  userId,
		  'cover_template',
		)
  if (userCurrent) {
    return {
      content: userCurrent.content,
      source: 'user',
      version: userCurrent.version,
    }
  }

  const global = await getEffectiveCoverTemplate()
  return {
    content: global.content,
    source: global.source,
    version: global.version,
  }
}

// =============================================================================
// admin 读（路由层用）
// =============================================================================

export interface UserPromptSummary {
	type: UserPromptType
	version: number
	note: string | null
	createdBy: string
	updatedAt: string
	contentPreview: string // 前 200 字
}

export interface UserPromptDetail {
	// current = null 表示该用户该 type 尚未配置，前端引导复制全局模板
	current: {
		id: number
		version: number
		content: string
		note: string | null
		createdBy: string
		createdAt: string
	} | null
	history: UserPromptVersionSummary[]
}

// GET /admin/users/:id/prompt-config - 所有 type 当前摘要
export async function getSummaryByUser(
  userId: string,
): Promise<UserPromptSummary[]> {
  const rows = await userPromptSettingsRepository.listCurrentByUser(userId)
  return rows.map((r) => toSummary(r))
}

// GET /admin/users/:id/prompt-config/:type - 当前完整 + 历史列表
// current = null 时不抛 404，由前端引导复制全局模板（POST copy-template）
export async function getDetailByUser(
  userId: string,
  type: UserPromptType,
): Promise<UserPromptDetail> {
  const current =
		await userPromptSettingsRepository.getCurrentByUserAndType(userId, type)
  const history =
		await userPromptSettingsRepository.listVersionsByUserAndType(userId, type)
  return {
    current: current
      ? {
        id: current.id,
        version: current.version,
        content: current.content,
        note: current.note,
        createdBy: current.createdBy,
        createdAt: current.createdAt.toISOString(),
      }
      : null,
    history,
  }
}

// GET /admin/users/:id/prompt-config/:type/versions/:versionId - 单版本完整 content
export async function getVersionContentByUser(
  userId: string,
  type: UserPromptType,
  versionId: number,
): Promise<{
	id: number
	version: number
	content: string
	note: string | null
	createdBy: string
	createdAt: string
} | null> {
  const row = await userPromptSettingsRepository.getVersionByIdForUser(
    versionId,
    userId,
    type,
  )
  if (!row) return null
  return {
    id: row.id,
    version: row.version,
    content: row.content,
    note: row.note,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  }
}

// =============================================================================
// admin 写（路由层用）
// =============================================================================

// PUT /admin/users/:id/prompt-config/:type - 保存新版本
// 校验口径与全局话术一致（DRY：复用 validatePromptContent）
export async function saveVersionByUser(input: {
	userId: string
	type: UserPromptType
	content: string
	note: string | null
	createdBy: string
}): Promise<UserPromptSettingsRow> {
  validatePromptContent(input.type, input.content)

  return userPromptSettingsRepository.saveVersionWithTx({
    userId: input.userId,
    type: input.type,
    content: input.content,
    note: input.note,
    createdBy: input.createdBy,
  })
}

// POST /admin/users/:id/prompt-config/:type/rollback/:versionId - 回滚
// 语义与全局一致：读旧版本 content 作为新版本插入（version 自增）
export async function rollbackByUser(input: {
	userId: string
	type: UserPromptType
	versionId: number
	createdBy: string
}): Promise<UserPromptSettingsRow> {
  const target = await userPromptSettingsRepository.getVersionByIdForUser(
    input.versionId,
    input.userId,
    input.type,
  )
  if (!target) {
    throw notFound('历史版本')
  }

  return userPromptSettingsRepository.saveVersionWithTx({
    userId: input.userId,
    type: input.type,
    content: target.content,
    note: `回滚到 v${target.version}`,
    createdBy: input.createdBy,
  })
}

// POST /admin/users/:id/prompt-config/copy-template - 从全局当前版本复制为用户级 v1
// 语义：
//   - 全局无当前版本时抛 PROMPT_TEMPLATE_EMPTY
//   - 用户级已存在配置时抛 USER_PROMPT_EXISTS（避免误覆盖；要重置请走 rollback 或先手动删除）
export async function copyFromTemplate(
  userId: string,
  type: UserPromptType,
  createdBy: string,
): Promise<UserPromptSettingsRow> {
  // 1. 校验用户级未配置
  const existing =
		await userPromptSettingsRepository.getCurrentByUserAndType(userId, type)
  if (existing) {
    throw badRequest(
      'USER_PROMPT_EXISTS',
      `该用户已配置 ${type} 话术（v${existing.version}），复制模板会覆盖。如需重置请使用「回滚」或先手动编辑`,
    )
  }

  // 2. 取全局当前版本（DB 优先，无则用文件 fallback / 内置 fallback）
  let templateContent: string
  if (type === 'report_system') {
    const global = await getEffectiveReportPrompt()
    templateContent = global.content
    // file fallback 时读 refer/system_prompt.md
    if (global.source === 'file') {
      templateContent = readFileSync(SYSTEM_PROMPT_PATH, 'utf-8')
    }
  } else {
    const global = await getEffectiveCoverTemplate()
    templateContent = global.content
  }

  // 3. 写入用户级 v1
  return userPromptSettingsRepository.saveVersionWithTx({
    userId,
    type,
    content: templateContent,
    note: '从全局模板复制',
    createdBy,
  })
}

// =============================================================================
// 内部工具
// =============================================================================

function toSummary(row: UserPromptSettingsRow): UserPromptSummary {
  return {
    type: row.type,
    version: row.version,
    note: row.note,
    createdBy: row.createdBy,
    updatedAt: row.createdAt.toISOString(),
    contentPreview: row.content.slice(0, 200),
  }
}

// 兼容类型导出：UserPromptType 与 PromptType 是同一个 union，这里 alias 方便路由层 import
export type { PromptType }
