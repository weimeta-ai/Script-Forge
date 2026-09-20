// 封面图生成 prompt 拼接（纯函数，独立可测）
// -----------------------------------------------------------------------------
// 用途：把剧本标题 + 题材 + 报告摘要拼成图片模型可消费的中文 prompt
// 模板来源：
//   - DB prompt_settings.cover_template（admin 可编辑，60s TTL 缓存）
//   - DB 无配置时 fallback 到内置默认 FALLBACK_COVER_TEMPLATE
//
// 占位符（管理员可编辑模板时使用）：
//   {{title}}          剧本标题（缺失时 fallback "未命名剧本"）
//   {{genre}}          题材（缺失时 fallback "都市情感"，与原硬编码一致）
//   {{excerpt}}        报告摘要纯文本前 200 字
//   {{excerpt_block}}  excerpt 非空时展开为 "故事核心：{excerpt}。"，否则空串
// =============================================================================

import { getEffectiveCoverTemplate } from '../services/prompt-config.service'
import { getEffectiveCoverTemplateByUser } from '../services/user-prompt-config.service'

export interface CoverPromptInput {
  title: string
  genre?: string | null
  /** 报告 markdown 原文（函数内部 strip + 截断） */
  reportMarkdown: string
  /** 用户 ID（per-user 模板覆盖，未传时走全局话术） */
  userId?: string
}

// 内置默认模板（DB 无配置时 fallback，与 seed-prompts.ts 保持一致）
// 开源版不附带业务话术：仅保留占位符机制的极简模板，可在管理后台配置完整模板
const FALLBACK_COVER_TEMPLATE =
  '竖版海报封面：{{title}}，题材：{{genre}}。{{excerpt_block}}'

const EXCERPT_MAX = 200

// 模板缓存：按 userId 维度，60s TTL（worker 独立进程，跨进程不可见，TTL 让新任务自然刷新）
// cacheKey='global' 兜底无 userId 场景（与改造前行为一致）
const coverTemplateCacheByUser = new Map<
  string,
  { content: string; fetchedAt: number }
>()
const COVER_TEMPLATE_TTL_MS = 60_000

function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/^\s*[-:|\s]+$/gm, '')
    .replace(/^\s*>\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function skipDisclaimer(text: string): string {
  const patterns = [
    /本报告由[\w\s]*生成[，,。]?\s*仅供[^。]*。?\s*/i,
    /由[\w\s]*生成[，,。]?\s*仅供[^。]*。?\s*/i,
    /免责声明[：:][^。]*。\s*/i,
  ]
  let out = text
  for (const p of patterns) out = out.replace(p, '')
  return out.trim()
}

// 模板占位符替换（纯函数可测）
export function renderCoverTemplate(
  template: string,
  input: { title: string; genre?: string | null; excerpt: string },
): string {
  const title = input.title.trim() || '未命名剧本'
  const genre = (input.genre ?? '').trim() || '都市情感'
  const excerpt = input.excerpt.trim()
  const excerptBlock = excerpt ? `故事核心：${excerpt}。` : ''

  return template
    .replaceAll('{{title}}', title)
    .replaceAll('{{genre}}', genre)
    .replaceAll('{{excerpt_block}}', excerptBlock)
    .replaceAll('{{excerpt}}', excerpt)
}

// 异步构造 prompt（cover.worker.ts 调用）
// 模板来源：用户级 DB > 全局 DB > 内置默认（按 userId 维度 60s TTL 缓存）
export async function buildCoverPrompt(
  input: CoverPromptInput,
): Promise<string> {
  const now = Date.now()
  const cacheKey = input.userId ?? 'global'
  const cached = coverTemplateCacheByUser.get(cacheKey)
  if (!cached || now - cached.fetchedAt > COVER_TEMPLATE_TTL_MS) {
    const effective = input.userId
      ? await getEffectiveCoverTemplateByUser(input.userId)
      : await getEffectiveCoverTemplate()
    coverTemplateCacheByUser.set(cacheKey, {
      content: effective.content,
      fetchedAt: now,
    })
  }

  const plainText = skipDisclaimer(stripMarkdown(input.reportMarkdown ?? ''))
  const excerpt = plainText.slice(0, EXCERPT_MAX)
  return renderCoverTemplate(coverTemplateCacheByUser.get(cacheKey)!.content, {
    title: input.title,
    genre: input.genre,
    excerpt,
  })
}

export const __internal = {
  stripMarkdown,
  skipDisclaimer,
  renderCoverTemplate,
  FALLBACK_COVER_TEMPLATE,
  EXCERPT_MAX,
}
