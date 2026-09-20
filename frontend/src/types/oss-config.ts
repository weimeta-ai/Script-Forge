// 阿里云 OSS 图床配置类型（AI 生成图片持久化）
// -----------------------------------------------------------------------------
// 与后端 routes/oss-config.routes.ts + schemas/oss-config.schema.ts 对齐
// 字段语义与 image-config 一致：name + AK/SK 脱敏 + region/bucket

// 脱敏的 OSS 配置（GET /oss-config 返回）
export interface OssConfigMasked {
	name: string;
	accessKeyIdMasked: string; // 形如 LTAI****xyZ
	accessKeySecretMasked: string;
	region: string; // 例如 "oss-cn-hangzhou"
	bucket: string;
	endpoint: string | null;
	customDomain: string | null;
	pathPrefix: string;
	timeoutMs: number;
	updatedAt: string;
	hasAccessKeySecret: boolean;
}

// env 兜底配置
export interface OssConfigFallback {
	accessKeyId: string;
	accessKeySecret: string;
	region: string;
	bucket: string;
	endpoint: string;
	customDomain: string;
	pathPrefix: string;
	timeoutMs: number;
}

// GET /oss-config 响应
export interface OssConfigResponse {
	current: OssConfigMasked | null;
	fallback: OssConfigFallback;
	provider: 'aliyun-oss';
}

// PUT /oss-config 请求体
// accessKeyId / accessKeySecret 留空表示沿用 DB（与 image-config 一致）
export interface UpdateOssConfigInput {
	name: string;
	accessKeyId?: string;
	accessKeySecret?: string;
	region: string;
	bucket: string;
	endpoint: string | null;
	customDomain: string | null;
	pathPrefix: string;
	timeoutMs: number;
}

// POST /oss-config/test 测试连接
export interface TestOssConfigInput {
	accessKeyId?: string;
	accessKeySecret?: string;
	region?: string;
	bucket?: string;
	endpoint?: string;
}

export interface TestOssConfigResult {
	ok: boolean;
	latencyMs: number;
	bucketEcho: string;
	regionEcho: string;
}

// POST /oss-config/upload-by-url 远程 URL 转存
export interface UploadByUrlInput {
	url: string; // http(s):// 或 data:base64
	filename?: string;
	contentType?: string;
}

export interface UploadByUrlResult {
	url: string; // OSS 永久 URL
	key: string;
	contentType: string;
	size: number;
	source: 'db' | 'env';
}
