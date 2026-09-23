// 积分模块类型定义（与后端 schemas/credit.schema.ts + db/schema/credit-*.ts 对齐）

// 流水类型（业务语义）
// - recharge   后台充值（管理端快捷档位 2000/4000/6000）
// - consume    剧本分析扣费（lockCredits 时直接写入）
// - refund     异常退款（任务失败/取消时退回）
// - deduct     人工扣减（管理端负向调整）
// - compensate 人工补偿（管理端正向调整，非快捷档位）
// - lock/unlock 历史兼容（仅读取旧流水）
export type CreditTxType =
	| 'recharge'
	| 'consume'
	| 'refund'
	| 'deduct'
	| 'compensate'
	| 'lock'
	| 'unlock';

// 单位类型（V1 仅启用 per_call；其他为预留）
export type CreditUnitType = 'per_call' | 'per_1k_tokens' | 'per_image';

// 流水条目
export interface CreditTransaction {
	id: string;
	userId: string;
	delta: number;
	balanceAfter: number;
	type: CreditTxType;
	refTaskId: string | null;
	refRuleCode: string | null;
	remark: string | null;
	operatedBy: string | null;
	createdAt: string;
}

// 余额查询响应
export interface CreditBalance {
	balance: number;
	locked: number;
	available: number;
}

// 积分规则
export interface CreditRule {
	id: string;
	code: string;
	name: string;
	/** 用途说明（admin 自填；为空时前端 fallback 到内置文案） */
	description: string | null;
	creditsPerUnit: number;
	unitType: CreditUnitType;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
}

// admin 调整 category（区分后台充值/人工补偿/人工扣减，决定流水 type）
export type AdjustCategory = 'recharge' | 'compensate' | 'deduct';

// admin 调整积分入参（remark 选填：调配原因内容自定义，空则不传）
export interface AdjustCreditsInput {
	delta: number;
	remark?: string;
	category: AdjustCategory;
}

// 调整结果
export interface AdjustCreditsResult {
	balanceAfter: number;
}

// 创建规则入参
export interface CreateRuleInput {
	code: string;
	name: string;
	description?: string | null;
	creditsPerUnit: number;
	unitType: CreditUnitType;
	enabled: boolean;
}

// 更新规则入参（全部可选）
export type UpdateRuleInput = Partial<CreateRuleInput>;

// 流水列表查询参数
export interface ListTransactionsQuery {
	type?: CreditTxType;
	refTaskId?: string;
	page?: number;
	pageSize?: number;
}

// 流水列表响应
export interface ListTransactionsResponse {
	items: CreditTransaction[];
	page: number;
	pageSize: number;
	total: number;
}

// 规则列表响应
export interface ListCreditRulesResponse {
	items: CreditRule[];
}
