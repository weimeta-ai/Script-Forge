// =============================================================================
// 阿里云 OSS 客户端工具层（核心抽象）
// -----------------------------------------------------------------------------
// 设计要点：
//   - 纯工具，不耦合 DB（service 层负责拿配置，本文件只接收 plain 配置）
//   - 未来切换服务商（如腾讯云 COS / AWS S3）只需替换此文件
//   - 工厂模式：每次调用按 effective config 创建 client（与 service 里 new OpenAI 同模式）
//
// 关键技术决策：
//   - ali-oss 是 CJS 包，ESM 项目用默认导入：`import OSS from 'ali-oss'`
//   - 远程图片拉取：Node 18+ 内置 fetch（项目已要求 Node 22）
//   - 上传对象 key 规则：{pathPrefix}/{yy}/{mm}/{dd}/{uuid}.{ext}（按日期分桶）
//   - 访问 URL 优先级：customDomain > bucket 公网直链
// =============================================================================

import OSS from 'ali-oss'
import { v4 as uuidv4 } from 'uuid'
import { BusinessError } from './errors'

// 客户端配置（plain，不脱敏）
export interface OssClientConfig {
  accessKeyId: string
  accessKeySecret: string
  region: string
  bucket: string
  endpoint?: string | null
  timeout?: number
}

// 上传 Buffer 的入参
export interface UploadBufferArgs {
  client: OSS
  key: string
  buffer: Buffer
  contentType: string
  bucket: string
  region: string
  customDomain?: string | null
}

// 远程 URL 转存的入参
export interface UploadFromUrlArgs {
  client: OSS
  sourceUrl: string
  pathPrefix: string
  filename?: string
  contentType?: string
  bucket: string
  region: string
  customDomain?: string | null
}

// 单文件大小上限（10MB，对应 OSS_FILE_TOO_LARGE）
const MAX_FILE_SIZE = 10 * 1024 * 1024

// 创建 OSS 客户端
export function createOssClient(cfg: OssClientConfig): OSS {
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
  return new OSS(options)
}

// 测试连接：列 1 个对象验证凭据 + bucket 访问权
// bucketExists 在公开 bucket / 跨账号时可能行为不一，list 更可靠
// 注：bucket/region 通过参数传入（OSS 类型未公开 options 字段）
export async function testOssConnectivity(
  client: OSS,
  meta: { bucket: string; region: string },
): Promise<{
  ok: boolean
  latencyMs: number
  bucketEcho: string
  regionEcho: string
}> {
  const startedAt = Date.now()
  try {
    // list 不指定 prefix 时返回根目录前 max-keys 个对象
    // 注：objects 可能为空（bucket 无对象），但只要不抛异常即视为凭据有效
    await client.list({ 'max-keys': 1 }, {})
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      bucketEcho: meta.bucket,
      regionEcho: meta.region,
    }
  } catch (e) {
    throw normalizeOssError(e, startedAt)
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

// 根据是否有 customDomain 返回最终访问 URL
export function buildObjectUrl(args: {
  key: string
  customDomain?: string | null
  bucket: string
  region: string
}): string {
  const { key, customDomain, bucket, region } = args
  if (customDomain) {
    const domain = customDomain.replace(/\/+$/, '')
    return `${domain}/${key}`
  }
  return `https://${bucket}.${region}.aliyuncs.com/${key}`
}

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

// 上传 Buffer 到 OSS
export async function uploadBuffer(args: UploadBufferArgs): Promise<{
  url: string
  key: string
  etag: string
  size: number
}> {
  const { client, key, buffer, contentType, bucket, region, customDomain } = args
  const startedAt = Date.now()
  try {
    const result = await client.put(key, buffer, {
      mime: contentType,
      headers: {
        'Content-Type': contentType,
      },
    })
    const url = buildObjectUrl({ key, customDomain, bucket, region })
    return {
      url,
      key: result.name ?? key,
      etag: (result as { etag?: string }).etag ?? '',
      size: buffer.length,
    }
  } catch (e) {
    throw normalizeOssError(e, startedAt)
  }
}

// 远程 URL 转存（核心场景：AI 生成图片的临时 URL → OSS 永久 URL）
export async function uploadFromUrl(args: UploadFromUrlArgs): Promise<{
  url: string
  key: string
  contentType: string
  size: number
}> {
  const { client, sourceUrl, pathPrefix, filename, contentType: hintCt, bucket, region, customDomain } = args

  const { buffer, contentType, ext } = await fetchSourceAsBuffer(
    sourceUrl,
    hintCt,
    filename ? extractExtFromFilename(filename) : undefined,
  )

  const key = generateObjectKey(pathPrefix, ext)
  const result = await uploadBuffer({
    client,
    key,
    buffer,
    contentType,
    bucket,
    region,
    customDomain,
  })

  return {
    url: result.url,
    key: result.key,
    contentType,
    size: result.size,
  }
}

// -----------------------------------------------------------------------------
// 辅助函数
// -----------------------------------------------------------------------------

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

// 错误归一化（与 image-config.service 风格一致）
function normalizeOssError(e: unknown, startedAt: number): BusinessError {
  const err = e as {
    status?: number
    code?: string
    name?: string
    message?: string
  }

  // 网络超时
  if (err.code === 'ETIMEDOUT' || err.status === 504 || err.name === 'ConnectionTimeoutError') {
    return new BusinessError(
      'OSS_TIMEOUT',
      `OSS 连接超时（${Date.now() - startedAt}ms）`,
      504,
    )
  }

  // 鉴权失败
  if (err.status === 401 || err.code === 'SignatureDoesNotMatch' || err.code === 'InvalidAccessKeyId') {
    return new BusinessError(
      'OSS_AUTH_FAILED',
      `AccessKey 无效或签名错误（${err.code ?? err.status}）`,
      401,
    )
  }

  // bucket 不存在 / 无权访问
  if (err.status === 404 || err.code === 'NoSuchBucket') {
    return new BusinessError(
      'OSS_BUCKET_NOT_FOUND',
      `Bucket 不存在或无权访问（${err.message ?? 'unknown'}）`,
      404,
    )
  }
  if (err.status === 403 || err.code === 'AccessDenied') {
    return new BusinessError(
      'OSS_BUCKET_FORBIDDEN',
      `OSS 拒绝访问（${err.message ?? 'AccessDenied'}）`,
      403,
    )
  }

  // 文件过大
  if (err.code === 'ExceedFileSizeLimit' || err.status === 413) {
    return new BusinessError(
      'OSS_FILE_TOO_LARGE',
      '文件超过 OSS 允许大小',
      413,
    )
  }

  return new BusinessError(
    'OSS_UPLOAD_FAILED',
    `OSS 调用失败：${err.message ?? 'unknown error'}`,
    502,
  )
}
