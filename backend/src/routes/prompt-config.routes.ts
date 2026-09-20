// =============================================================================
// Prompt 配置路由（admin only）
// -----------------------------------------------------------------------------
// 5 个接口：
//   GET   /prompt-config                                admin   所有 type 当前摘要
//   GET   /prompt-config/:type                          admin   当前完整 + 历史列表
//   GET   /prompt-config/:type/versions/:versionId      admin   单版本完整 content
//   PUT   /prompt-config/:type                          admin   保存新版本
//   POST  /prompt-config/:type/rollback/:versionId      admin   回滚到指定版本
//
// 鉴权：所有接口 requireAuth + requireRole('admin')
// =============================================================================

import { Hono } from 'hono'
import type { PromptType } from '../db/schema'
import { badRequest, notFound } from '../lib/errors'
import type { AppJwtPayload } from '../lib/jwt'
import { ok } from '../lib/response'
import { requireAuth, requireRole } from '../middlewares/auth.middleware'
import {
	isValidPromptType,
	savePromptSchema
} from '../schemas/prompt-config.schema'
import {
	getDetail,
	getSummary,
	getVersionContent,
	rollbackTo,
	saveVersion
} from '../services/prompt-config.service'

export const promptConfigRoutes = new Hono<{
	Variables: {
		user: AppJwtPayload
	}
}>()

// GET /prompt-config — 所有 type 当前摘要
promptConfigRoutes.get('/', requireAuth, requireRole('admin'), async (c) => {
	const summary = await getSummary()
	return ok(c, { items: summary })
})

// GET /prompt-config/:type — 当前完整 + 历史列表
// 注：该 type 尚未初始化时返回 200 + { current: null, history: [] }，由前端引导创建第一版
promptConfigRoutes.get(
	'/:type',
	requireAuth,
	requireRole('admin'),
	async (c) => {
		const type = c.req.param('type')!
		if (!isValidPromptType(type)) {
			throw badRequest(
				'INVALID_TYPE',
				'type 必须是 report_system / cover_template'
			)
		}
		const detail = await getDetail(type as PromptType)
		return ok(c, detail)
	}
)

// GET /prompt-config/:type/versions/:versionId — 单版本完整 content
promptConfigRoutes.get(
	'/:type/versions/:versionId',
	requireAuth,
	requireRole('admin'),
	async (c) => {
		const type = c.req.param('type')!
		if (!isValidPromptType(type)) {
			throw badRequest(
				'INVALID_TYPE',
				'type 必须是 report_system / cover_template'
			)
		}
		const versionId = Number(c.req.param('versionId')!)
		if (!Number.isInteger(versionId) || versionId <= 0) {
			throw badRequest('INVALID_VERSION_ID', 'versionId 必须是正整数')
		}
		const version = await getVersionContent(type as PromptType, versionId)
		if (!version) {
			throw notFound('历史版本')
		}
		return ok(c, version)
	}
)

// PUT /prompt-config/:type — 保存新版本
promptConfigRoutes.put(
	'/:type',
	requireAuth,
	requireRole('admin'),
	async (c) => {
		const type = c.req.param('type')!
		if (!isValidPromptType(type)) {
			throw badRequest(
				'INVALID_TYPE',
				'type 必须是 report_system / cover_template'
			)
		}

		const body = await c.req.json().catch(() => null)
		if (!body) {
			throw badRequest('INVALID_BODY', '请求体不是合法 JSON')
		}

		const parsed = savePromptSchema.safeParse(body)
		if (!parsed.success) {
			throw badRequest(
				'VALIDATION_ERROR',
				parsed.error.issues?.[0]?.message ?? '参数错误'
			)
		}

		const user = c.get('user')
		const saved = await saveVersion({
			type: type as PromptType,
			content: parsed.data.content,
			note: parsed.data.note,
			createdBy: user.username
		})
		return ok(c, toSavedResponse(saved))
	}
)

// POST /prompt-config/:type/rollback/:versionId — 回滚
promptConfigRoutes.post(
	'/:type/rollback/:versionId',
	requireAuth,
	requireRole('admin'),
	async (c) => {
		const type = c.req.param('type')!
		if (!isValidPromptType(type)) {
			throw badRequest(
				'INVALID_TYPE',
				'type 必须是 report_system / cover_template'
			)
		}
		const versionId = Number(c.req.param('versionId')!)
		if (!Number.isInteger(versionId) || versionId <= 0) {
			throw badRequest('INVALID_VERSION_ID', 'versionId 必须是正整数')
		}

		const user = c.get('user')
		const rolled = await rollbackTo({
			type: type as PromptType,
			versionId,
			createdBy: user.username
		})
		return ok(c, toSavedResponse(rolled))
	}
)

// 行 → 响应体（不暴露内部 type 字段重复，前端通过 URL 知道 type）
function toSavedResponse(row: {
	id: number
	version: number
	note: string | null
	isCurrent: boolean
	createdBy: string
	createdAt: Date
}) {
	return {
		id: row.id,
		version: row.version,
		note: row.note,
		isCurrent: row.isCurrent,
		createdBy: row.createdBy,
		createdAt: row.createdAt.toISOString()
	}
}
