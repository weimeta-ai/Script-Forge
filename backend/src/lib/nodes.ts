// 8 节点定义（从 p00/lib/nodes-shared.ts 移植）
// 客户端和服务端共用，前端进度页用此常量渲染节点卡片骨架

export const ANALYSIS_NODES = [
  {
    id: 'basic',
    name: '基础信息提取',
    en: 'Basic Information',
    desc: '识别剧本名称、类型、格式与制作难度',
    icon: '01',
  },
  {
    id: 'overall',
    name: '总体潜力评估',
    en: 'Overall Potential',
    desc: '综合爆款指数、优势、风险与推进建议',
    icon: '02',
  },
  {
    id: 'summary',
    name: '执行摘要',
    en: 'Executive Summary',
    desc: '一句话卖点、剧情主线与核心结论',
    icon: '03',
  },
  {
    id: 'market',
    name: '市场共鸣与竞争定位',
    en: 'Market & Competition',
    desc: '目标受众、原创性、当下热播契合度',
    icon: '04',
  },
  {
    id: 'commercial',
    name: '商业化潜力',
    en: 'Commercial Potential',
    desc: '用户粘性与传播潜力',
    icon: '05',
  },
  {
    id: 'narrative',
    name: '叙事与剧本基因',
    en: 'Narrative DNA',
    desc: '叙事逻辑、钩子、爽点、节奏、人物、对白、悬念',
    icon: '06',
  },
  {
    id: 'compliance',
    name: '合规性评估',
    en: 'Compliance',
    desc: '内容合规与价值观导向',
    icon: '07',
  },
  {
    id: 'suggestion',
    name: '综合优化建议',
    en: 'Optimization',
    desc: '可落地的修改建议',
    icon: '08',
  },
] as const

export type AnalysisNode = (typeof ANALYSIS_NODES)[number]
export type NodeId = AnalysisNode['id']
