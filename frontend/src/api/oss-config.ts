// 阿里云 OSS 图床配置 API（admin only）
// -----------------------------------------------------------------------------
// 4 个接口：
//   GET   /oss-config              获取当前配置（脱敏）+ env 兜底
//   PUT   /oss-config              更新配置（UPSERT）
//   POST  /oss-config/test         测试连接（不写 DB）
//   POST  /oss-config/upload-by-url 远程 URL 转存到 OSS（核心）
// -----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../lib/request';
import type {
	OssConfigResponse,
	UpdateOssConfigInput,
	TestOssConfigInput,
	TestOssConfigResult,
	UploadByUrlInput,
	UploadByUrlResult,
} from '../types/oss-config';

// === Query Keys ===
export const ossConfigKeys = {
	all: ['oss-config'] as const,
};

// === 纯请求函数 ===

export async function fetchOssConfig(): Promise<OssConfigResponse> {
	return request<OssConfigResponse>('/oss-config');
}

export async function updateOssConfig(input: UpdateOssConfigInput): Promise<OssConfigResponse> {
	return request<OssConfigResponse>('/oss-config', {
		method: 'PUT',
		data: input,
	});
}

export async function testOssConnection(input: TestOssConfigInput): Promise<TestOssConfigResult> {
	return request<TestOssConfigResult>('/oss-config/test', {
		method: 'POST',
		data: input,
	});
}

export async function uploadByUrl(input: UploadByUrlInput): Promise<UploadByUrlResult> {
	return request<UploadByUrlResult>('/oss-config/upload-by-url', {
		method: 'POST',
		data: input,
	});
}

// === React Query Hooks ===

export function useOssConfig() {
	return useQuery({
		queryKey: ossConfigKeys.all,
		queryFn: fetchOssConfig,
		staleTime: 60 * 1000,
	});
}

export function useUpdateOssConfig() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: updateOssConfig,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ossConfigKeys.all });
		},
	});
}

export function useTestOssConnection() {
	return useMutation({
		mutationFn: testOssConnection,
	});
}

export function useUploadByUrl() {
	return useMutation({
		mutationFn: uploadByUrl,
	});
}
