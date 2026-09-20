// =============================================================================
// PDF 生成服务（puppeteer + markdown-it）
// -----------------------------------------------------------------------------
// 职责：把剧本报告数据渲染成 HTML → 无头 Chromium 输出 PDF Buffer
//
// 设计要点：
//   - 单例浏览器：首次调用 fork，后续复用，避免每次 2-5s 启动开销
//   - 内联 CSS：不依赖外部样式文件，PDF 离线自包含
//   - 朱砂主题：与前端 Report.tsx 视觉系统一致（主色 #B8443C）
//   - A4 纸张：标准打印尺寸，含页边距
//   - executablePath 策略：优先环境变量 → 系统已装 Chrome → puppeteer 自带
//     本机零下载复用 macOS Chrome；生产环境通过 PUPPETEER_EXECUTABLE_PATH 配置
// =============================================================================
import { existsSync } from 'node:fs'
import puppeteer, { type Browser } from 'puppeteer'
import MarkdownIt from 'markdown-it'

// Chrome 可执行文件解析顺序：环境变量 > macOS > Linux 常见路径 > puppeteer 默认
const executablePath =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // macOS
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find((p): p is string => existsSync(p))

// 单例浏览器实例（懒加载，避免冷启动占用资源）
let browserPromise: Promise<Browser> | null = null

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    })
  }
  return browserPromise
}

// markdown-it 实例（关闭原始 HTML，开启链接自动识别 + 排版优化）
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
})

// 与前端 src/lib/report-md.ts 保持一致：剥离 LLM 自带的报告大标题、AI 智能诊断引用、免责声明
// 避免与 PDF 模板的 hero-subtitle 和 disclaimer 区域重复
function normalizeReportMarkdown(raw: string): string {
  return raw
    .replace(/^#\s*[《〈<]?短剧商业潜力评估报告[》〉>]?\s*\n+/gim, '')
    .replace(/^>\s*AI智能诊断[^\n]*\n+/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function stripDisclaimerHtml(html: string): string {
  return html.replace(
    /<p>\s*<em>\s*本报告由\s*AI[^<]*?(仅供参考|结合专业|生成)[^<]*?<\/em>\s*<\/p>/gi,
    '',
  )
}

export interface PdfInput {
  title: string
  genre?: string | null
  coverUrl?: string | null
  score?: number
  grade?: string
  durationMs?: number
  fileName?: string | null
  wordCount: number
  versionId: string
  reportMarkdown: string
}

// 主入口：渲染 PDF Buffer
export async function renderReportPdf(input: PdfInput): Promise<Buffer> {
  const html = buildHtml(input)
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    // networkidle0：等所有网络请求结束（封面图加载完成）
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 })
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '16mm', right: '16mm' },
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}

// =============================================================================
// HTML 模板构建（对齐前端 Report.tsx 视觉：朱砂主题 + Hero + 评分卡 + MetaCard）
// =============================================================================

// Hero 区固定副标题（用户指定）
const HERO_SUBTITLE = 'AI 智能诊断·商业适配度·结构风险·变现潜力'

// 评级颜色映射（与前端 lib/report-md.ts gradeColor 一致）
function gradeColor(grade?: string | null): string {
  if (!grade) return '#B8443C'
  if (grade.startsWith('B')) return '#7F6B5B'
  return '#B8443C'
}

function buildHtml(input: PdfInput): string {
  const {
    title,
    coverUrl,
    score,
    grade,
    durationMs,
    fileName,
    versionId,
    reportMarkdown,
  } = input

  const durationSec = durationMs ? (durationMs / 1000).toFixed(1) : null
  const reportHtml = stripDisclaimerHtml(md.render(normalizeReportMarkdown(reportMarkdown)))
  const color = gradeColor(grade)
  const gradeInitial = (grade || 'A').charAt(0)

  // 封面卡（仅当 coverUrl 存在，对齐 Report.tsx 左侧 240px 列）
  const coverCard = coverUrl
    ? `<div class="cover-card"><img src="${escapeAttr(coverUrl)}" alt="${escapeAttr(title)}" /></div>`
    : ''

  // 评分卡（仅当 score > 0 显示，结构与 Report.tsx 一致）
  const scoreCard =
    score !== undefined && score > 0
      ? `<div class="score-card" style="border-color:${color}22;">
          <span class="score-card-bar" style="background:linear-gradient(90deg, ${color} 0%, ${color}88 60%, transparent 100%);"></span>
          <span class="score-card-watermark" style="color:${color}0D;">${escapeHtml(gradeInitial)}</span>
          <div class="score-card-left">
            <div class="score-card-label">综合评分</div>
            <div class="score-card-main">
              <span class="score-card-num" style="color:${color};text-shadow:0 2px 0 ${color}10;">${score}</span>
              <span class="score-card-suffix">/ 100</span>
            </div>
          </div>
          <div class="score-card-right">
            <div class="grade-badge" style="color:${color};border-color:${color}40;background:${color}12;box-shadow:0 1px 0 ${color}10 inset;">
              <span class="grade-badge-dot" style="background:${color};box-shadow:0 0 0 3px ${color}25;"></span>
              <span class="grade-badge-text">${escapeHtml(grade || '未评级')}</span>
            </div>
            <div class="grade-badge-sub">商业潜力等级</div>
          </div>
        </div>`
      : ''

  // MetaCard 4 列（剧本名称 / 分析耗时 / 结果等级 / 报告 ID）
  const metaItems: Array<[string, string]> = [
    ['剧本名称', escapeHtml(fileName || `${title}.txt`)],
    ['分析耗时', durationSec ? `${durationSec}s` : '—'],
    ['结果等级', escapeHtml(grade || '未评级')],
    ['报告 ID', escapeHtml(versionId.slice(0, 8))],
  ]
  const metaGrid = `<div class="meta-grid">${metaItems
    .map(
      ([k, v]) =>
        `<div class="meta-card"><div class="meta-card-label">${k}</div><div class="meta-card-value">${v}</div></div>`,
    )
    .join('')}</div>`

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)} · 短剧商业潜力评估报告</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      font-family: "Noto Serif SC", "Source Han Serif SC", Georgia, serif;
      color: #1C1815;
      line-height: 1.7;
      font-size: 14px;
      background: #FFFBF5;
    }

    /* ===== 唯元剧创水印（fixed：每页重复，斜向平铺） ===== */
    .watermark-layer {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      pointer-events: none;
      z-index: 9999;
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      grid-template-rows: repeat(4, 1fr);
    }
    .watermark-cell {
      display: flex; align-items: center; justify-content: center;
      transform: rotate(-28deg);
    }
    .watermark-cell span {
      font-family: "Noto Serif SC", serif;
      font-size: 38px; font-weight: 700;
      letter-spacing: 0.18em;
      color: rgba(184, 68, 60, 0.06);
      white-space: nowrap; user-select: none;
    }
    .brand-corner {
      position: fixed; right: 12mm; bottom: 8mm;
      font-family: ui-monospace, monospace;
      font-size: 9px; letter-spacing: 0.2em;
      color: rgba(102, 89, 76, 0.55);
      pointer-events: none; z-index: 9999;
    }

    /* Hero 行：左封面 + 右文字（对齐 Report.tsx grid 240px + 1fr） */
    .hero-row {
      display: grid;
      grid-template-columns: 200px minmax(0, 1fr);
      gap: 28px;
      margin-bottom: 24px;
    }
    .hero-row.no-cover { grid-template-columns: minmax(0, 1fr); }
    .hero-info {
      display: flex; flex-direction: column;
      gap: 20px; min-width: 0;
    }
    /* 封面卡（3:4 长宽比，对齐 Report.tsx aspectRatio: 3/4） */
    .cover-card {
      width: 100%;
      aspect-ratio: 3 / 4;
      border: 1px solid rgba(102,89,76,0.16);
      border-radius: 14px;
      overflow: hidden;
      background: linear-gradient(135deg, rgba(102,89,76,0.08) 0%, rgba(184,68,60,0.05) 100%);
      box-shadow: 0 6px 18px rgba(102,89,76,0.08);
    }
    .cover-card img {
      width: 100%; height: 100%;
      object-fit: cover; display: block;
    }

    /* Hero 区（对齐 Report.tsx panel-paper） */
    .hero {
      padding: 32px 36px;
      border-bottom: 1px solid rgba(102,89,76,0.10);
      margin-bottom: 24px;
    }
    .hero-eyebrow {
      font-family: ui-monospace, monospace;
      font-size: 10px; letter-spacing: 0.2em;
      color: #8B7B6A; text-transform: uppercase;
      margin-bottom: 12px;
    }
    .hero-title {
      font-size: 38px; font-weight: 700;
      letter-spacing: -0.02em; line-height: 1.1;
      margin: 0 0 10px 0; color: #1C1815;
    }
    .hero-subtitle {
      font-family: "Noto Serif SC", serif;
      font-size: 20px; color: #B8443C;
      margin-bottom: 6px;
    }
    .hero-tags {
      font-family: ui-monospace, monospace;
      font-size: 11px; color: #8B7B6A;
      letter-spacing: 0.06em;
      margin-bottom: 10px;
    }
    .hero-desc {
      font-family: -apple-system, "PingFang SC", sans-serif;
      font-size: 13px; color: #66594C;
      line-height: 1.8;
    }

    /* 评分卡（对齐 Report.tsx score-card） */
    .score-card {
      position: relative;
      width: 100%;
      padding: 22px 26px;
      border-radius: 22px;
      background: linear-gradient(160deg, rgba(255,255,255,0.94) 0%, rgba(255,250,246,0.78) 100%);
      border: 1px solid #B8443C22;
      box-shadow: 0 12px 32px rgba(102,89,76,0.08), 0 1px 0 rgba(255,255,255,0.6) inset;
      overflow: hidden;
      display: flex; align-items: center; justify-content: space-between;
      gap: 24px;
    }
    .score-card-bar {
      position: absolute; top: 0; left: 0; right: 0; height: 3px;
    }
    .score-card-watermark {
      position: absolute; right: -18px; bottom: -34px;
      font-family: "Noto Serif SC", Georgia, serif;
      font-size: 160px; font-weight: 800; line-height: 1;
      letter-spacing: -0.08em;
      pointer-events: none; user-select: none; z-index: 0;
    }
    .score-card-left { position: relative; z-index: 1; }
    .score-card-label {
      font-family: ui-monospace, monospace;
      font-size: 11px; text-transform: uppercase;
      color: #8B7B6A; letter-spacing: 0.18em;
      font-weight: 600; margin-bottom: 8px;
    }
    .score-card-main { display: flex; align-items: flex-end; gap: 6px; }
    .score-card-num {
      font-family: ui-monospace, "JetBrains Mono", monospace;
      font-size: 68px; font-weight: 700; line-height: 1;
      letter-spacing: -0.06em;
      font-variant-numeric: tabular-nums;
    }
    .score-card-suffix {
      padding-bottom: 10px;
      font-family: -apple-system, "PingFang SC", sans-serif;
      color: #A89A8A; font-size: 15px; font-weight: 500;
      letter-spacing: 0.02em;
    }
    .score-card-right {
      position: relative; z-index: 1;
      display: flex; flex-direction: column;
      align-items: flex-end; gap: 8px;
    }
    .grade-badge {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 16px 8px 12px;
      border-radius: 999px;
      border: 1px solid;
    }
    .grade-badge-dot {
      width: 8px; height: 8px; border-radius: 50%;
    }
    .grade-badge-text {
      font-family: "Noto Serif SC", serif;
      font-size: 22px; font-weight: 700;
      letter-spacing: 0.02em;
    }
    .grade-badge-sub {
      font-family: -apple-system, "PingFang SC", sans-serif;
      font-size: 11px; color: #8B7B6A;
      letter-spacing: 0.04em;
    }

    /* MetaCard 4 列（对齐 Report.tsx MetaCard） */
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-top: 22px;
    }
    .meta-card {
      padding: 14px 16px;
      border-radius: 14px;
      background: rgba(255,255,255,0.72);
      border: 1px solid rgba(102,89,76,0.08);
    }
    .meta-card-label {
      font-family: -apple-system, "PingFang SC", sans-serif;
      font-size: 11px; color: #8B7B6A;
      margin-bottom: 8px;
    }
    .meta-card-value {
      font-family: -apple-system, "PingFang SC", sans-serif;
      font-size: 14px; color: #1C1815;
      line-height: 1.6; word-break: break-word;
    }

    /* 报告正文（markdown-it 输出） */
    .report-body { padding: 2mm 0; position: relative; z-index: 1; }
    .report-body h1 {
      font-size: 22px; margin: 28px 0 14px;
      padding-bottom: 8px; border-bottom: 1px solid #e3d7c5;
      color: #1C1815; letter-spacing: -0.01em;
    }
    .report-body h2 {
      font-size: 18px; margin: 24px 0 12px;
      color: #B8443C; padding-left: 10px;
      border-left: 3px solid #B8443C;
    }
    .report-body h3 {
      font-size: 16px; margin: 20px 0 10px;
      color: #1C1815; font-weight: 700;
    }
    .report-body p {
      margin: 11px 0; text-align: justify; color: #2A2520;
    }
    .report-body ul, .report-body ol {
      padding-left: 24px; margin: 11px 0;
    }
    .report-body li { margin: 6px 0; color: #2A2520; }
    .report-body blockquote {
      border-left: 3px solid #B8443C;
      padding: 10px 16px; margin: 14px 0;
      background: rgba(184,68,60,0.04);
      color: #66594C; font-style: italic;
      border-radius: 0 6px 6px 0;
    }
    .report-body code {
      font-family: ui-monospace, monospace;
      font-size: 12.5px; padding: 2px 6px;
      background: rgba(102,89,76,0.08); border-radius: 3px;
    }
    .report-body pre {
      background: #f7f2e8; padding: 14px 16px;
      border-radius: 8px; overflow-x: auto;
      font-size: 12.5px; line-height: 1.55;
      border: 1px solid #ede2cd;
    }
    .report-body pre code { background: transparent; padding: 0; }
    .report-body table {
      width: 100%; border-collapse: collapse;
      margin: 14px 0; font-size: 12.5px;
      border-radius: 6px; overflow: hidden;
    }
    .report-body th, .report-body td {
      border: 1px solid #e3d7c5; padding: 8px 12px; text-align: left;
    }
    .report-body th {
      background: rgba(184,68,60,0.08);
      font-weight: 700; color: #1C1815;
    }
    .report-body tr:nth-child(even) td {
      background: rgba(102,89,76,0.03);
    }
    .report-body strong { color: #1C1815; font-weight: 700; }
    .report-body a {
      color: #B8443C; text-decoration: none;
      border-bottom: 1px dashed #B8443C;
    }
    .report-body hr {
      border: none; border-top: 1px dashed #e3d7c5; margin: 24px 0;
    }

    /* 免责声明页脚（对齐 Report.tsx 底部） */
    .disclaimer {
      margin-top: 32px;
      padding: 16px 20px;
      border-radius: 16px;
      text-align: center;
      border: 1px solid rgba(184,68,60,0.14);
      background: rgba(184,68,60,0.04);
    }
    .disclaimer p {
      font-family: "Noto Serif SC", serif;
      font-style: italic;
      color: #B8443C; font-size: 14px;
      margin: 0;
    }

    /* 分页控制：标题避免出现在页底，评分卡/表格避免跨页切割 */
    h1, h2, h3 { page-break-after: avoid; break-after: avoid; }
    pre, table, blockquote, img { page-break-inside: avoid; break-inside: avoid; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    .score-card, .meta-card, .disclaimer { page-break-inside: avoid; break-inside: avoid; }
  </style>
</head>
<body>
  <div class="watermark-layer" aria-hidden="true">
    ${Array.from({ length: 8 })
      .map(() => '<div class="watermark-cell"><span>唯元剧创</span></div>')
      .join('')}
  </div>
  <div class="brand-corner">唯元剧创 · WEIYUAN</div>

  <section class="hero">
    <div class="hero-row ${coverUrl ? '' : 'no-cover'}">
      ${coverCard}
      <div class="hero-info">
        <div>
          <div class="hero-eyebrow">报告输出</div>
          <h1 class="hero-title">${escapeHtml(title)}</h1>
          <div class="hero-subtitle">短剧商业潜力评估报告</div>
          <div class="hero-tags">${escapeHtml(HERO_SUBTITLE)}</div>
          <div class="hero-desc">由高阶算法生成，包含总体评分、结构判断、市场定位与可执行优化建议。</div>
        </div>
        ${scoreCard}
      </div>
    </div>
    ${metaGrid}
  </section>

  <article class="report-body">
    ${reportHtml}
  </article>

  <div class="disclaimer">
    <p>本报告由 AI 生成，仅供创作参考。结论可能存在偏差，请结合专业判断使用。</p>
  </div>
</body>
</html>`
}

// HTML 转义（用于文本节点）
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// 属性值转义（用于属性引号内）
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
}
