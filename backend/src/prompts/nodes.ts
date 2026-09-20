// 8 节点 prompt 模板（占位版）
// 每个节点对应一个用户 prompt，{content} 占位符由 analyzer 替换为剧本正文
// 注意：报告章节结构由 analyzer 的 NODE_SKELETON 强制重建，
//   模板中的标题行是给 LLM 的输出指引，最终标题以骨架为准
//
// 开源版不附带业务话术：以下 value 为占位模板，请按节点含义自行编写完整指令。
// key 与 analyzer 的节点 id 强绑定，不可增删改名。

const nodePlaceholder = (section: string) =>
  `请基于以下素材，输出【${section}】模块。\n\n素材：\n{content}`

export const NODE_PROMPTS: Record<string, string> = {
  basic: nodePlaceholder('封面信息 + 基础信息 + 角色场景特效表'),
  overall: nodePlaceholder('I. 总体潜力评分'),
  summary: nodePlaceholder('II. 执行摘要'),
  market: nodePlaceholder('III. 详细分析 · A. 市场共鸣与竞争定位（前三个维度）'),
  commercial: nodePlaceholder('A 组后两个维度：用户粘性与传播潜力'),
  narrative: nodePlaceholder('III. 详细分析 · B. 叙事与剧本基因'),
  compliance: nodePlaceholder('III. 详细分析 · C. 合规性评估'),
  // suggestion 节点基于前序节点的多轮上下文，无需附带素材正文
  suggestion: '请基于以上全部分析内容，输出【IV. 综合可操作建议】模块。',
}
