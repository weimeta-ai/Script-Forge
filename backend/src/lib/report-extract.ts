// 报告元数据抽取（多策略容错版）
// -----------------------------------------------------------------------------
// 设计原则：解析端不依赖 prompt 端格式约束。
// 原因：report_system prompt 允许管理员后台可视化编辑，管理员无法感知后端
// 正则规则。若解析端依赖特定加粗/标点/关键词写法，管理员一改格式就会导致
// score/grade 解析失败，进而触发 History 卡片误判为"待分析"。
//
// 方案：多策略降级 + 容错维度，覆盖加粗/标点/关键词的各种合理变体。
// 接口签名保持不变，worker 调用处无需改动。
// =============================================================================

// 总分关键词（管理员可能用任一变体，中英文均兼容）
const SCORE_KEYWORDS =
  '总体潜力评分|总体评分|综合评分|总评分|总分|潜力评分|Overall\\s+Score|Total\\s+Score|Overall\\s+Rating|Potential\\s+Score|Final\\s+Score'

// 分数 + 等级核心模式
// 容错维度：
//   - 加粗 *{0,2} 可选（兼容「整段加粗」「仅数字加粗」「无加粗」三种写法）
//   - 「85/100」与「85 out of 100」两种写法
//   - 括号 [（(]...[）)] 中英兼容
//   - 等级 (S|A+|A|B|C|D) 大小写不敏感，后缀兼容「级/Grade/Class/Tier」
//   - 空白 \s* 任意
const SCORE_PATTERN =
  /(\d{1,3})\s*(?:\/|\s+out\s+of\s+)\s*100\s*\*{0,2}\s*[（(]\s*(S|A\+|A|B|C|D)\s*(?:级|Grade|Class|Tier)?\s*[）)]\s*\*{0,2}/i

// 「剧本名称：xxx」/「Script Name: xxx」行匹配
// 容错维度：行首缩进/列表符号/加粗星号/书名号，中英文标签
const NAME_LINE_PATTERN =
  /^[ \t-]*\*{0,2}[ \t]*(?:剧本名称|Script\s+Name|Script\s+Title|Title)[ \t]*\*{0,2}[ \t]*[：:]\s*(.+)/m

// 清理标题值：去加粗星号、去书名号、去首尾空白，过滤占位符
function normalizeName(raw: string): string | null {
  const name = raw
    .trim()
    .replace(/^\*+/, '')
    .replace(/\*+$/, '')
    .replace(/^《/, '')
    .replace(/》$/, '')
    .trim()
  if (
    !name ||
    ['未明确', '未命名', 'N/A', 'Unknown', 'Untitled', 'TBD'].includes(name)
  ) {
    return null
  }
  return name
}

// 从指定标题块内取首个分数
// 块范围：从 sectionPattern 匹配位置到下一个 ##/###/#### 标题
function findScoreInSection(
  md: string,
  sectionPattern: RegExp,
): { score: number; grade: string } | null {
  const sectionMatch = md.match(sectionPattern)
  if (!sectionMatch || sectionMatch.index === undefined) return null
  const rest = md.slice(sectionMatch.index + sectionMatch[0].length)
  const nextHeading = rest.match(/^#{2,4}\s/m)
  const block =
    nextHeading && nextHeading.index !== undefined
      ? rest.slice(0, nextHeading.index)
      : rest
  const scoreMatch = block.match(SCORE_PATTERN)
  return scoreMatch
    ? { score: parseInt(scoreMatch[1], 10), grade: scoreMatch[2].toUpperCase() }
    : null
}

// 从指定标题块内取「剧本名称」值
function findNameInSection(md: string, sectionPattern: RegExp): string | null {
  const sectionMatch = md.match(sectionPattern)
  if (!sectionMatch || sectionMatch.index === undefined) return null
  const rest = md.slice(sectionMatch.index + sectionMatch[0].length)
  const nextHeading = rest.match(/^#{2,4}\s/m)
  const block =
    nextHeading && nextHeading.index !== undefined
      ? rest.slice(0, nextHeading.index)
      : rest
  const nameMatch = block.match(NAME_LINE_PATTERN)
  if (nameMatch) return normalizeName(nameMatch[1])
  return null
}

// 从报告内容中提取标题（多策略降级，不依赖管理员 prompt 格式）
// 优先级：封面信息块 → 基础信息块 → 全文首个「剧本名称/Title」行 → H1《xxx》 → 兜底
export function extractTitleFromMarkdown(
  md: string,
  fallback = '未命名剧本',
): string {
  // 策略 1：封面信息块内的「剧本名称/Script Name」
  const coverName = findNameInSection(
    md,
    /^#{2,4}\s*.*(?:封面|Cover\s*Info).*/im,
  )
  if (coverName) return coverName

  // 策略 2：基础信息块内的「剧本名称/Basic Information」
  const basicName = findNameInSection(
    md,
    /^#{2,4}\s*.*(?:基础信息|Basic\s*(?:Info|Information)).*/im,
  )
  if (basicName) return basicName

  // 策略 3：全文首个「剧本名称」行
  const anyMatch = md.match(NAME_LINE_PATTERN)
  if (anyMatch) {
    const name = normalizeName(anyMatch[1])
    if (name) return name
  }

  // 策略 4：H1 《xxx》
  const h1 = md.match(/^#\s+《([^》]+)》/m)
  if (h1) return h1[1].trim()

  return fallback
}

// 从报告内容中提取评分与评级（多策略降级，不依赖管理员 prompt 格式）
// 优先级：总分关键词标题块 → 总分关键词行 → 封面信息块 → 全局首个分数
export function extractScoreFromMarkdown(
  md: string,
): { score: number; grade: string } | null {
  // 策略 1：含总分关键词的标题块内取首个分数（最精确）
  const sectionScore = findScoreInSection(
    md,
    new RegExp(`^#{2,4}\\s+.*(?:${SCORE_KEYWORDS}).*$`, 'im'),
  )
  if (sectionScore) return sectionScore

  // 策略 2：含总分关键词的行内取分数（兼容无标题或标题不含关键词的场景）
  const lineRegex = new RegExp(`(?:${SCORE_KEYWORDS})`, 'i')
  for (const line of md.split('\n')) {
    if (lineRegex.test(line)) {
      const scoreMatch = line.match(SCORE_PATTERN)
      if (scoreMatch) {
        return { score: parseInt(scoreMatch[1], 10), grade: scoreMatch[2].toUpperCase() }
      }
    }
  }

  // 策略 3：封面信息块内取首个分数（兼容旧 prompt 封面带总分格式）
  const coverScore = findScoreInSection(
    md,
    /^#{2,4}\s*.*(?:封面|Cover\s*Info).*/im,
  )
  if (coverScore) return coverScore

  // 策略 4：全局首个分数（最后兜底，极端情况，有误匹配风险但保证可解析）
  const globalMatch = md.match(SCORE_PATTERN)
  if (globalMatch) {
    return { score: parseInt(globalMatch[1], 10), grade: globalMatch[2].toUpperCase() }
  }

  return null
}
