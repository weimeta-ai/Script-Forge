// =============================================================================
// OSS 对象存储适配层（核心抽象，双模式：阿里云 / MinIO S3 兼容）
// -----------------------------------------------------------------------------
// 设计要点：
//   - 适配器模式：上层（service / signer）只依赖 OssAdapter 接口，
//     新增服务商（如腾讯 COS）只需新增一个 Adapter 类，调用方零改动
//   - aliyun 模式：ali-oss SDK（OSS 专有签名 HMAC-SHA1，bucket 直链）
//   - minio 模式：minio SDK（S3 SigV4 协议，兼容 MinIO / AWS S3，预签名 URL）
//   - 纯工具，不耦合 DB（service 层负责拿配置，本文件只接收 plain 配置）
//   - 上传对象 key 规则：{pathPrefix}/{yy}/{mm}/{dd}/{uuid}.{ext}（按日期分桶）
// =============================================================================

import OSS from 'ali-oss'
import { Client as MinioClient } from 'minio'
import { v4 as uuidv4 } from 'uuid'
import { BusinessError } from './errors'

// 存储模式
export type OssProvider = 'aliyun' | 'minio'

// 适配器配置（plain，不脱敏）
export interface OssAdapterConfig {
  provider: OssProvider
  accessKeyId: string
  accessKeySecret: string
  region: string
  bucket: string
  endpoint?: string | null
  customDomain?: string | null
  timeout?: number
}

// 统一适配器接口（上层唯一依赖面）
export interface OssAdapter {
  readonly provider: OssProvider
  readonly bucket: string
  readonly region: string
  readonly customDomain: string | null
  // 连通性测试：失败时抛 BusinessError（错误码 OSS_*）
  test(): Promise<void>
  // 上传 Buffer，返回 etag
  put(key: string, buffer: Buffer, contentType: string): Promise<{ etag: string }>
  // 删除对象（业务数据清理场景）
  remove(key: string): Promise<void>
  // 生成带签名的临时访问 URL（私有 bucket 场景）
  signUrl(key: string, expiresSec: number): Promise<string>
  // 对象的持久访问 URL（公开读 / customDomain 场景）
  objectUrl(key: string): string
}

// 单文件大小上限（10MB，对应 OSS_FILE_TOO_LARGE）
const MAX_FILE_SIZE = 10 * 1024 * 1024

// =============================================================================
// 适配器工厂（唯一入口）
// =============================================================================
export function createOssAdapter(cfg: OssAdapterConfig): OssAdapter {
  if (!cfg.accessKeyId || !cfg.accessKeySecret) {
    throw new BusinessError(
      'OSS_NOT_CONFIGURED',
      'OSS 未配置 AccessKey，请先在管理后台保存凭据',
      400,
    )
  }
  if (!cfg.region || !cfg.bucket) {
    throw new BusinessError(
      'OSS_NOT_CONFIGURED',
      'OSS 未配置 region 或 bucket',
      400,
    )
  }
  return cfg.provider === 'minio' ? new MinioAdapter(cfg) : new AliyunAdapter(cfg)
}

// =============================================================================
// 阿里云 OSS 适配器（ali-oss SDK，HMAC-SHA1 专有签名）
// =============================================================================
class AliyunAdapter implements OssAdapter {
  readonly provider = 'aliyun' as const
  readonly bucket: string
  readonly region: string
  readonly customDomain: string | null
  private client: OSS

  constructor(cfg: OssAdapterConfig) {
    this.bucket = cfg.bucket
    this.region = cfg.region
    this.customDomain = cfg.customDomain ?? null
    // endpoint 可选：未传时 ali-oss 根据 region 自动推导
    const options: OSS.Options = {
      accessKeyId: cfg.accessKeyId,
      accessKeySecret: cfg.accessKeySecret,
      region: cfg.region,
      bucket: cfg.bucket,
      secure: true, // 强制 HTTPS
      timeout: cfg.timeout ?? 60000,
    }
    if (cfg.endpoint) {
      options.endpoint = cfg.endpoint
    }
    this.client = new OSS(options)
  }

  // 测试连接：列 1 个对象验证凭据 + bucket 访问权
  // bucketExists 在公开 bucket / 跨账号时可能行为不一，list 更可靠
  async test(): Promise<void> {
    try {
      await this.client.list({ 'max-keys': 1 }, {})
    } catch (e) {
      throw normalizeOssError(e)
    }
  }

  async put(key: string, buffer: Buffer, contentType: string): Promise<{ etag: string }> {
    try {
      const result = await this.client.put(key, buffer, {
        mime: contentType,
        headers: { 'Content-Type': contentType },
      })
      return { etag: (result as { etag?: string }).etag ?? '' }
    } catch (e) {
      throw normalizeOssError(e)
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.client.delete(key)
    } catch (e) {
      throw normalizeOssError(e)
    }
  }

  // signatureUrl 是同步函数（内部 HMAC-SHA1），包一层统一 async 接口
  async signUrl(key: string, expiresSec: number): Promise<string> {
    try {
      return this.client.signatureUrl(key, { expires: expiresSec })
    } catch (e) {
      throw normalizeOssError(e)
    }
  }

  objectUrl(key: string): string {
    if (this.customDomain) {
      return `${this.customDomain.replace(/\/+$/, '')}/${key}`
    }
    return `https://${this.bucket}.${this.region}.aliyuncs.com/${key}`
  }
}

// =============================================================================
// MinIO / S3 兼容适配器（minio SDK，SigV4 签名 + 预签名 URL）
// =============================================================================
class MinioAdapter implements OssAdapter {
  readonly provider = 'minio' as const
  readonly bucket: string
  readonly region: string
  readonly customDomain: string | null
  private client: MinioClient
  // endpoint 的 scheme://host:port 前缀（拼公开 URL 用）
  private endpointOrigin: string

  constructor(cfg: OssAdapterConfig) {
    this.bucket = cfg.bucket
    this.region = cfg.region
    this.customDomain = cfg.customDomain ?? null

    // S3 模式必须显式指定 endpoint（无法从 region 推导），schema 层已校验
    if (!cfg.endpoint) {
      throw new BusinessError(
        'OSS_NOT_CONFIGURED',
        'MinIO 模式必须填写 Endpoint（如 http://localhost:9000）',
        400,
      )
    }

    let parsed: URL
    try {
      parsed = new URL(cfg.endpoint)
    } catch {
      throw new BusinessError(
        'OSS_NOT_CONFIGURED',
        `Endpoint 不是合法 URL：${cfg.endpoint}`,
        400,
      )
    }

    this.endpointOrigin = parsed.origin
    this.client = new MinioClient({
      endPoint: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : undefined,
      useSSL: parsed.protocol === 'https:',
      accessKey: cfg.accessKeyId,
      secretKey: cfg.accessKeySecret,
      // MinIO 服务端默认 region 为 us-east-1，无配置时 SDK 自动处理
    })
  }

  // 测试连接：bucketExists 一次 RPC 即可验证凭据 + bucket 存在性
  async test(): Promise<void> {
    try {
      const exists = await this.client.bucketExists(this.bucket)
      if (!exists) {
        throw new BusinessError(
          'OSS_BUCKET_NOT_FOUND',
          `Bucket 不存在：${this.bucket}（请先在 MinIO 控制台创建）`,
          404,
        )
      }
    } catch (e) {
      if (e instanceof BusinessError) throw e
      throw normalizeOssError(e)
    }
  }

  async put(key: string, buffer: Buffer, contentType: string): Promise<{ etag: string }> {
    try {
      const info = await this.client.putObject(
        this.bucket,
        key,
        buffer,
        buffer.length,
        { 'Content-Type': contentType },
      )
      return { etag: (info as { etag?: string }).etag ?? '' }
    } catch (e) {
      throw normalizeOssError(e)
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.client.removeObject(this.bucket, key)
    } catch (e) {
      throw normalizeOssError(e)
    }
  }

  // S3 SigV4 预签名 URL：host 为后端连接的 endpoint，
  // 若浏览器与后端网络视图不同（如容器内网），需配置 customDomain 重写
  async signUrl(key: string, expiresSec: number): Promise<string> {
    try {
      const signed = await this.client.presignedGetObject(this.bucket, key, expiresSec)
      return this.rewriteHost(signed)
    } catch (e) {
      throw normalizeOssError(e)
    }
  }

  objectUrl(key: string): string {
    if (this.customDomain) {
      return `${this.customDomain.replace(/\/+$/, '')}/${key}`
    }
    return `${this.endpointOrigin}/${this.bucket}/${key}`
  }

  // 预签名 URL 的查询参数（签名/过期时间）必须保留，仅替换 host 部分
  private rewriteHost(signedUrl: string): string {
    if (!this.customDomain) return signedUrl
    try {
      const url = new URL(signedUrl)
      const domain = new URL(this.customDomain.replace(/\/+$/, ''))
      url.protocol = domain.protocol
      url.host = domain.host
      return url.toString()
    } catch {
      return signedUrl
    }
  }
}

// =============================================================================
// 编排函数（拉取 → 生成 key → 上传 → 拼 URL，两种模式共用）
// =============================================================================

// 远程 URL 转存（核心场景：AI 生成图片的临时 URL → 对象存储永久 URL）
export async function uploadFromUrl(args: {
  adapter: OssAdapter
  sourceUrl: string
  pathPrefix: string
  filename?: string
  contentType?: string
}): Promise<{
  url: string
  key: string
  contentType: string
  size: number
}> {
  const { adapter, sourceUrl, pathPrefix, filename, contentType: hintCt } = args

  const { buffer, contentType, ext } = await fetchSourceAsBuffer(
    sourceUrl,
    hintCt,
    filename ? extractExtFromFilename(filename) : undefined,
  )

  const key = generateObjectKey(pathPrefix, ext)
  await adapter.put(key, buffer, contentType)

  return {
    url: adapter.objectUrl(key),
    key,
    contentType,
    size: buffer.length,
  }
}

// 上传 Buffer（后端代理 multipart 上传场景）
export async function uploadBuffer(args: {
  adapter: OssAdapter
  key: string
  buffer: Buffer
  contentType: string
}): Promise<{
  url: string
  key: string
  etag: string
  size: number
}> {
  const { adapter, key, buffer, contentType } = args
  const { etag } = await adapter.put(key, buffer, contentType)
  return {
    url: adapter.objectUrl(key),
    key,
    etag,
    size: buffer.length,
  }
}

// 连通性测试（service 层的 /test 接口用）
export async function testOssConnectivity(
  adapter: OssAdapter,
): Promise<{
  ok: boolean
  latencyMs: number
  bucketEcho: string
  regionEcho: string
}> {
  const startedAt = Date.now()
  await adapter.test()
  return {
    ok: true,
    latencyMs: Date.now() - startedAt,
    bucketEcho: adapter.bucket,
    regionEcho: adapter.region,
  }
}

// 生成 OSS 对象 key：{pathPrefix}/{yy}/{mm}/{dd}/{uuid}.{ext}
export function generateObjectKey(pathPrefix: string, ext: string): string {
  const now = new Date()
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(now.getUTCDate()).padStart(2, '0')
  const uuid = uuidv4().replace(/-/g, '').slice(0, 16)
  const safeExt = ext.startsWith('.') ? ext.slice(1).toLowerCase() : ext.toLowerCase()
  const trimmedPrefix = pathPrefix.replace(/^\/+|\/+$/g, '')
  return `${trimmedPrefix}/${yyyy}/${mm}/${dd}/${uuid}.${safeExt}`
}

// -----------------------------------------------------------------------------
// 辅助函数
// -----------------------------------------------------------------------------

// 从 URL 或 data: 协议解析 contentType 与 buffer
async function fetchSourceAsBuffer(
  sourceUrl: string,
  fallbackContentType?: string,
  fallbackExt?: string,
): Promise<{ buffer: Buffer; contentType: string; ext: string }> {
  // 分支 1：data:image/png;base64,xxx
  if (sourceUrl.startsWith('data:')) {
    const match = sourceUrl.match(/^data:([\w/.+-]+);base64,(.+)$/)
    if (!match) {
      throw new BusinessError(
        'OSS_INVALID_URL',
        'data URL 格式错误，应为 data:<mime>;base64,<data>',
        400,
      )
    }
    const contentType = match[1]
    const buffer = Buffer.from(match[2], 'base64')
    if (buffer.length > MAX_FILE_SIZE) {
      throw new BusinessError(
        'OSS_FILE_TOO_LARGE',
        `文件超过 10MB 上限（当前 ${buffer.length} 字节）`,
        413,
      )
    }
    const ext = mimeToExt(contentType, fallbackExt)
    return { buffer, contentType, ext }
  }

  // 分支 2：http(s)://
  if (!sourceUrl.startsWith('http://') && !sourceUrl.startsWith('https://')) {
    throw new BusinessError(
      'OSS_INVALID_URL',
      'url 必须是 http(s):// 或 data: 协议',
      400,
    )
  }

  let resp: Response
  try {
    resp = await fetch(sourceUrl, {
      method: 'GET',
      redirect: 'follow',
      // 设置合理超时（fetch 无原生 timeout，用 AbortController 实现）
      signal: AbortSignal.timeout(30_000),
    })
  } catch (e) {
    const err = e as Error
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new BusinessError(
        'OSS_REMOTE_FETCH_FAILED',
        `拉取远程图片超时：${sourceUrl}`,
        504,
      )
    }
    throw new BusinessError(
      'OSS_REMOTE_FETCH_FAILED',
      `拉取远程图片失败：${err.message}`,
      502,
    )
  }

  if (!resp.ok) {
    throw new BusinessError(
      'OSS_REMOTE_FETCH_FAILED',
      `远程图片返回 ${resp.status}：${sourceUrl}`,
      502,
    )
  }

  const contentLength = Number(resp.headers.get('content-length') ?? '0')
  if (contentLength > MAX_FILE_SIZE) {
    throw new BusinessError(
      'OSS_FILE_TOO_LARGE',
      `文件超过 10MB 上限（Content-Length: ${contentLength}）`,
      413,
    )
  }

  const arrayBuffer = await resp.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  if (buffer.length > MAX_FILE_SIZE) {
    throw new BusinessError(
      'OSS_FILE_TOO_LARGE',
      `文件超过 10MB 上限（实际 ${buffer.length} 字节）`,
      413,
    )
  }

  const contentType = resp.headers.get('content-type') ?? fallbackContentType ?? 'application/octet-stream'
  // 优先从 URL 路径推断 ext，其次用 mime
  const urlExt = extractExtFromUrl(sourceUrl)
  const ext = urlExt ?? mimeToExt(contentType, fallbackExt)
  return { buffer, contentType, ext }
}

function mimeToExt(mime: string, fallback?: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/tiff': 'tiff',
    'image/x-icon': 'ico',
    'image/vnd.microsoft.icon': 'ico',
    'application/octet-stream': fallback ?? 'bin',
  }
  return map[mime.toLowerCase()] ?? fallback ?? 'bin'
}

function extractExtFromUrl(url: string): string | undefined {
  // 去掉 query / hash 后取最后一段的扩展名
  const clean = url.split('?')[0]?.split('#')[0]
  if (!clean) return undefined
  const last = clean.split('/').pop() ?? ''
  const dotIdx = last.lastIndexOf('.')
  if (dotIdx <= 0) return undefined
  const ext = last.slice(dotIdx + 1).toLowerCase()
  // 限制长度避免奇怪的扩展名
  if (ext.length > 8 || !/^[a-z0-9]+$/.test(ext)) return undefined
  return ext
}

function extractExtFromFilename(filename: string): string | undefined {
  const dotIdx = filename.lastIndexOf('.')
  if (dotIdx <= 0) return undefined
  return filename.slice(dotIdx + 1).toLowerCase()
}

// 错误归一化（ali-oss 与 minio SDK 的错误都归一到 OSS_* 业务错误码）
// 两个 SDK 的错误均带 code（如 NoSuchBucket / AccessDenied / SignatureDoesNotMatch）
// 与 HTTP 状态（ali-oss 为 status，minio 为 statuscode），此处统一读取
function normalizeOssError(e: unknown): BusinessError {
  const err = e as {
    status?: number
    statuscode?: number
    code?: string
    name?: string
    message?: string
  }
  const status = err.status ?? err.statuscode

  // 网络超时
  if (err.code === 'ETIMEDOUT' || status === 504 || err.name === 'ConnectionTimeoutError') {
    return new BusinessError('OSS_TIMEOUT', 'OSS 连接超时', 504)
  }

  // 鉴权失败
  if (status === 401 || err.code === 'SignatureDoesNotMatch' || err.code === 'InvalidAccessKeyId') {
    return new BusinessError(
      'OSS_AUTH_FAILED',
      `AccessKey 无效或签名错误（${err.code ?? status}）`,
      401,
    )
  }

  // bucket 不存在 / 无权访问
  if (status === 404 || err.code === 'NoSuchBucket') {
    return new BusinessError(
      'OSS_BUCKET_NOT_FOUND',
      `Bucket 不存在或无权访问（${err.message ?? 'unknown'}）`,
      404,
    )
  }
  if (status === 403 || err.code === 'AccessDenied') {
    return new BusinessError(
      'OSS_BUCKET_FORBIDDEN',
      `OSS 拒绝访问（${err.message ?? 'AccessDenied'}）`,
      403,
    )
  }

  // 文件过大
  if (err.code === 'ExceedFileSizeLimit' || status === 413) {
    return new BusinessError('OSS_FILE_TOO_LARGE', '文件超过 OSS 允许大小', 413)
  }

  return new BusinessError(
    'OSS_UPLOAD_FAILED',
    `OSS 调用失败：${err.message ?? 'unknown error'}`,
    502,
  )
}
