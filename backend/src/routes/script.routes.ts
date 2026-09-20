// 剧本路由（p00 同款：直挂用户，无项目概念）
// -----------------------------------------------------------------------------
// 路由清单：
//   GET    /                              列出我的剧本
//   POST   /                              粘贴文本创建
//   POST   /upload                        上传文件创建（.txt/.md/.docx/.pdf）
//   GET    /:id                           剧本详情
//   DELETE /:id                           删除剧本
//   POST   /:id/analyze                   触发 8 节点分析（202 + taskId）
//   POST   /:id/cover/generate            触发封面异步生成（202 + taskId，一次出 3 张候选）
//   POST   /:id/cover/select              从候选中选定一张（写 script.coverUrl）
//   GET    /:id/status                    轮询任务状态 + events[] + overall
//   GET    /:id/report                    取报告 markdown
//   GET    /:id/report/pdf                下载 PDF（puppeteer 生成）
// =============================================================================

import { Hono } from 'hono'
import { zipSync } from 'fflate'
import { requireAuth } from '../middlewares/auth.middleware'
import { ok } from '../lib/response'
import { badRequest, type BusinessError } from '../lib/errors'
import { createScriptSchema, analyzeSchema, retryAnalyzeSchema } from '../schemas/script.schema'
import {
  listScripts,
  createScript,
  getScript,
  deleteScript,
  getReport,
} from '../services/script.service'
import { renderReportPdf } from '../services/pdf.service'
import {
	triggerAnalysis,
	getStatus,
	getActiveTaskByScriptId,
	retryAnalysis,
	stopAnalysis,
} from '../services/analyze.service'
import { triggerCoverGeneration, selectCover, stopCoverGeneration } from '../services/cover.service'
import { detectFileType, parseFileToText } from '../lib/file-parser'
import type { AppJwtPayload } from '../lib/jwt'

export const scriptRoutes = new Hono<{
  Variables: {
    user: AppJwtPayload
  }
}>()

// 所有路由都需要登录
scriptRoutes.use('*', requireAuth)

// GET / - 列出我的剧本
scriptRoutes.get('/', async (c) => {
  const payload = c.get('user')
  const list = await listScripts(payload.userId)
  return ok(c, { items: list })
})

// POST / - 粘贴文本创建剧本
scriptRoutes.post('/', async (c) => {
  const payload = c.get('user')
  const body = await c.req.json().catch(() => null)
  if (!body) {
    throw badRequest('INVALID_BODY', '请求体不是合法 JSON')
  }

  const parsed = createScriptSchema.safeParse(body)
  if (!parsed.success) {
    const err: BusinessError = {
      name: 'BusinessError',
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message ?? '参数错误',
      status: 400,
    }
    throw err
  }

  const script = await createScript(payload.userId, parsed.data)
  return ok(c, script, 201)
})

// POST /upload - 上传文件创建剧本
scriptRoutes.post('/upload', async (c) => {
  const payload = c.get('user')
  const formData = await c.req.formData()
  const file = formData.get('file')
  const title = formData.get('title')
  const genre = formData.get('genre')

  if (!(file instanceof File)) {
    throw badRequest('INVALID_FILE', '请上传文件')
  }
  if (typeof title !== 'string' || !title.trim()) {
    throw badRequest('VALIDATION_ERROR', '标题不能为空')
  }

  // 校验文件类型
  const fileType = detectFileType(file.name)
  if (!fileType) {
    throw badRequest('INVALID_FILE_TYPE', '仅支持 .txt / .md / .docx / .pdf 文件')
  }

  // 校验文件大小（≤ 10MB）
  if (file.size > 10 * 1024 * 1024) {
    throw badRequest('FILE_TOO_LARGE', '文件大小不能超过 10MB')
  }

  // 解析文件为文本
  const buffer = Buffer.from(await file.arrayBuffer())
  const sourceContent = await parseFileToText(buffer, fileType)

  if (sourceContent.length < 50) {
    throw badRequest('CONTENT_TOO_SHORT', '解析后内容至少 50 字')
  }
  if (sourceContent.length > 500000) {
    throw badRequest('CONTENT_TOO_LONG', '解析后内容不能超过 50 万字')
  }

  const script = await createScript(payload.userId, {
    title: title.trim(),
    genre: typeof genre === 'string' ? genre : null,
    sourceContent,
    fileName: file.name,
  })
  return ok(c, script, 201)
})

// GET /:id - 剧本详情
scriptRoutes.get('/:id', async (c) => {
  const payload = c.get('user')
  const script = await getScript(payload.userId, c.req.param('id')!)
  return ok(c, script)
})

// DELETE /:id - 删除剧本
scriptRoutes.delete('/:id', async (c) => {
  const payload = c.get('user')
  await deleteScript(payload.userId, c.req.param('id')!)
  return ok(c, { deleted: true })
})

// POST /:id/analyze - 触发 8 节点分析
// body 可选 { mode?: 'standard' | 'fast' | 'ultra' }；未传时 service 层取 llm_settings 默认
scriptRoutes.post('/:id/analyze', async (c) => {
  const payload = c.get('user')
  const parsed = analyzeSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '参数错误',
    )
  }
  const result = await triggerAnalysis(
    payload.userId,
    c.req.param('id')!,
    parsed.data.mode,
  )
  return ok(c, result, 202)
})

// POST /:id/analyze/retry - 用原 task 的 mode 重试（保留历史，新建 task）
// body { taskId: string }（原 task 必须是 error / done / canceled 状态）
scriptRoutes.post('/:id/analyze/retry', async (c) => {
  const payload = c.get('user')
  const parsed = retryAnalyzeSchema.safeParse(
    await c.req.json().catch(() => ({})),
  )
  if (!parsed.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      parsed.error.issues?.[0]?.message ?? '参数错误',
    )
  }
  const result = await retryAnalysis(
    payload.userId,
    c.req.param('id')!,
    parsed.data.taskId,
  )
  return ok(c, result, 202)
})

// POST /:id/analyze/stop - 停止 running 任务（用户主动取消）
// body { taskId: string }
scriptRoutes.post('/:id/analyze/stop', async (c) => {
  const payload = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const taskId = (body as { taskId?: string })?.taskId
  if (!taskId) {
    throw badRequest('VALIDATION_ERROR', '缺少 taskId')
  }
  const result = await stopAnalysis(payload.userId, c.req.param('id')!, taskId)
  return ok(c, result)
})

// POST /:id/cover/generate - 触发封面异步生成（202 + taskId）
// 内部串：generateImage(count=3) → 循环 uploadImageFromUrl → 写 script.coverUrlCandidates → 推 cover_done 事件
// 前端复用 GET /:id/status?taskId=xxx 轮询事件流
scriptRoutes.post('/:id/cover/generate', async (c) => {
  const payload = c.get('user')
  const result = await triggerCoverGeneration(payload.userId, c.req.param('id')!)
  return ok(c, result, 202)
})

// POST /:id/cover/select - 用户从候选中选定一张（写入 script.coverUrl，返回签名 URL）
// body { coverUrl: string }  // 实际为 OSS object key，须在 candidates 内
scriptRoutes.post('/:id/cover/select', async (c) => {
  const payload = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const coverUrl = (body as { coverUrl?: string })?.coverUrl
  if (!coverUrl) {
    throw badRequest('VALIDATION_ERROR', '缺少 coverUrl')
  }
  const result = await selectCover(payload.userId, c.req.param('id')!, coverUrl)
  return ok(c, result)
})

// POST /:id/cover/stop - 停止封面生成任务（用户主动取消，退款）
// body { taskId: string }
scriptRoutes.post('/:id/cover/stop', async (c) => {
  const payload = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const taskId = (body as { taskId?: string })?.taskId
  if (!taskId) {
    throw badRequest('VALIDATION_ERROR', '缺少 taskId')
  }
  const result = await stopCoverGeneration(payload.userId, c.req.param('id')!, taskId)
  return ok(c, result)
})

// GET /:id/active-task - 查剧本最近活跃任务（断点续传用）
// 返回 null 表示无活跃任务
scriptRoutes.get('/:id/active-task', async (c) => {
  const payload = c.get('user')
  const result = await getActiveTaskByScriptId(
    payload.userId,
    c.req.param('id')!,
  )
  return ok(c, result)
})

// GET /:id/status - 轮询任务状态（前端 1.8s 轮询用）
scriptRoutes.get('/:id/status', async (c) => {
  const payload = c.get('user')
  const taskId = c.req.query('taskId')
  if (!taskId) {
    throw badRequest('VALIDATION_ERROR', '缺少 taskId 查询参数')
  }
  const result = await getStatus(payload.userId, c.req.param('id')!, taskId)
  return ok(c, result)
})

// GET /:id/report - 取报告 markdown
scriptRoutes.get('/:id/report', async (c) => {
  const payload = c.get('user')
  const result = await getReport(payload.userId, c.req.param('id')!)
  return ok(c, result)
})

// GET /:id/report/pdf - 下载 PDF（puppeteer 生成）
// 返回 application/pdf，Content-Disposition 触发浏览器下载
scriptRoutes.get('/:id/report/pdf', async (c) => {
  const payload = c.get('user')
  const { script, version, report } = await getReport(payload.userId, c.req.param('id')!)

  const pdfBuffer = await renderReportPdf({
    title: script.title,
    genre: script.genre,
    coverUrl: script.coverUrl,
    score: version.scoreDetails?.score,
    grade: version.scoreDetails?.grade,
    durationMs: version.scoreDetails?.durationMs,
    fileName: script.fileName,
    wordCount: script.wordCount,
    versionId: version.id,
    reportMarkdown: report,
  })

  const score = version.scoreDetails?.score ?? 0
  // RFC 5987 编码：中文文件名用 filename*=UTF-8''<encoded>
  const filename = `${script.title}-${score}分.pdf`
  const encodedFilename = encodeURIComponent(filename)

  c.header('Content-Type', 'application/pdf')
  c.header('Content-Disposition', `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`)
  c.header('Content-Length', String(pdfBuffer.length))
  return c.body(pdfBuffer)
})

// POST /batch-export-pdf - 批量导出多个剧本 PDF（zip 打包）
// body { scriptIds: string[] }，最多 20 个；返回 application/zip
// 单个 PDF 失败不影响其他（在 zip 内放 .error.txt 说明）
scriptRoutes.post('/batch-export-pdf', async (c) => {
  const payload = c.get('user')
  const body = await c.req.json().catch(() => null)
  const ids = (body as { scriptIds?: unknown })?.scriptIds
  if (!Array.isArray(ids) || ids.length === 0) {
    throw badRequest('VALIDATION_ERROR', 'scriptIds 必须为非空数组')
  }
  if (ids.length > 20) {
    throw badRequest('VALIDATION_ERROR', '一次最多导出 20 份报告')
  }

  const usedNames = new Set<string>()
  const files: Record<string, Uint8Array> = {}

  for (const id of ids) {
    if (typeof id !== 'string') continue
    try {
      const { script, version, report } = await getReport(payload.userId, id)
      const pdfBuffer = await renderReportPdf({
        title: script.title,
        genre: script.genre,
        coverUrl: script.coverUrl,
        score: version.scoreDetails?.score,
        grade: version.scoreDetails?.grade,
        durationMs: version.scoreDetails?.durationMs,
        fileName: script.fileName,
        wordCount: script.wordCount,
        versionId: version.id,
        reportMarkdown: report,
      })
      const score = version.scoreDetails?.score ?? 0
      const base = `${script.title}-${score}分`.replace(/[\\/:*?"<>|]/g, '_')
      const name = dedupeName(`${base}.pdf`, usedNames)
      files[name] = new Uint8Array(pdfBuffer)
    } catch (e) {
      const errName = dedupeName(`${id.slice(0, 8)}-error.txt`, usedNames)
      const msg = e instanceof Error ? e.message : String(e)
      files[errName] = new TextEncoder().encode(`导出失败：${msg}\nscriptId=${id}`)
    }
  }

  const zipBuffer = zipSync(files, { level: 6 })
  const filename = `剧本报告打包-${ids.length}份-${Date.now()}.zip`
  const encodedFilename = encodeURIComponent(filename)

  c.header('Content-Type', 'application/zip')
  c.header('Content-Disposition', `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`)
  c.header('Content-Length', String(zipBuffer.length))
  return c.body(zipBuffer)
})

// 文件名去重：遇到同名自动追加 -2 / -3
function dedupeName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name)
    return name
  }
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let i = 2
  while (used.has(`${stem}-${i}${ext}`)) i++
  const next = `${stem}-${i}${ext}`
  used.add(next)
  return next
}
