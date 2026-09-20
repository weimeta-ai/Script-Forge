// =============================================================================
// 登录页轮播图 Repository
// -----------------------------------------------------------------------------
// 设计要点：
//   - listActive：登录页公开查询（仅启用，按 sortOrder 升序）
//   - listAll：admin 后台查询（含禁用项）
//   - create / update / delete / findById：标准 CRUD
//   - deleteReturnKey：删除时返回 ossKey 供 service 同步清理 OSS
// =============================================================================

import { and, asc, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { loginBanners, type LoginBanner } from '../db/schema'

// 创建入参
export interface CreateBannerInput {
  title: string | null
  imageUrl: string
  ossKey: string
  sortOrder: number
  isActive: boolean
  uploadedBy: string
}

// 更新入参（部分字段）
export interface UpdateBannerInput {
  title?: string | null
  sortOrder?: number
  isActive?: boolean
}

class LoginBannerRepository {
  // 登录页公开查询：仅启用，按 sortOrder 升序，相同 sortOrder 按 createdAt 升序
  async listActive(): Promise<LoginBanner[]> {
    return db
      .select()
      .from(loginBanners)
      .where(eq(loginBanners.isActive, true))
      .orderBy(asc(loginBanners.sortOrder), asc(loginBanners.createdAt))
  }

  // 后台查询：全部（含禁用）
  async listAll(): Promise<LoginBanner[]> {
    return db
      .select()
      .from(loginBanners)
      .orderBy(asc(loginBanners.sortOrder), asc(loginBanners.createdAt))
  }

  async findById(id: string): Promise<LoginBanner | null> {
    const rows = await db
      .select()
      .from(loginBanners)
      .where(eq(loginBanners.id, id))
      .limit(1)
    return rows[0] ?? null
  }

  async create(input: CreateBannerInput): Promise<LoginBanner> {
    const [row] = await db
      .insert(loginBanners)
      .values({
        title: input.title,
        imageUrl: input.imageUrl,
        ossKey: input.ossKey,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
        uploadedBy: input.uploadedBy,
      })
      .returning()
    return row
  }

  async update(id: string, patch: UpdateBannerInput): Promise<LoginBanner | null> {
    const setClause: Record<string, unknown> = { updatedAt: new Date() }
    if (patch.title !== undefined) setClause.title = patch.title
    if (patch.sortOrder !== undefined) setClause.sortOrder = patch.sortOrder
    if (patch.isActive !== undefined) setClause.isActive = patch.isActive

    const rows = await db
      .update(loginBanners)
      .set(setClause)
      .where(eq(loginBanners.id, id))
      .returning()
    return rows[0] ?? null
  }

  // 删除并返回被删记录（含 ossKey 供 service 同步删 OSS）
  async deleteReturnRow(id: string): Promise<LoginBanner | null> {
    const rows = await db
      .delete(loginBanners)
      .where(and(eq(loginBanners.id, id)))
      .returning()
    return rows[0] ?? null
  }
}

export const loginBannerRepository = new LoginBannerRepository()
