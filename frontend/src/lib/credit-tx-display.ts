// 流水类型展示映射工具
// -----------------------------------------------------------------------------
// 后端 type 字段是技术语义（recharge/consume/refund/deduct/compensate/lock/unlock），
// 前端需映射为业务展示文案 + 颜色方向：
//   recharge   -> 后台充值（绿）
//   consume    -> 剧本分析（红）
//   refund     -> 异常退款（绿）
//   deduct     -> 人工扣减（红）
//   compensate -> 人工补偿（绿）
//   lock       -> 剧本分析（红，历史兼容）
//   unlock     -> 异常退款（绿，历史兼容）
// =============================================================================

import type { CreditTxType } from '../types/credit';

export interface TxDisplay {
	label: string;
	positive: boolean; // true=绿色（正向变动），false=红色（扣减）
}

export function txDisplay(type: CreditTxType): TxDisplay {
	switch (type) {
		case 'recharge':
			return { label: '后台充值', positive: true };
		case 'consume':
			return { label: '剧本分析', positive: false };
		case 'refund':
			return { label: '异常退款', positive: true };
		case 'deduct':
			return { label: '人工扣减', positive: false };
		case 'compensate':
			return { label: '人工补偿', positive: true };
		case 'lock':
			return { label: '剧本分析', positive: false };
		case 'unlock':
			return { label: '异常退款', positive: true };
		default:
			return { label: '未知', positive: false };
	}
}

// 千位分隔符格式化（如 2000 -> "2,000"）
export function fmtCredits(n: number): string {
	return n.toLocaleString('en-US');
}

// 带符号展示流水 delta（如 +2,000 / -2,000）
export function fmtDelta(delta: number): string {
	const sign = delta > 0 ? '+' : '';
	return sign + fmtCredits(delta);
}
