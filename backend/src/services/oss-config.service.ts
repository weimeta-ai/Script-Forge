// =============================================================================
// OSS 图床配置业务服务层（双模式：阿里云 / MinIO S3 兼容）
// -----------------------------------------------------------------------------
// 职责：
//   - getEffectiveConfig  当前生效配置（DB > env）
//   - getMasked           给前端展示（脱敏 AK/SK）
//   - update              UPSERT
//   - testConnection      按 provider 发一次连通性探测
//   - uploadFromUrl       远程 URL 转存（核心：AI 图片持久化）
//   - uploadBuffer        后端代理 multipart 上传
//
// 设计要点：
//   - env 不强制要求 OSS_* 变量（OSS 功能可选）
//   - accessKeyId/Secret 留空表示沿用 DB（与 llm-config / image-config 一致）
//   - 错误码前缀 OSS_，与 IMAGE_ / LLM_ 平行
// =============================================================================

import {
  ossSettingsRepository,
  toOssMasked,
  type OssSettingsMasked,
} from '../repositories/oss-settings.repository'
import { BusinessError } from '../lib/errors'
import {
  createOssAdapter,
  testOssConnectivity,
  uploadBuffer as ossUploadBuffer,
  uploadFromUrl as ossUploadFromUrl,
  generateObjectKey,
  type OssProvider,
} from '../lib/oss-client'
import type {
  UpdateOssConfigInput,
  TestOssConfigInput,
  UploadByUrlInput,
} from '../schemas/oss-config.schema'

// env 兜底（OSS 功能可选，env 缺失时返回空字符串）
function getOssEnvFallback() {
  return {
    provider: normalizeProvider(process.env.OSS_PROVIDER),
    accessKeyId: process.env.OSS_ACCESS_KEY_ID ?? '',
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET ?? '',
    region: process.env.OSS_REGION ?? '',
    bucket: process.env.OSS_BUCKET ?? '',
    endpoint: process.env.OSS_ENDPOINT ?? '',
    customDomain: process.env.OSS_CUSTOM_DOMAIN ?? '',
    pathPrefix: process.env.OSS_PATH_PREFIX ?? 'drama/images',
    timeoutMs: Number(process.env.OSS_TIMEOUT_MS ?? 60000),
  }
}

// provider 宽松解析（env 值不可信，非法值回退 aliyun 保持旧行为）
function normalizeProvider(value: string | undefined): OssProvider {
  return value === 'minio' ? 'minio' : 'aliyun'
}

export interface OssEffectiveConfig {
  provider: OssProvider
  accessKeyId: string
  accessKeySecret: string
  region: string
  bucket: string
  endpoint: string | null
  customDomain: string | null
  pathPrefix: string
  timeoutMs: number
  source: 'db' | 'env'
  name?: string
}

// 获取当前生效配置（DB 优先，env 兜底）
// 注意：env 缺 accessKeyId/accessKeySecret 时返回空字符串，由上层判断是否报错
export async function getEffectiveOssConfig(): Promise<OssEffectiveConfig> {
  const fromDb = await ossSettingsRepository.getPlain()
  if (fromDb) {
    return {
      provider: normalizeProvider(fromDb.provider),
      accessKeyId: fromDb.accessKeyId,
      accessKeySecret: fromDb.accessKeySecret,
      region: fromDb.region,
      bucket: fromDb.bucket,
      endpoint: fromDb.endpoint,
      customDomain: fromDb.customDomain,
      pathPrefix: fromDb.pathPrefix,
      timeoutMs: fromDb.timeoutMs,
      name: fromDb.name,
      source: 'db',
    }
  }
  const env = getOssEnvFallback()
  return {
    provider: env.provider,
    accessKeyId: env.accessKeyId,
    accessKeySecret: env.accessKeySecret,
    region: env.region,
    bucket: env.bucket,
    endpoint: env.endpoint || null,
    customDomain: env.customDomain || null,
    pathPrefix: env.pathPrefix,
    timeoutMs: env.timeoutMs,
    source: 'env',
  }
}

// 给前端展示用（脱敏）
export async function getMaskedOssConfig(): Promise<OssSettingsMasked | null> {
  const plain = await ossSettingsRepository.getPlain()
  if (!plain) return null
  return toOssMasked(plain)
}

// 更新配置（UPSERT）
// accessKeyId / accessKeySecret 留空时沿用 DB 已存值（与 llm-config / image-config 一致）
export async function updateOssConfig(input: UpdateOssConfigInput): Promise<OssSettingsMasked> {
  const existing = await ossSettingsRepository.getPlain()

  let finalAccessKeyId = input.accessKeyId
  let finalAccessKeySecret = input.accessKeySecret

  // 首次保存：必须同时提供 AK + SK
  if (!existing) {
    if (!finalAccessKeyId || !finalAccessKeySecret) {
      throw new BusinessError(
        'OSS_API_KEY_REQUIRED',
        '首次保存必须同时提供 AccessKey Id 和 Secret',
        400,
      )
    }
  } else {
    // 后续更新：留空沿用旧值
    if (!finalAccessKeyId) finalAccessKeyId = existing.accessKeyId
    if (!finalAccessKeySecret) finalAccessKeySecret = existing.accessKeySecret
  }

  const updated = await ossSettingsRepository.upsert({
    name: input.name,
    provider: input.provider,
    accessKeyId: finalAccessKeyId,
    accessKeySecret: finalAccessKeySecret,
    region: input.region,
    bucket: input.bucket,
    endpoint: input.endpoint,
    customDomain: input.customDomain,
    pathPrefix: input.pathPrefix,
    timeoutMs: input.timeoutMs,
  })
  return toOssMasked(updated)
}

// 测试连接：按 provider 发一次连通性探测（aliyun=list / minio=bucketExists）
export async function testOssConnection(input: TestOssConfigInput): Promise<{
  ok: boolean
  latencyMs: number
  bucketEcho: string
  regionEcho: string
}> {
  let finalProvider = input.provider
  let finalAccessKeyId = input.accessKeyId
  let finalAccessKeySecret = input.accessKeySecret
  let finalRegion = input.region
  let finalBucket = input.bucket
  let finalEndpoint = input.endpoint

  // 任一字段缺失，从 DB/env 兜底取
  if (!finalAccessKeyId || !finalAccessKeySecret || !finalRegion || !finalBucket) {
    const effective = await getEffectiveOssConfig()
    finalProvider = finalProvider ?? effective.provider
    finalAccessKeyId = finalAccessKeyId ?? effective.accessKeyId
    finalAccessKeySecret = finalAccessKeySecret ?? effective.accessKeySecret
    finalRegion = finalRegion ?? effective.region
    finalBucket = finalBucket ?? effective.bucket
    finalEndpoint = finalEndpoint ?? effective.endpoint ?? undefined
  }

  if (!finalAccessKeyId || !finalAccessKeySecret) {
    throw new BusinessError(
      'OSS_TEST_NO_CONFIG',
      '缺少 AccessKey，无法测试（请先保存配置或在测试请求中传入）',
      400,
    )
  }
  if (!finalRegion || !finalBucket) {
    throw new BusinessError(
      'OSS_TEST_NO_CONFIG',
      '缺少 region 或 bucket，请先保存配置或传入测试参数',
      400,
    )
  }

  const effective = await getEffectiveOssConfig()
  const adapter = createOssAdapter({
    provider: finalProvider ?? 'aliyun',
    accessKeyId: finalAccessKeyId,
    accessKeySecret: finalAccessKeySecret,
    region: finalRegion,
    bucket: finalBucket,
    endpoint: finalEndpoint,
    timeout: effective.timeoutMs,
  })

  return testOssConnectivity(adapter)
}

// 远程 URL 转存到 OSS（核心场景：AI 图片临时 URL → OSS 永久 URL）
export async function uploadImageFromUrl(input: UploadByUrlInput): Promise<{
  url: string
  key: string
  contentType: string
  size: number
  source: 'db' | 'env'
}> {
  const effective = await getEffectiveOssConfig()
  if (!effective.accessKeyId || !effective.accessKeySecret) {
    throw new BusinessError(
      'OSS_NOT_CONFIGURED',
      '尚未配置 OSS 凭据，请先在管理后台保存 AccessKey',
      400,
    )
  }

  const client = createOssAdapter({
    provider: effective.provider,
    accessKeyId: effective.accessKeyId,
    accessKeySecret: effective.accessKeySecret,
    region: effective.region,
    bucket: effective.bucket,
    endpoint: effective.endpoint,
    customDomain: effective.customDomain,
    timeout: effective.timeoutMs,
  })

  const result = await ossUploadFromUrl({
    adapter: client,
    sourceUrl: input.url,
    pathPrefix: effective.pathPrefix,
    filename: input.filename,
    contentType: input.contentType,
  })

  return {
    ...result,
    source: effective.source,
  }
}

// 后端代理 Buffer 上传（预留：未来 multipart 直传场景使用）
export async function uploadImageFromBuffer(args: {
  buffer: Buffer
  contentType: string
  filename?: string
}): Promise<{
  url: string
  key: string
  etag: string
  size: number
  source: 'db' | 'env'
}> {
  const effective = await getEffectiveOssConfig()
  if (!effective.accessKeyId || !effective.accessKeySecret) {
    throw new BusinessError(
      'OSS_NOT_CONFIGURED',
      '尚未配置 OSS 凭据，请先在管理后台保存 AccessKey',
      400,
    )
  }

  const client = createOssAdapter({
    provider: effective.provider,
    accessKeyId: effective.accessKeyId,
    accessKeySecret: effective.accessKeySecret,
    region: effective.region,
    bucket: effective.bucket,
    endpoint: effective.endpoint,
    customDomain: effective.customDomain,
    timeout: effective.timeoutMs,
  })

  // 推断扩展名
  const ext = args.filename
    ? args.filename.slice(args.filename.lastIndexOf('.') + 1).toLowerCase()
    : 'bin'

  const key = generateObjectKey(effective.pathPrefix, ext)

  const result = await ossUploadBuffer({
    adapter: client,
    key,
    buffer: args.buffer,
    contentType: args.contentType,
  })

  return {
    ...result,
    source: effective.source,
  }
}
