// Prompt 话术配置类型（与后端 routes/prompt-config.routes.ts 对齐）
// -----------------------------------------------------------------------------
// 两类 prompt：
//   - report_system   报告 system prompt（纯 markdown）
//   - cover_template  封面模板（含 {{title}}/{{genre}}/{{excerpt_block}} 占位符）

export type PromptType = 'report_system' | 'cover_template'

// 历史版本摘要（列表用，不含 content）
export interface PromptVersionSummary {
	id: number
	version: number
	note: string | null
	createdBy: string
	createdAt: string
	isCurrent: boolean
}

// GET /prompt-config 返回的所有 type 摘要项
export interface PromptSummary {
	type: PromptType
	version: number
	note: string | null
	createdBy: string
	updatedAt: string
	contentPreview: string // 前 200 字
}

// GET /prompt-config 响应
export interface PromptSummaryResponse {
	items: PromptSummary[]
}

// GET /prompt-config/:type 响应
// current = null 表示该 type 尚未初始化（DB 无记录），前端引导创建第一版
export interface PromptDetailResponse {
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

// GET /prompt-config/:type/versions/:versionId 响应
export interface PromptVersionDetail {
	id: number
	version: number
	content: string
	note: string | null
	createdBy: string
	createdAt: string
}

// PUT /prompt-config/:type 请求体
export interface SavePromptInput {
	content: string
	note?: string | undefined
}

// PUT / POST rollback 成功响应（保存后的版本摘要）
export interface SavedPromptResponse {
	id: number
	version: number
	note: string | null
	isCurrent: boolean
	createdBy: string
	createdAt: string
}
