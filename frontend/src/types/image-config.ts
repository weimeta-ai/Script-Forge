// 图片模型配置类型（独立于 LLM 配置，用于封面生成）
// -----------------------------------------------------------------------------
// 与后端 routes/image-config.routes.ts + schemas/image-config.schema.ts 对齐
// 字段语义与 LLM 配置一致：name / apiKey / model / baseUrl / timeoutMs
// 额外：defaultSize（默认图片尺寸）、defaultCount（默认生成张数）

// 脱敏的图片模型配置（GET /image-config 返回）
export interface ImageConfigMasked {
	name: string;
	apiKeyMasked: string; // 形如 sk-1****cdef
	model: string;
	baseUrl: string;
	timeoutMs: number;
	defaultSize: string; // 例如 "1024x1024"
	defaultCount: number; // 默认生成几张（1-4）
	updatedAt: string;
	hasApiKey: boolean;
}

// env 兜底配置
export interface ImageConfigFallback {
	model: string;
	baseUrl: string;
	provider: string;
	timeoutMs: number;
}

// GET /image-config 响应
export interface ImageConfigResponse {
	current: ImageConfigMasked | null;
	fallback: ImageConfigFallback;
	apiFormat: 'openai-image'; // 本期写死（OpenAI Images API 格式）
}

// PUT /image-config 请求体
export interface UpdateImageConfigInput {
	name: string;
	apiKey?: string;
	model: string;
	baseUrl: string;
	timeoutMs: number;
	defaultSize: string;
	defaultCount: number;
}

// POST /image-config/test 测试连接
export interface TestImageConfigInput {
	apiKey?: string;
	model?: string;
	baseUrl?: string;
}

export interface TestImageConfigResult {
	ok: boolean;
	latencyMs: number;
	modelEcho: string;
}

// POST /image-config/generate 生成图片
export interface GenerateImageInput {
	prompt: string;
	size?: string;
	count?: number;
}

export interface GeneratedImage {
	url: string; // 图片 URL（可能是 data: base64 或 CDN URL）
	revisedPrompt?: string; // 模型可能改写后的提示词
}

export interface GenerateImageResult {
	images: GeneratedImage[];
	model: string;
	latencyMs: number;
}
