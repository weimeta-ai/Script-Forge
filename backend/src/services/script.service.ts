// 剧本业务服务层（p00 同款简化）
// -----------------------------------------------------------------------------
// 职责：
//   - listScripts    列出当前用户所有剧本（不含 sourceContent）
//   - createScript   事务创建：scripts + script_versions V1
//   - deleteScript   软删（归属校验）
//   - getScript      取剧本详情（含 sourceContent，归属校验）
// =============================================================================

import { db } from '../db/client'
import { scripts, scriptVersions } from '../db/schema'
import { scriptRepository, type ScriptListItem } from '../repositories/script.repository'
import { scriptVersionRepository } from '../repositories/script-version.repository'
import { notFound } from '../lib/errors'
import { signObjectUrl, signObjectUrls } from '../lib/oss-signer'

// 列表（coverUrl 在 DB 里存 object key，读时签名返回可访问 URL）
export async function listScripts(userId: string): Promise<ScriptListItem[]> {
  const items = await scriptRepository.listByUserId(userId)
  // 并发签名（Promise.all 内部串行，10 条 < 50ms）
  const signed = await Promise.all(
    items.map((it) => signObjectUrl(it.coverUrl)),
  )
  return items.map((it, idx) => ({ ...it, coverUrl: signed[idx] }))
}

// 详情（含 sourceContent）
export async function getScript(userId: string, scriptId: string) {
  const script = await scriptRepository.findById(scriptId)
  if (!script || script.userId !== userId) {
    throw notFound('剧本')
  }
  // coverUrl（选中项）+ coverUrlCandidates（候选数组）签名；私有 bucket 直链会 403
  const [signedCover, signedCandidates] = await Promise.all([
    signObjectUrl(script.coverUrl),
    signObjectUrls(script.coverUrlCandidates ?? []),
  ])
  return {
    ...script,
    coverUrl: signedCover,
    coverUrlCandidates: signedCandidates.filter(Boolean) as string[],
  }
}

// 创建（粘贴文本模式 / 上传文件解析后调用）
export async function createScript(
  userId: string,
  input: {
    title: string
    sourceContent: string
    genre?: string | null
    fileName?: string | null
  },
) {
  const wordCount = input.sourceContent.length

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(scripts)
      .values({
        userId,
        title: input.title,
        genre: input.genre ?? null,
        fileName: input.fileName ?? null,
        sourceContent: input.sourceContent,
        wordCount,
        status: 'active',
      })
      .returning()
    const script = inserted[0]

    await tx.insert(scriptVersions).values({
      scriptId: script.id,
      versionNo: 1,
      content: input.sourceContent,
      isCurrent: true,
    })

    return script
  })
}

// 软删
export async function deleteScript(userId: string, scriptId: string) {
  const script = await scriptRepository.findById(scriptId)
  if (!script || script.userId !== userId) {
    throw notFound('剧本')
  }
  await scriptRepository.softDelete(scriptId)
}

// 取报告（前端报告页用）
export async function getReport(userId: string, scriptId: string) {
  const script = await getScript(userId, scriptId)
  const version = await scriptVersionRepository.findCurrentByScriptId(scriptId)
  const scoreDetails = (version?.scoreDetails ?? null) as { report?: string } | null
  return {
    script,
    version,
    report: scoreDetails?.report ?? '',
  }
}
