// =============================================================================
// OSS 对象签名 URL 工具
// -----------------------------------------------------------------------------
// 设计要点：
//   - 私有 bucket 直链会 403；调用方读取时需通过本工具动态签名
//   - 默认 expires 1 小时（3600s），覆盖前端单次会话时长
//   - 兼容旧数据：DB 里历史 coverUrl 可能存的是完整 https URL（来自改造前），
//     signer 检测到 http(s):// 直接原样返回（旧 URL 已失效可忽略，但不报错）
//   - 兼容 data: URL（理论上不会出现，但兜底）
//   - OSS 未配置时原样返回（不阻塞读取流程，前端会显示默认图）
//
// 实现细节：
//   - ali-oss signatureUrl 是同步函数（内部计算 HMAC-SHA1 签名）
//   - 但创建 client 需要 await getEffectiveOssConfig()，故整体签名流程是 async
// =============================================================================

import OSS from 'ali-oss'
import { createOssClient } from './oss-client'
import { getEffectiveOssConfig } from '../services/oss-config.service'

// 默认签名有效期：1 小时
const DEFAULT_EXPIRES_SEC = 3600

// 把 DB 里存的值（key / 完整 URL / data:URL）转成浏览器可访问的签名 URL
export async function signObjectUrl(
  stored: string | null | undefined,
  expiresSec: number = DEFAULT_EXPIRES_SEC,
): Promise<string | null> {
  if (!stored) return null

  // 兼容 data: URL（base64 内嵌，无需签名）
  if (stored.startsWith('data:')) return stored

  // 兼容旧数据：完整 http(s):// URL 原样返回
  // 改造前 DB 存的是完整 OSS 直链，私有 bucket 会 403，但这是已知历史问题
  // 重新生成即可覆盖；这里不报错以免阻塞详情接口
  if (/^https?:\/\//i.test(stored)) return stored

  // 剩余视为 object key（drama/images/2026/06/25/xxx.png）
  // 走签名流程
  try {
    const cfg = await getEffectiveOssConfig()
    if (!cfg.accessKeyId || !cfg.accessKeySecret) {
      return stored
    }
    const client: OSS = createOssClient({
      accessKeyId: cfg.accessKeyId,
      accessKeySecret: cfg.accessKeySecret,
      region: cfg.region,
      bucket: cfg.bucket,
      endpoint: cfg.endpoint,
      timeout: cfg.timeoutMs,
    })
    return client.signatureUrl(stored, { expires: expiresSec })
  } catch {
    // OSS 配置缺失或签名失败时，回退原值（前端会显示默认图）
    return stored
  }
}

// 批量签名（list 接口用，避免循环 await 慢）
// 实测签名是 CPU 计算（HMAC），10 条 < 5ms，串行即可
export async function signObjectUrls(
  items: (string | null | undefined)[],
  expiresSec: number = DEFAULT_EXPIRES_SEC,
): Promise<(string | null)[]> {
  return Promise.all(items.map((x) => signObjectUrl(x, expiresSec)))
}
