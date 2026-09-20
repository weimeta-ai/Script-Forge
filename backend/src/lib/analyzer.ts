// 8 节点分析编排器（从 p00/lib/analyzer.ts 移植 + 适配 drama-predict-backend 的 llm-client）
// -----------------------------------------------------------------------------
// 支持三种分析模式（tasks.mode）：
//   - standard（默认）：8 节点串行调用，质量最高，节点逐个亮起
//   - fast：8 节点并行 + 内部限流（4 并发），耗时降 ~8 倍，质量不变
//   - ultra：单次调用合并所有节点 prompt，瞬时最高，长输出有质量风险
//
// 核心流程：
//   runAnalysis 入口按 mode 分发到 runStandardAnalysis / runFastAnalysis / runUltraAnalysis
// =============================================================================

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TaskEvent } from '../db/schema'
import { NODE_PROMPTS } from '../prompts/nodes'
import { getEffectiveReportPrompt } from '../services/prompt-config.service'
import { getEffectiveReportPromptByUser } from '../services/user-prompt-config.service'
import { chatCompletion } from './llm-client'
import { ANALYSIS_NODES, type AnalysisNode, type NodeId } from './nodes'

export { ANALYSIS_NODES }

const __dirname = dirname(fileURLToPath(import.meta.url))
const SYSTEM_PROMPT_PATH = resolve(__dirname, '../../refer/system_prompt.md')
const ULTRA_PROMPT_PATH = resolve(__dirname, '../prompts/ultra.md')

// 分析模式类型
export type AnalyzeMode = 'standard' | 'fast' | 'ultra'

// System prompt 缓存：按 userId 维度，60s TTL
// - worker 是独立进程，admin 在 web 进程改 prompt 后，worker 进程内的缓存无法主动失效
// - 用 TTL 让新进入任务自然刷新（admin 改后约 60s 内全量生效）
// - 已在跑的任务继续用旧 prompt（符合"旧任务旧 prompt"语义）
// - 按 userId 缓存：用户级话术改了，只影响该用户后续任务，不影响其他用户
// - cacheKey='global' 兜底无 userId 场景（与改造前行为一致）
const systemPromptCacheByUser = new Map<
	string,
	{ content: string; fetchedAt: number }
>()
const SYSTEM_PROMPT_TTL_MS = 60_000

// ultra prompt 仍是文件常驻（本期未纳入 admin 配置），保留原永久缓存
let ultraPromptCache: string | null = null

// 任务开始前调用一次：刷新过期缓存
// 调用方：analyze.worker.ts 的 processAnalyzeJob 入口
// userId 必传（worker 已反查 script -> userId）；未传时 fallback 到全局话术
export async function loadSystemPromptForTask(userId?: string): Promise<void> {
  const now = Date.now()
  const cacheKey = userId ?? 'global'
  const cached = systemPromptCacheByUser.get(cacheKey)
  if (cached && now - cached.fetchedAt < SYSTEM_PROMPT_TTL_MS) {
    return
  }
  // userId 存在时走 per-user 链路（用户级 > 全局 > 文件），否则与原行为一致
  const effective = userId
    ? await getEffectiveReportPromptByUser(userId)
    : await getEffectiveReportPrompt()
  systemPromptCacheByUser.set(cacheKey, {
    content: effective.content,
    fetchedAt: now,
  })
}

// 同步读取已加载的 system prompt
// 调用方必须先 await loadSystemPromptForTask(userId)（否则 fallback 读文件）
export function getCachedSystemPrompt(userId?: string): string {
  const cacheKey = userId ?? 'global'
  const cached = systemPromptCacheByUser.get(cacheKey)
  if (cached) {
    return cached.content
  }
  // 兜底：worker 未调 loadSystemPromptForTask 时读文件
  return readFileSync(SYSTEM_PROMPT_PATH, 'utf-8')
}

export function getUltraPrompt(): string {
  if (ultraPromptCache === null) {
    ultraPromptCache = readFileSync(ULTRA_PROMPT_PATH, 'utf-8')
  }
  return ultraPromptCache
}

// 节点进度回调（与 p00 对齐，但 event 类型复用 tasks schema 的 TaskEvent）
export type NodeProgressCallback = (event: Omit<TaskEvent, 'ts'>) => void

export interface RunAnalysisOptions {
	samples?: number // 兼容字段（多采样未实现，YAGNI）
	mode?: AnalyzeMode // 默认 standard
	// 用户管理扩展：业务路径必传，写 usage_log + per-user 配置
	userId?: string
	scriptId?: string
	// 内部使用：runAnalysis 把入口 taskId 写入此处，方便下游统一透传
	taskId?: string
}

// fast 模式内部并发数（worker concurrency=2 × 2 = 瞬时 4 路 LLM 请求，规避 provider 限流）
// 原值 4：实测 12 路瞬时（worker×3 + fast×4）会让国产 OpenAI 兼容 API 隐性限流挂死
const FAST_CONCURRENCY = 2

// 单节点最大输出 token
// 提升原因：narrative 节点 8 维度 × 280 字 + 可打磨点，新长度约束下约 5000-5500 token，
// 原 4096 会截断对白质量/悬念有效性正文
const NODE_MAX_TOKENS = 8192
// ultra 模式（合并 8 节点）输出 token 预算
// 16K ≈ 8 节点 × 2K/节点（含 audit 块 + 加权明细 + 三层亮点结构）
const ULTRA_MAX_TOKENS = 16384
// ultra 模式输入内容截断（5 万字符，加速生成；超长剧本建议用 fast / standard）
const ULTRA_CONTENT_LIMIT = 50000

// 单节点重试次数（1 次正常 + 1 次重试）
// 原因：provider 抖动通常瞬时，重试 1 次吸收 90% 抖动；超过 1 次大概率是限流/配置问题
const NODE_MAX_ATTEMPTS = 2
// 单节点重试退避（指数退避起点，仅第 1 次失败后等待）
const NODE_RETRY_BACKOFF_MS = 2000

// 入口：按 mode 分发
export async function runAnalysis(
  content: string,
  onProgress: NodeProgressCallback,
  taskId: string,
  options?: RunAnalysisOptions
): Promise<string> {
  const mode: AnalyzeMode = options?.mode ?? 'standard'
  const samples = options?.samples ?? 1
  if (samples !== 1) {
    console.warn(
      `[analyzer ${taskId}] samples=${samples} 暂未实现，回退到单次采样`
    )
  }

  console.log(
    `[analyzer ${taskId}] start mode=${mode}, content length: ${content.length}`
  )

  // 把 taskId 合并进 options，下游函数统一从 options 取
  const mergedOptions: RunAnalysisOptions = { ...options, taskId }

  switch (mode) {
    case 'ultra':
      return runUltraAnalysis(content, onProgress, taskId, mergedOptions)
    case 'fast':
      return runFastAnalysis(content, onProgress, taskId, mergedOptions)
    case 'standard':
    default:
      return runStandardAnalysis(content, onProgress, taskId, mergedOptions)
  }
}

// =============================================================================
// 单节点执行（含重试 + 进度事件）—— standard / fast 共用
// =============================================================================
// 重试语义：1 次正常 + 1 次重试（共 NODE_MAX_ATTEMPTS 次），指数退避 2s
// 失败仍抛出，由调用方决定是否整 task 失败

async function runOneNodeWithRetry(
  node: AnalysisNode,
  fullContent: string,
  systemPrompt: string,
  onProgress: NodeProgressCallback,
  options?: RunAnalysisOptions
): Promise<string> {
  const userPrompt = NODE_PROMPTS[node.id].replace('{content}', fullContent)
  let lastError: unknown

  for (let attempt = 1; attempt <= NODE_MAX_ATTEMPTS; attempt++) {
    const isRetry = attempt > 1
    try {
      onProgress({
        type: 'node_progress',
        nodeId: node.id,
        percent: 52,
        message: `${node.name} · 正在调用知识库${
          isRetry ? `（重试 ${attempt}/${NODE_MAX_ATTEMPTS}）` : ''
        }`
      })

      const start = Date.now()
      const result = await chatCompletion(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        {
          maxTokens: NODE_MAX_TOKENS,
          // 超时从 180s 提升到 360s：
          // 原因：standard/fast 模式下 content 截断 100K 字符 + system prompt + nodes.ts
          // prompt ≈ 10 万 token 输入，prefill 已耗 30-60s；若遇 provider 限流排队，
          // narrative 节点（输出 7500+ token）整体耗时 > 180s 触发硬超时。
          // ultra 模式已用 360s，节点级对齐此值兜底。
				 timeoutMs: 360000,
          userId: options?.userId,
          taskId: options?.taskId ?? undefined,
          scriptId: options?.scriptId,
          phase: 'analyze',
        }
      )

      const duration = Date.now() - start
      onProgress({
        type: 'node_progress',
        nodeId: node.id,
        percent: 82,
        message: `${node.name} · 正在整理模型返回结果`
      })

      onProgress({
        type: 'node_done',
        nodeId: node.id,
        nodeName: node.name,
        percent: 100,
        summary: result.slice(0, 200),
        message: `${node.name} · 完成（${(duration / 1000).toFixed(
          1
        )}s${isRetry ? `, 第 ${attempt} 次` : ''}）`
      })
      return result
    } catch (e) {
      lastError = e
      // 最后一次失败不再退避，直接抛
      if (attempt === NODE_MAX_ATTEMPTS) break
      // 准备重试：进度回退到 28，等待退避
      onProgress({
        type: 'node_progress',
        nodeId: node.id,
        percent: 28,
        message: `${node.name} · 上次失败（${
          e instanceof Error ? e.message : String(e)
        }），${NODE_RETRY_BACKOFF_MS / 1000}s 后重试`
      })
      await new Promise((r) => setTimeout(r, NODE_RETRY_BACKOFF_MS))
    }
  }

  // 全部尝试失败，发 node_error 后抛出
  onProgress({
    type: 'node_error',
    nodeId: node.id,
    message: `${node.name} 失败（已重试 ${NODE_MAX_ATTEMPTS} 次）：${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  })
  throw lastError
}

// =============================================================================
// standard 模式：原串行逻辑（行为零变更）
// =============================================================================

async function runStandardAnalysis(
  content: string,
  onProgress: NodeProgressCallback,
  taskId: string,
  options?: RunAnalysisOptions
): Promise<string> {
  const fullContent = content.slice(0, 100000)
  const totalNodes = ANALYSIS_NODES.length
  const systemPrompt = getCachedSystemPrompt(options?.userId)
  const nodeResults: Record<string, string> = {}

  for (let i = 0; i < ANALYSIS_NODES.length; i++) {
    const node = ANALYSIS_NODES[i]
    console.log(
      `[analyzer ${taskId}] standard node ${i + 1}/${totalNodes}: ${
        node.id
      }`
    )
    onProgress({
      type: 'node_start',
      nodeId: node.id,
      nodeName: node.name,
      message: `开始分析：${node.name}`
    })

    try {
      onProgress({
        type: 'node_progress',
        nodeId: node.id,
        percent: 12,
        message: `${node.name} · 正在整理输入内容`
      })
      onProgress({
        type: 'node_progress',
        nodeId: node.id,
        percent: 28,
        message: `${node.name} · 已构建分析提示词`
      })

      nodeResults[node.id] = await runOneNodeWithRetry(
        node,
        fullContent,
        systemPrompt,
        onProgress,
        options
      )
    } catch (e) {
      // runOneNodeWithRetry 已经发过 node_error，这里直接抛
      throw e
    }
  }

  return stitchReport(nodeResults)
}

// =============================================================================
// fast 模式：8 节点并行 + 限流（semaphore）
// =============================================================================
// 进度事件发射顺序：
//   - 启动时一次性发射 8 个 node_start（前端 8 张卡片同时进入 running）
//   - 每个节点内部仍按 12/28/52/82/100 顺序发射（不同节点之间交错）
//   - 整体进度由前端 calcOverallProgressFromEvents 计算（Math.max 累计，不依赖顺序）
// 失败语义：Promise.all 任一 reject → 整任务 reject（与 standard 一致）

async function runFastAnalysis(
  content: string,
  onProgress: NodeProgressCallback,
  taskId: string,
  options?: RunAnalysisOptions
): Promise<string> {
  const fullContent = content.slice(0, 100000)
  const systemPrompt = getCachedSystemPrompt(options?.userId)
  const nodeResults: Record<string, string> = {}

  console.log(
    `[analyzer ${taskId}] fast mode start, concurrency=${FAST_CONCURRENCY}`
  )

  // 启动信号：8 张卡片同时亮起
  for (const node of ANALYSIS_NODES) {
    onProgress({
      type: 'node_start',
      nodeId: node.id,
      nodeName: node.name,
      message: `开始分析：${node.name}`
    })
  }

  // 并行执行所有节点（限流 concurrency=2）
  await runWithConcurrency(FAST_CONCURRENCY, ANALYSIS_NODES, async (node) => {
    try {
      onProgress({
        type: 'node_progress',
        nodeId: node.id,
        percent: 12,
        message: `${node.name} · 正在整理输入内容`
      })
      onProgress({
        type: 'node_progress',
        nodeId: node.id,
        percent: 28,
        message: `${node.name} · 已构建分析提示词`
      })

      nodeResults[node.id] = await runOneNodeWithRetry(
        node,
        fullContent,
        systemPrompt,
        onProgress,
        options
      )
    } catch (e) {
      // runOneNodeWithRetry 已经发过 node_error，这里直接抛
      throw e
    }
  })

  return stitchReport(nodeResults)
}

// 手写 semaphore（避免引入 p-limit 依赖，YAGNI）
// 语义：N 个 worker 抢任务队列，任意时刻飞行数 ≤ concurrency
async function runWithConcurrency<T>(
  concurrency: number,
  items: readonly T[],
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) return
  const maxWorkers = Math.min(concurrency, items.length)
  let next = 0
  const workers = Array.from({ length: maxWorkers }, async () => {
    while (next < items.length) {
      const i = next++
      await fn(items[i], i)
    }
  })
  await Promise.all(workers)
}

// =============================================================================
// ultra 模式：单次调用合并所有节点
// =============================================================================
// 把 8 节点的 user prompt 拼成单次调用，输出整篇 8 节点 markdown
// 进度事件：仅发射 node_start（统一标记为运行中）+ 1 个汇总 node_progress + node_done
// 不走 stitchReport，直接头部 + 原文 + 免责声明

async function runUltraAnalysis(
  content: string,
  onProgress: NodeProgressCallback,
  taskId: string,
  options?: RunAnalysisOptions
): Promise<string> {
  const fullContent = content.slice(0, ULTRA_CONTENT_LIMIT)
  const systemPrompt = getCachedSystemPrompt(options?.userId)
  const ultraPromptTemplate = getUltraPrompt()
  const userPrompt = ultraPromptTemplate.replace('{content}', fullContent)

  console.log(
    `[analyzer ${taskId}] ultra mode start, contentLen=${fullContent.length} (limit=${ULTRA_CONTENT_LIMIT})`
  )

  // 8 张卡片统一进入 running（保持与 fast 一致的启动观感）
  for (const node of ANALYSIS_NODES) {
    onProgress({
      type: 'node_start',
      nodeId: node.id,
      nodeName: node.name,
      message: `开始分析：${node.name}`
    })
  }

  onProgress({
    type: 'node_progress',
    nodeId: 'overall',
    percent: 30,
    message: '极速模式 · 正在调用知识库生成完整报告'
  })

  const start = Date.now()
  try {
    const result = await chatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      {
        maxTokens: ULTRA_MAX_TOKENS,
        timeoutMs: 360000,
        userId: options?.userId,
        taskId: options?.taskId ?? undefined,
        scriptId: options?.scriptId,
        phase: 'analyze',
      }
    )

    const duration = Date.now() - start

    // 8 个节点一次性标记完成（基于整体输出，无法精确归因）
    for (const node of ANALYSIS_NODES) {
      onProgress({
        type: 'node_done',
        nodeId: node.id,
        nodeName: node.name,
        percent: 100,
        message: `${node.name} · 完成（ultra 整体 ${(
          duration / 1000
        ).toFixed(1)}s）`
      })
    }

    return stitchUltraReport(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // 8 个节点统一标记失败
    for (const node of ANALYSIS_NODES) {
      onProgress({
        type: 'node_error',
        nodeId: node.id,
        message: `${node.name} 失败（ultra）：${message}`
      })
    }
    throw e
  }
}

// =============================================================================
// 报告骨架（章节结构唯一权威来源）
// =============================================================================
// 报告的大结构（章节标题与层级）由这里固定，不信任 LLM 输出的标题层：
//   - 节点输出中的 h1-h3 标题行会被替换/降级，h4+ 维度行不动（不进 TOC）
//   - 管理员改 report_system 话术、LLM 自由发挥，均无法改变报告结构
// prelude:     注入到节点输出最前的容器壳标题（如 market 的「III. 详细分析」）
// headings:    节点输出中第 k 个 h1-h3 标题行 → 替换为 headings[k]
// keepExtraH3: 超出 headings 的 h3 保留原文（suggestion 的动态建议标题）

type NodeSkeleton = {
	prelude?: string[]
	headings: string[]
	keepExtraH3?: boolean
}

const NODE_SKELETON: Record<NodeId, NodeSkeleton> = {
  basic: { headings: ['## 封面信息', '## 基础信息', '### 角色场景特效表'] },
  overall: { headings: ['## I. 总体潜力评分'] },
  summary: { headings: ['## II. 执行摘要'] },
  market: {
    prelude: ['## III. 详细分析'],
    headings: ['### A. 市场共鸣与竞争定位']
  },
  // commercial 输出不带组标题：用户粘性/传播潜力两个 h4 维度直接续在 A 组下
  commercial: { headings: [] },
  narrative: { headings: ['### B. 叙事与剧本基因'] },
  compliance: { headings: ['### C. 合规性评估'] },
  suggestion: { headings: ['## IV. 综合可操作建议'], keepExtraH3: true }
}

const HEADING_LINE_RE = /^(#{1,3})\s+(.+?)\s*$/
// ultra 模式的「【模块 N】xxx」标记行视为标题行参与骨架映射
const MODULE_MARK_RE = /^【模块\s*\d+】\s*(.+?)\s*$/
// ultra 模式的模块 h2 标题（如「## 1. 基础信息提取（basic）」）
const ULTRA_MODULE_RE = new RegExp(
  `^#{1,2}\\s+.*[（(](${ANALYSIS_NODES.map((n) => n.id).join('|')})[）)]`
)

// 单节点输出按骨架规范化：标题层替换为固定标题，骨架外标题降级为粗体正文
export function normalizeNodeOutput(nodeId: NodeId, raw: string): string {
  const skeleton = NODE_SKELETON[nodeId]
  if (!skeleton || !raw.trim()) return raw

  // 预处理：【模块 N】标记行若下一非空行已是标题行，删除标记行避免重复计数
  //（ultra 的 basic 段【模块】行后无标题行、正常参与映射；standard 不要求输出该标记，
  // LLM 残留输出时其后紧跟 ## 标题，去重后不会错位）
  const pre = raw.split('\n')
  const lines = pre.filter((line, i) => {
    if (!MODULE_MARK_RE.test(line)) return true
    for (let j = i + 1; j < pre.length; j++) {
      if (!pre[j]!.trim()) continue
      return !HEADING_LINE_RE.test(pre[j]!)
    }
    return true
  })
  const out: string[] = []
  let headingIdx = 0
  let firstHeadingAt = -1

  for (const line of lines) {
    const moduleMark = line.match(MODULE_MARK_RE)
    const heading = line.match(HEADING_LINE_RE)
    if (!moduleMark && !heading) {
      out.push(line)
      continue
    }
    if (firstHeadingAt === -1) firstHeadingAt = out.length
    const k = headingIdx++
    if (k < skeleton.headings.length) {
      out.push(skeleton.headings[k])
    } else if (skeleton.keepExtraH3 && heading?.[1] === '###') {
      out.push(line)
    } else {
      // 骨架外的多余标题降级为粗体正文（保留内容，不进 TOC）
      const text = moduleMark ? moduleMark[1] : heading![2]
      out.push(`**${text}**`)
    }
  }

  if (headingIdx < skeleton.headings.length) {
    console.warn(
      `[analyzer] skeleton headings not consumed: node=${nodeId} got=${headingIdx} expect=${skeleton.headings.length}`
    )
  }

  // 输出完全没有标题行时补首个骨架标题，避免内容悬空无章节
  //（headings 为空的节点如 commercial 无标题可补，原样返回）
  if (firstHeadingAt === -1) {
    if (skeleton.headings.length === 0) return out.join('\n')
    return [...(skeleton.prelude ?? []), skeleton.headings[0], '', ...out]
      .join('\n')
      .trimEnd()
  }
  // prelude 容器壳插在第一个标题之前
  if (skeleton.prelude) {
    out.splice(firstHeadingAt, 0, ...skeleton.prelude)
  }
  return out.join('\n')
}

// ultra 整篇输出规范化：按模块 h2 切段 → 每段走 normalizeNodeOutput
// 模块外的开头声明/结尾杂项原样保留；切不到模块标题时原样返回（不破坏）
function normalizeUltraReport(raw: string): string {
  const segments: Array<{ nodeId: NodeId | null; body: string[] }> = []
  let current: { nodeId: NodeId | null; body: string[] } = {
    nodeId: null,
    body: []
  }
  for (const line of raw.split('\n')) {
    const m = line.match(ULTRA_MODULE_RE)
    if (m) {
      segments.push(current)
      current = { nodeId: m[1] as NodeId, body: [] }
    } else {
      current.body.push(line)
    }
  }
  segments.push(current)

  if (!segments.some((s) => s.nodeId)) {
    console.warn('[analyzer] ultra normalize: no module headings found, keep raw')
    return raw
  }

  const parts: string[] = []
  for (const seg of segments) {
    const text = seg.body.join('\n').trim()
    if (!seg.nodeId) {
      if (text) parts.push(text)
      continue
    }
    parts.push(normalizeNodeOutput(seg.nodeId, text))
  }
  return parts.join('\n\n')
}

// 报告拼接（standard / fast 用：按节点顺序拼接 + 骨架规范化 + 头尾包装）
export function stitchReport(nodeResults: Record<string, string>): string {
  const order = ANALYSIS_NODES.map((n) => n.id)
  const parts: string[] = []

  parts.push('# 《短剧商业潜力评估报告》')
  parts.push('')
  parts.push('> AI智能诊断｜商业适配度·结构风险·变现潜力')
  parts.push('')

  for (const id of order) {
    const text = nodeResults[id]
    if (text) {
      parts.push(normalizeNodeOutput(id, text))
      parts.push('')
    }
  }

  parts.push('---')
  parts.push('')
  parts.push(
    '*本报告由 AI 生成，仅供创作参考。结论可能存在偏差，请结合专业判断使用。*'
  )

  return parts.join('\n')
}

// ultra 报告拼接（单次输出已是完整 markdown，骨架规范化后加头尾）
export function stitchUltraReport(rawOutput: string): string {
  const parts: string[] = []
  parts.push('# 《短剧商业潜力评估报告》')
  parts.push('')
  parts.push('> AI智能诊断｜商业适配度·结构风险·变现潜力')
  parts.push('')
  parts.push(normalizeUltraReport(rawOutput.trim()))
  parts.push('')
  parts.push('---')
  parts.push('')
  parts.push(
    '*本报告由 AI 生成，仅供创作参考。结论可能存在偏差，请结合专业判断使用。*'
  )
  return parts.join('\n')
}
