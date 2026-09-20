// 用户管理类型（admin only）
// 与后端 routes/admin-users.routes.ts + repositories/user.repository.ts 对齐

// 用户角色
export type UserRole = 'admin' | 'user';

// 用户状态
export type UserStatus = 'active' | 'disabled';

// 列表查询参数
export interface ListUsersQuery {
	keyword?: string;
	status?: UserStatus;
	role?: UserRole;
	page?: number;
	pageSize?: number;
}

// 列表项（含统计聚合，对齐后端 UserListItem）
export interface UserListItem {
	id: string;
	username: string;
	displayName: string;
	role: UserRole;
	status: UserStatus;
	creditBalance: number;
	creditLocked: number;
	preferences: unknown;
	createdAt: string;
	updatedAt: string;
	// 统计字段（usage_logs 实时聚合）
	totalTokens: number;
	totalCalls: number;
	lastActiveAt: string | null;
	reportCount: number;
}

// 列表响应
export interface ListUsersResponse {
	items: UserListItem[];
	page: number;
	pageSize: number;
	total: number;
}

// 创建用户入参
export interface CreateUserInput {
	username: string;
	password: string;
	displayName?: string;
	role: UserRole;
	status?: UserStatus;
	copyTemplateConfig?: boolean;
}

// 编辑用户入参（所有字段可选）
// 注意：creditBalance 不在此接口调整，改用 POST /admin/users/:id/credits/adjust
export interface UpdateUserInput {
	displayName?: string;
	role?: UserRole;
	status?: UserStatus;
	password?: string;
}

// 用户级 LLM 配置（脱敏）
export interface UserLlmConfigMasked {
	name: string;
	apiKeyMasked: string;
	model: string;
	baseUrl: string;
	timeoutMs: number;
	defaultAnalyzeMode: 'standard' | 'fast' | 'ultra';
	updatedAt: string;
	hasApiKey: boolean;
}

// 用户级 图片配置（脱敏）
export interface UserImageConfigMasked {
	name: string;
	apiKeyMasked: string;
	model: string;
	baseUrl: string;
	timeoutMs: number;
	defaultSize: string;
	defaultCount: number;
	updatedAt: string;
	hasApiKey: boolean;
}

// 用户详情响应（GET /:id）
export interface UserDetailResponse {
	id: string;
	username: string;
	displayName: string;
	role: UserRole;
	status: UserStatus;
	creditBalance: number;
	creditLocked: number;
	preferences: unknown;
	createdAt: string;
	updatedAt: string;
	hasLlmConfig: boolean;
	hasImageConfig: boolean;
	llmConfig: UserLlmConfigMasked | null;
	imageConfig: UserImageConfigMasked | null;
	usage: {
		totalTokens: number;
		totalCalls: number;
		lastActiveAt: string | null;
	};
}

// 测试连接入参（缺失字段从 DB 兜底）
export interface TestLlmConfigInput {
	apiKey?: string;
	model?: string;
	baseUrl?: string;
}

export interface TestImageConfigInput {
	apiKey?: string;
	model?: string;
	baseUrl?: string;
}

// 测试连接结果
export interface TestConnectionResult {
	ok: boolean;
	latencyMs: number;
	modelEcho: string;
}

// 复制模板结果
export interface CopyTemplateResult {
	llm: UserLlmConfigMasked | null;
	image: UserImageConfigMasked | null;
}

// 用法日志类型
export type UsageLogType = 'llm' | 'image';
export type UsageLogPhase = 'analyze' | 'cover' | 'test';

export interface UsageLog {
	id: string;
	userId: string;
	taskId: string | null;
	scriptId: string | null;
	type: UsageLogType;
	phase: UsageLogPhase;
	model: string | null;
	promptTokens: number | null;
	completionTokens: number | null;
	totalTokens: number | null;
	imageCount: number | null;
	latencyMs: number | null;
	costCredits: number;
	success: boolean;
	errorCode: string | null;
	createdAt: string;
}

export interface UsageLogsResponse {
	items: UsageLog[];
	page: number;
	pageSize: number;
	total: number;
}

// 全局聚合
export interface UsageSummaryResponse {
	usage: {
		totalCalls: number;
		totalTokens: number;
		successCalls: number;
		failedCalls: number;
	};
	users: {
		total: number;
		active: number;
		admins: number;
	};
	reports: {
		total: number;
	};
}
