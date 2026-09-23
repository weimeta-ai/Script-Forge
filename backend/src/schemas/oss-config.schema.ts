// =============================================================================
// OSS 图床配置请求体校验（Zod）
// -----------------------------------------------------------------------------
// 用于：
//   PUT  /oss-config             更新配置
//   POST /oss-config/test        测试连接（不写 DB）
//   POST /oss-config/upload-by-url  远程 URL 转存到 OSS
// =============================================================================

import { z } from 'zod'

// 阿里云 OSS 地域前缀校验（如 oss-cn-hangzhou / oss-us-west-1 / oss-ap-southeast-1）
// 仅 provider=aliyun 时启用；minio/S3 模式无地域概念（常用占位 us-east-1）
const REGION_PATTERN = /^oss-[a-z]+-[a-z0-9-]+$/i

// PUT /oss-config 请求体
// accessKeyId / accessKeySecret 设计同 llm-config / image-config：
//   留空表示沿用 DB 已存的值（admin 改其他字段时不必每次重输密钥）
export const updateOssConfigSchema = z
  .object({
    name: z
      .string({ error: '配置名称不能为空' })
      .min(1, '配置名称不能为空')
      .max(64, '配置名称最长 64 字符'),
    // 存储模式：aliyun = 阿里云 OSS；minio = S3 兼容（MinIO / AWS S3）
    provider: z.enum(['aliyun', 'minio']).default('aliyun'),
    accessKeyId: z
      .string()
      .max(128, 'AccessKey Id 最长 128 字符')
      .optional()
      .transform((v) => (v && v.length > 0 ? v : undefined)),
    accessKeySecret: z
      .string()
      .max(256, 'AccessKey Secret 最长 256 字符')
      .optional()
      .transform((v) => (v && v.length > 0 ? v : undefined)),
    region: z
      .string({ error: '地域不能为空' })
      .min(1, '地域不能为空')
      .max(64, '地域最长 64 字符'),
    bucket: z
      .string({ error: 'Bucket 不能为空' })
      .min(1, 'Bucket 不能为空')
      .max(64, 'Bucket 最长 64 字符')
      .regex(
        /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/,
        'Bucket 名只能包含小写字母、数字、短横线，且不以短横线开头/结尾',
      ),
    endpoint: z
      .string()
      .max(256, 'Endpoint 最长 256 字符')
      .url('Endpoint 必须是合法 URL（如 https://oss-cn-hangzhou.aliyuncs.com）')
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null))
      .or(z.null())
      .default(null),
    customDomain: z
      .string()
      .max(256, '自定义域名最长 256 字符')
      .url('自定义域名必须是合法 URL（如 https://cdn.example.com）')
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null))
      .or(z.null())
      .default(null),
    pathPrefix: z
      .string()
      .max(128, '路径前缀最长 128 字符')
      .regex(
        /^[a-z0-9][a-z0-9/_-]*[a-z0-9]$/i,
        '路径前缀只能包含字母、数字、/、_、-，且不以 / 开头/结尾',
      )
      .optional()
      .transform((v) => (v && v.length > 0 ? v : 'drama/images'))
      .default('drama/images'),
    timeoutMs: z.coerce
      .number()
      .int('超时必须是整数')
      .min(5000, '超时下限 5 秒')
      .max(600000, '超时上限 10 分钟')
      .default(60000),
  })
  // 跨字段条件校验（provider 决定 region 格式与 endpoint 是否必填）
  .superRefine((data, ctx) => {
    if (data.provider === 'aliyun' && !REGION_PATTERN.test(data.region)) {
      ctx.addIssue({
        code: 'custom',
        path: ['region'],
        message: '地域格式错误，应为 oss-<区域>-<城市>（如 oss-cn-hangzhou）',
      })
    }
    // MinIO 无法从 region 推导地址，endpoint 必填（如 http://localhost:9000）
    if (data.provider === 'minio' && !data.endpoint) {
      ctx.addIssue({
        code: 'custom',
        path: ['endpoint'],
        message: 'MinIO 模式必须填写 Endpoint（如 http://localhost:9000）',
      })
    }
  })

// POST /oss-config/test 请求体（均可选，缺省则用 DB/env 已存值）
export const testOssConfigSchema = z.object({
  provider: z.enum(['aliyun', 'minio']).optional(),
  accessKeyId: z.string().max(128).optional(),
  accessKeySecret: z.string().max(256).optional(),
  region: z.string().max(64).optional(),
  bucket: z.string().max(64).optional(),
  endpoint: z.string().max(256).url().optional(),
})

// POST /oss-config/upload-by-url 请求体
// url 支持：https:// 远程图片 / data:image/...;base64,xxx 内联图片
export const uploadByUrlSchema = z.object({
  url: z
    .string({ error: 'url 不能为空' })
    .min(1, 'url 不能为空')
    .max(8192, 'url 最长 8192 字符')
    .refine(
      (v) => v.startsWith('http://') || v.startsWith('https://') || v.startsWith('data:'),
      'url 必须是 http(s):// 或 data: 协议',
    ),
  filename: z.string().max(256).optional(),
  contentType: z.string().max(128).optional(),
})

export type UpdateOssConfigInput = z.infer<typeof updateOssConfigSchema>
export type TestOssConfigInput = z.infer<typeof testOssConfigSchema>
export type UploadByUrlInput = z.infer<typeof uploadByUrlSchema>
