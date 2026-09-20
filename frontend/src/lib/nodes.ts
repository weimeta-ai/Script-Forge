// 8 节点定义（与后端 src/lib/nodes.ts 同步）
// 客户端用此常量渲染分析进度页的节点卡片骨架

export interface AnalysisNode {
	id: string;
	name: string;
	en: string;
	desc: string;
	icon: string;
}

export const ANALYSIS_NODES: AnalysisNode[] = [
	{
		id: 'basic',
		name: '基础信息提取',
		en: '基础档案',
		desc: '识别剧本名称、类型、格式与制作难度',
		icon: '01',
	},
	{
		id: 'overall',
		name: '总体潜力评估',
		en: '综合评估',
		desc: '综合爆款指数、优势、风险与推进建议',
		icon: '02',
	},
	{
		id: 'summary',
		name: '执行摘要',
		en: '执行概述',
		desc: '一句话卖点、剧情主线与核心结论',
		icon: '03',
	},
	{
		id: 'market',
		name: '市场共鸣与竞争定位',
		en: '市场定位',
		desc: '目标受众、原创性、当下热播契合度',
		icon: '04',
	},
	{
		id: 'commercial',
		name: '商业化潜力',
		en: '商业潜力',
		desc: '用户粘性与传播潜力',
		icon: '05',
	},
	{
		id: 'narrative',
		name: '叙事与剧本基因',
		en: '叙事分析',
		desc: '叙事逻辑、钩子、爽点、节奏、人物、对白、悬念',
		icon: '06',
	},
	{
		id: 'compliance',
		name: '合规性评估',
		en: '合规审查',
		desc: '内容合规与价值观导向',
		icon: '07',
	},
	{
		id: 'suggestion',
		name: '综合优化建议',
		en: '优化建议',
		desc: '可落地的修改建议',
		icon: '08',
	},
];
