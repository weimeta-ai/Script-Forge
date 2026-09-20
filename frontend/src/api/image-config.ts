// 图片模型配置 API（admin only）+ 封面生成 API（所有用户）
// -----------------------------------------------------------------------------
// 4 个接口：
//   GET   /image-config            获取当前配置（脱敏）+ env 兜底
//   PUT   /image-config            更新配置（UPSERT）
//   POST  /image-config/test       测试连接（不写 DB）
//   POST  /image-config/generate   生成图片（使用当前配置）
// -----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../lib/request';
import type {
	ImageConfigResponse,
	UpdateImageConfigInput,
	TestImageConfigInput,
	TestImageConfigResult,
	GenerateImageInput,
	GenerateImageResult,
} from '../types/image-config';

// === Query Keys ===
export const imageConfigKeys = {
	all: ['image-config'] as const,
};

// === 纯请求函数 ===

export async function fetchImageConfig(): Promise<ImageConfigResponse> {
	return request<ImageConfigResponse>('/image-config');
}

export async function updateImageConfig(
	input: UpdateImageConfigInput,
): Promise<ImageConfigResponse> {
	return request<ImageConfigResponse>('/image-config', {
		method: 'PUT',
		data: input,
	});
}

export async function testImageConnection(
	input: TestImageConfigInput,
): Promise<TestImageConfigResult> {
	return request<TestImageConfigResult>('/image-config/test', {
		method: 'POST',
		data: input,
	});
}

export async function generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
	return request<GenerateImageResult>('/image-config/generate', {
		method: 'POST',
		data: input,
	});
}

// === React Query Hooks ===

export function useImageConfig() {
	return useQuery({
		queryKey: imageConfigKeys.all,
		queryFn: fetchImageConfig,
		staleTime: 60 * 1000,
	});
}

export function useUpdateImageConfig() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: updateImageConfig,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: imageConfigKeys.all });
		},
	});
}

export function useTestImageConnection() {
	return useMutation({
		mutationFn: testImageConnection,
	});
}

export function useGenerateImage() {
	return useMutation({
		mutationFn: generateImage,
	});
}
