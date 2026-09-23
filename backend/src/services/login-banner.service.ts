// =============================================================================
// 登录页轮播图业务服务层
// -----------------------------------------------------------------------------
// 职责：
//   - listActiveForPublic   登录页公开查询（脱敏 OSS key，仅返回前端需要的字段）
//   - listAllForAdmin       后台查询（含完整字段）
//   - uploadBanner          multipart 上传核心：校验 MIME → 上传 OSS → 写 DB
//   - updateBanner          更新标题 / 排序 / 启用
//   - deleteBanner          删除记录 + 同步清理 OSS 对象
//
// 设计要点：
//   - 复用 oss-config.service 的 uploadImageFromBuffer（不重复造 OSS 上传逻辑）
//   - 删除时同步删 OSS：避免 OSS 残留无引用对象（成本与整洁性）
//     如果 OSS 删除失败，仅记录日志，不阻塞 DB 删除（DB 是真相源）
// =============================================================================

import {
  loginBannerRepository,
  type UpdateBannerInput,
} from '../repositories/login-banner.repository'
import { uploadImageFromBuffer } from './oss-config.service'
import { signObjectUrl } from '../lib/oss-signer'
import { logger } from '../logger/index'
import { BusinessError, notFound } from '../lib/errors'
import { allowedBannerMimeSchema } from '../schemas/login-banner.schema'
import type { LoginBanner } from '../db/schema'

// 上传文件大小上限（5MB，登录页图片通常不需要更高分辨率）
const MAX_BANNER_SIZE = 5 * 1024 * 1024

// 公开接口返回的字段（不含 ossKey / uploadedBy 等内部字段）
export interface PublicBanner {
  id: string
  title: string | null
  imageUrl: string
}

// Admin 接口返回的字段（完整）
export interface AdminBanner {
  id: string
  title: string | null
  imageUrl: string
  ossKey: string
  sortOrder: number
  isActive: boolean
  uploadedBy: string
  createdAt: string
  updatedAt: string
}

// multipart 解析后的文件结构（Hono 返回 File 类型，Node 环境下字段对应）
interface UploadFile {
  buffer: Buffer
  contentType: string
  filename: string
}

// 私有 bucket 直链会 403；这里以 ossKey 为真相源走签名（与 cover_url 模式一致）
// imageUrl 字段保留完整 URL 仅供后台调试参考，前端实际加载用 signObjectUrl(ossKey) 的结果
async function toPublic(b: LoginBanner): Promise<PublicBanner> {
  const signedUrl = await signObjectUrl(b.ossKey)
  return { id: b.id, title: b.title, imageUrl: signedUrl ?? b.imageUrl }
}

async function toAdmin(b: LoginBanner): Promise<AdminBanner> {
  const signedUrl = await signObjectUrl(b.ossKey)
  return {
    id: b.id,
    title: b.title,
    imageUrl: signedUrl ?? b.imageUrl,
    ossKey: b.ossKey,
    sortOrder: b.sortOrder,
    isActive: b.isActive,
    uploadedBy: b.uploadedBy,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  }
}

class LoginBannerService {
  async listActiveForPublic(): Promise<PublicBanner[]> {
    const rows = await loginBannerRepository.listActive()
    return Promise.all(rows.map(toPublic))
  }

  async listAllForAdmin(): Promise<AdminBanner[]> {
    const rows = await loginBannerRepository.listAll()
    return Promise.all(rows.map(toAdmin))
  }

  // multipart 上传：校验 → 转 OSS → 写 DB
  async uploadBanner(file: UploadFile, uploader: string): Promise<AdminBanner> {
    // 1. 校验 MIME
    const mimeCheck = allowedBannerMimeSchema.safeParse(file.contentType)
    if (!mimeCheck.success) {
      throw new BusinessError(
        'BANNER_INVALID_MIME',
        `不支持的图片格式：${file.contentType}（仅允许 image/jpeg / png / webp）`,
        400,
      )
    }

    // 2. 校验大小
    if (file.buffer.length > MAX_BANNER_SIZE) {
      throw new BusinessError(
        'BANNER_FILE_TOO_LARGE',
        `图片超过 5MB 上限（当前 ${file.buffer.length} 字节）`,
        413,
      )
    }

    // 3. 上传到 OSS（复用现有能力，未配置 OSS 时会抛 OSS_NOT_CONFIGURED）
    const ossResult = await uploadImageFromBuffer({
      buffer: file.buffer,
      contentType: file.contentType,
      filename: file.filename,
    })

    // 4. 写入 DB
    const created = await loginBannerRepository.create({
      title: null,
      imageUrl: ossResult.url,
      ossKey: ossResult.key,
      sortOrder: 0,
      isActive: true,
      uploadedBy: uploader,
    })

    return toAdmin(created)
  }

  async updateBanner(id: string, patch: UpdateBannerInput): Promise<AdminBanner> {
    const updated = await loginBannerRepository.update(id, patch)
    if (!updated) {
      throw notFound('轮播图')
    }
    return await toAdmin(updated)
  }

  // 删除：先查记录 → 删 DB → 删 OSS（OSS 失败仅记录日志）
  async deleteBanner(id: string): Promise<void> {
    const row = await loginBannerRepository.deleteReturnRow(id)
    if (!row) {
      throw notFound('轮播图')
    }

    // 尝试清理 OSS 对象
    // 复用 createOssClient：仅在 OSS 已配置时尝试，未配置则跳过
    try {
      const { getEffectiveOssConfig } = await import('./oss-config.service')
      const { createOssAdapter } = await import('../lib/oss-client')
      const effective = await getEffectiveOssConfig()
      if (!effective.accessKeyId || !effective.accessKeySecret) {
        // OSS 未配置（图片可能是直接写库的旧数据），跳过 OSS 删除
        return
      }
      const adapter = createOssAdapter({
        provider: effective.provider,
        accessKeyId: effective.accessKeyId,
        accessKeySecret: effective.accessKeySecret,
        region: effective.region,
        bucket: effective.bucket,
        endpoint: effective.endpoint,
        timeout: effective.timeoutMs,
      })
      await adapter.remove(row.ossKey)
    } catch (e) {
      // OSS 删除失败不阻塞业务（DB 已删，最多 OSS 残留一个对象）
      logger.warn(
        { err: (e as Error).message, ossKey: row.ossKey },
        '登录轮播图 OSS 对象删除失败（已忽略，DB 已删）',
      )
    }
  }
}

export const loginBannerService = new LoginBannerService()
