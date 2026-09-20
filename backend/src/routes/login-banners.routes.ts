// =============================================================================
// 登录页轮播图路由
// -----------------------------------------------------------------------------
// 5 个接口：
//   GET    /login-banners         公开     登录页拉启用列表（无需鉴权）
//   GET    /login-banners/admin   admin    后台拉全部列表（含禁用项）
//   POST   /login-banners         admin    multipart 上传图片到 OSS + 写库
//   PATCH  /login-banners/:id     admin    更新标题 / 排序 / 启用
//   DELETE /login-banners/:id     admin    删除（同步删 OSS）
//
// 鉴权设计：
//   - 公开 GET 路由放在最前面、不带 requireAuth
//   - admin 路由统一 requireAuth + requireRole('admin')
//
// multipart 解析：Hono 内置 c.req.parseBody() 返回 File 对象
//   （Node @hono/node-server 下 File 是 Blob 子类，可 .arrayBuffer() 取字节）
// =============================================================================

import { Hono } from 'hono'
import { requireAuth, requireRole } from '../middlewares/auth.middleware'
import { ok, noContent } from '../lib/response'
import { badRequest, notFound } from '../lib/errors'
import { updateBannerSchema } from '../schemas/login-banner.schema'
import {
  loginBannerService,
  type AdminBanner,
} from '../services/login-banner.service'
import type { AppJwtPayload } from '../lib/jwt'

export const loginBannerRoutes = new Hono<{
  Variables: {
    user: AppJwtPayload
  }
}>()

// -----------------------------------------------------------------------------
// 公开接口（无需鉴权）— 必须放在所有 admin 路由之前
// -----------------------------------------------------------------------------

// GET /login-banners — 登录页拉启用列表
loginBannerRoutes.get('/', async (c) => {
  const banners = await loginBannerService.listActiveForPublic()
  return ok(c, { items: banners })
})

// -----------------------------------------------------------------------------
// Admin 接口（需登录 + admin 角色）
// -----------------------------------------------------------------------------

// GET /login-banners/admin — 后台拉全部列表
loginBannerRoutes.get(
  '/admin',
  requireAuth,
  requireRole('admin'),
  async (c) => {
    const banners = await loginBannerService.listAllForAdmin()
    return ok(c, { items: banners })
  },
)

// POST /login-banners — multipart 上传
// 表单字段：file（图片，必填）、title（标题，可选）
loginBannerRoutes.post(
  '/',
  requireAuth,
  requireRole('admin'),
  async (c) => {
    const form = await c.req.parseBody()
    const file = form.file

    // parseBody 对单文件返回 File，多文件返回 File[]；这里只接单文件
    if (!file || Array.isArray(file) || !(file instanceof File)) {
      throw badRequest('BANNER_FILE_REQUIRED', '请上传图片文件（字段名 file）')
    }

    if (file.size === 0) {
      throw badRequest('BANNER_FILE_EMPTY', '上传的文件为空')
    }

    const user = c.get('user')
    const username = user.username ?? 'admin'

    const buffer = Buffer.from(await file.arrayBuffer())
    const created: AdminBanner = await loginBannerService.uploadBanner(
      {
        buffer,
        contentType: file.type || 'application/octet-stream',
        filename: file.name,
      },
      username,
    )

    return ok(c, created, 201)
  },
)

// PATCH /login-banners/:id — 更新标题 / 排序 / 启用
loginBannerRoutes.patch(
  '/:id',
  requireAuth,
  requireRole('admin'),
  async (c) => {
    const id = c.req.param('id')!
    const body = await c.req.json().catch(() => null)
    if (!body) {
      throw badRequest('INVALID_BODY', '请求体不是合法 JSON')
    }

    const parsed = updateBannerSchema.safeParse(body)
    if (!parsed.success) {
      throw badRequest(
        'VALIDATION_ERROR',
        parsed.error.issues?.[0]?.message ?? '参数错误',
      )
    }

    // 三个字段都未传时直接报错（避免无意义更新）
    if (
      parsed.data.title === undefined &&
      parsed.data.sortOrder === undefined &&
      parsed.data.isActive === undefined
    ) {
      throw badRequest('VALIDATION_ERROR', '请至少传入一个待更新字段')
    }

    const updated = await loginBannerService.updateBanner(id, parsed.data)
    return ok(c, updated)
  },
)

// DELETE /login-banners/:id — 删除（同步删 OSS）
loginBannerRoutes.delete(
  '/:id',
  requireAuth,
  requireRole('admin'),
  async (c) => {
    const id = c.req.param('id')!
    await loginBannerService.deleteBanner(id)
    return noContent(c)
  },
)

// 兜底：未匹配的 admin 路径返回 404（避免被前面的 GET / 捕获）
loginBannerRoutes.all('/*', (c) => {
  throw notFound(`路径不存在：${c.req.method} ${c.req.path}`)
})
