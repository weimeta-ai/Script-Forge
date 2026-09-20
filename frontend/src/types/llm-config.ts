// LLM 配置类型（运维调试页用）
// 与后端 routes/llm-config.routes.ts + schemas/llm-config.schema.ts 对齐

// API 协议格式（admin 可选）
// - openai：OpenAI 兼容 /v1/chat/completions（绝大多数网关）
// - anthropic：Anthropic 原生 /v1/messages（直连官方或 Claude 系网关）
export type LlmApiFormat = 'openai' | 'anthropic';

// 脱敏的 LLM 配置（GET /llm-config 返回）
export interface LlmConfigMasked {
	name: string;
	apiKeyMasked: string; // 形如 sk-1****cdef
	model: string;
	baseUrl: string;
	apiFormat: LlmApiFormat;
	timeoutMs: number;
	defaultAnalyzeMode: AnalyzeMode;
	updatedAt: string; // ISO 时间字符串
	hasApiKey: boolean;
}

// 分析模式（与后端 drama-predict AnalyzeMode 对齐）
export type AnalyzeMode = 'standard' | 'fast' | 'ultra';

// env 兜底配置（DB 无配置时的 fallback，仅展示用）
export interface LlmConfigFallback {
	model: string;
	baseUrl: string;
	provider: string;
	timeoutMs: number;
}

// GET /llm-config 返回的完整结构
export interface LlmConfigResponse {
	current: LlmConfigMasked | null;
	fallback: LlmConfigFallback;
	apiFormat: LlmApiFormat; // 当前生效格式（DB 无配置时默认 openai）
}

// PUT /llm-config 请求体
// apiKey 可选：留空时后端保留 DB 已存的值（用户改其他字段时不必每次重输 key）
export interface UpdateLlmConfigInput {
	name: string;
	apiKey?: string;
	model: string;
	baseUrl: string;
	apiFormat?: LlmApiFormat;
	timeoutMs: number;
	defaultAnalyzeMode?: AnalyzeMode;
}

// POST /llm-config/test 请求体（全部可选，缺失字段从 DB/env 兜底）
export interface TestLlmConfigInput {
	apiKey?: string;
	model?: string;
	baseUrl?: string;
	apiFormat?: LlmApiFormat;
}

// POST /llm-config/test 成功响应
export interface TestLlmConnectionResult {
	ok: boolean;
	latencyMs: number;
	modelEcho: string;
}
