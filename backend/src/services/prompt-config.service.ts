// =============================================================================
// Prompt 配置业务服务层
// -----------------------------------------------------------------------------
// 职责：
//   - getEffectiveReportPrompt    worker 用：DB 当前 > refer/system_prompt.md fallback
//   - getEffectiveCoverTemplate   worker 用：DB 当前 > 内置默认模板 fallback
//   - getSummary                  GET /prompt-config：所有 type 当前配置摘要
//   - getDetail                   GET /prompt-config/:type：当前 + 历史列表
//   - getVersionContent           GET /prompt-config/:type/versions/:id：单版本完整
//   - saveVersion                 PUT /prompt-config/:type：保存新版本（含校验）
//   - rollbackTo                  POST /prompt-config/:type/rollback/:id：回滚
//
// 设计要点（KISS）：
//   - 无脱敏：prompt 无敏感字段
//   - 缓存失效走 60s TTL（在 worker 侧实现），service 不感知缓存层
//   - cover_template 保存时校验必须包含 {{title}}，否则 400
//   - rollback = 读旧版 content 作为新版本插入（version 自增，note 自动）
// =============================================================================

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PromptType } from '../db/schema'
import { badRequest, notFound } from '../lib/errors'
import {
  promptSettingsRepository,
  type PromptSettingsRow,
  type PromptVersionSummary
} from '../repositories/prompt-settings.repository'

// =============================================================================
// 文件 fallback 路径 + 默认值
// =============================================================================
const SYSTEM_PROMPT_PATH = resolve(process.cwd(), 'refer/system_prompt.md')

// cover_template fallback：与 seed-prompts.ts 内置默认保持一致
const FALLBACK_COVER_TEMPLATE =
	'短剧海报封面，标题《{{title}}》，题材：{{genre}}。{{excerpt_block}}竖版电影海报构图，高对比度，电影质感，人物剪影 + 标题文字留白，氛围感强，色彩饱和。'

// =============================================================================
// worker 取效（DB > fallback）
// =============================================================================

// 报告 system prompt（worker 用）
// 返回 null 时调用方应 fallback 到 refer/system_prompt.md
export async function getEffectiveReportPrompt(): Promise<{
	content: string
	source: 'db' | 'file'
	version: number | null
}> {
  const current = await promptSettingsRepository.getCurrentByType(
    'report_system'
  )
  if (current) {
    return {
      content: current.content,
      source: 'db',
      version: current.version
    }
  }
  // fallback：读文件（保证全新部署可用）
  const fileContent = readFileSync(SYSTEM_PROMPT_PATH, 'utf-8')
  return { content: fileContent, source: 'file', version: null }
}

// 封面模板（worker 用）
// 返回 null 时调用方应使用内置默认模板
export async function getEffectiveCoverTemplate(): Promise<{
	content: string
	source: 'db' | 'builtin'
	version: number | null
}> {
  const current = await promptSettingsRepository.getCurrentByType(
    'cover_template'
  )
  if (current) {
    return {
      content: current.content,
      source: 'db',
      version: current.version
    }
  }
  return {
    content: FALLBACK_COVER_TEMPLATE,
    source: 'builtin',
    version: null
  }
}

// =============================================================================
// admin 读（路由层用）
// =============================================================================

export interface PromptSummary {
	type: PromptType
	version: number
	note: string | null
	createdBy: string
	updatedAt: string
	contentPreview: string // 前 200 字
}

export interface PromptDetail {
	// current = null 表示该 type 尚未初始化（DB 无记录），前端引导创建第一版
	current: {
		id: number
		version: number
		content: string
		note: string | null
		createdBy: string
		createdAt: string
	} | null
	history: PromptVersionSummary[]
}

// GET /prompt-config — 所有 type 当前摘要
export async function getSummary(): Promise<PromptSummary[]> {
  const rows = await promptSettingsRepository.listCurrent()
  return rows.map((r) => toSummary(r))
}

// GET /prompt-config/:type — 当前完整 + 历史列表
// current = null 时不抛 404，由前端引导创建第一版（PUT 自动 v1）
export async function getDetail(type: PromptType): Promise<PromptDetail> {
  const current = await promptSettingsRepository.getCurrentByType(type)
  const history = await promptSettingsRepository.listVersionsByType(type)
  return {
    current: current
      ? {
        id: current.id,
        version: current.version,
        content: current.content,
        note: current.note,
        createdBy: current.createdBy,
        createdAt: current.createdAt.toISOString()
			  }
      : null,
    history
  }
}

// GET /prompt-config/:type/versions/:versionId — 单版本完整 content
export async function getVersionContent(
  type: PromptType,
  versionId: number
): Promise<{
	id: number
	version: number
	content: string
	note: string | null
	createdBy: string
	createdAt: string
} | null> {
  const row = await promptSettingsRepository.getVersionById(versionId)
  if (!row || row.type !== type) return null
  return {
    id: row.id,
    version: row.version,
    content: row.content,
    note: row.note,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString()
  }
}

// =============================================================================
// admin 写（路由层用）
// =============================================================================

// 共享内容校验：cover_template 必含 {{title}}
// report_system 不做结构限制——报告章节结构由 analyzer 的 NODE_SKELETON 骨架
// 在拼接时强制重建（normalizeNodeOutput 对 h1-h3 替换/降级），任意话术均不破坏结构，
// 元数据抽取由 report-extract.ts 多策略容错兜底
// 全局 service 与 user-level service 调用同一函数，避免校验口径漂移
export function validatePromptContent(
  type: PromptType,
  content: string
): void {
  if (type === 'cover_template' && !content.includes('{{title}}')) {
    throw badRequest(
      'COVER_TEMPLATE_INVALID',
      '封面模板必须包含 {{title}} 占位符'
    )
  }
}

// PUT /prompt-config/:type — 保存新版本
export async function saveVersion(input: {
	type: PromptType
	content: string
	note: string | null
	createdBy: string
}): Promise<PromptSettingsRow> {
  validatePromptContent(input.type, input.content)

  return promptSettingsRepository.saveVersionWithTx({
    type: input.type,
    content: input.content,
    note: input.note,
    createdBy: input.createdBy
  })
}

// POST /prompt-config/:type/rollback/:versionId — 回滚到指定版本
// 语义：读旧版本 content 作为新版本插入（version 自增）
// 不直接切 is_current 指向旧行，保留"历史线性"语义，便于追溯
export async function rollbackTo(input: {
	type: PromptType
	versionId: number
	createdBy: string
}): Promise<PromptSettingsRow> {
  const target = await promptSettingsRepository.getVersionById(
    input.versionId
  )
  if (!target || target.type !== input.type) {
    throw notFound('历史版本')
  }

  return promptSettingsRepository.saveVersionWithTx({
    type: input.type,
    content: target.content,
    note: `回滚到 v${target.version}`,
    createdBy: input.createdBy
  })
}

// =============================================================================
// 内部工具
// =============================================================================

function toSummary(row: PromptSettingsRow): PromptSummary {
  return {
    type: row.type,
    version: row.version,
    note: row.note,
    createdBy: row.createdBy,
    updatedAt: row.createdAt.toISOString(),
    contentPreview: row.content.slice(0, 200)
  }
}
