// 积分规则展示映射（运营视角）
// -----------------------------------------------------------------------------
// code 是后端业务侧的查找键，不应让运营理解。这里维护 code → 中文业务说明 的映射，
// 作为规则卡片「用途说明」的 fallback——管理员在规则上自填的 description 优先生效，
// 未填写时才显示此处的内置文案。新增 code 时可在此补充默认说明。
// =============================================================================

export interface CreditRuleDisplay {
	/** 中文分组名（用于按业务模块归类展示） */
	group: string;
	/** 业务说明：告诉运营这条规则对应用户的什么动作 */
	description: string;
	/** 建议扣费范围或运营提示（可选） */
	suggestion?: string;
}

const RULE_DISPLAY: Record<string, CreditRuleDisplay> = {
	'analyze.standard': {
		group: '剧本分析',
		description: '用户上传剧本后做完整分析时扣费',
		suggestion: '展会场景统一价 2000',
	},
	'cover.default': {
		group: '封面生成',
		description: '生成封面图（每次 3 张）时扣费',
	},
};

const DEFAULT_DISPLAY: CreditRuleDisplay = {
	group: '其他',
	description: '该规则对应一个业务动作',
};

const GROUP_ORDER = ['剧本分析', '封面生成', '其他'];

// 常用业务动作预设（code 由后端 resolveRuleCode 固定查找，创建规则时必须与之一致才生效）
// analyze.fast / analyze.ultra 已废弃（分析统一走 analyze.standard），不提供预设
export interface PresetRuleCode {
	code: string;
	label: string;
	name: string;
}

export const PRESET_RULE_CODES: PresetRuleCode[] = [
	{ code: 'analyze.standard', label: '剧本分析', name: '剧本分析' },
	{ code: 'cover.default', label: '封面生成', name: '封面生成（一次 3 张）' },
];

// 临时隐藏的规则 code：不出现在管理列表（数据保留，扣费行为不受影响）
// 恢复展示：从集合中移除对应 code 即可
export const HIDDEN_RULE_CODES = new Set<string>();

/** 取某 code 的展示信息，未配置时返回默认 */
export function getRuleDisplay(code: string): CreditRuleDisplay {
	return RULE_DISPLAY[code] ?? DEFAULT_DISPLAY;
}

/** 将规则按业务分组排序（隐藏名单中的规则不展示） */
export function groupRulesByBusiness<T extends { code: string }>(rules: T[]) {
	const map = new Map<string, T[]>();
	for (const r of rules) {
		if (HIDDEN_RULE_CODES.has(r.code)) continue;
		const g = getRuleDisplay(r.code).group;
		if (!map.has(g)) map.set(g, []);
		map.get(g)!.push(r);
	}
	return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({
		group: g,
		items: map.get(g)!,
	}));
}
