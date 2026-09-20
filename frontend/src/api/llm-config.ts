// LLM 配置 API（admin only）
// -----------------------------------------------------------------------------
// 3 个接口：
//   GET  /llm-config       获取当前配置（脱敏）+ env 兜底
//   PUT  /llm-config       更新配置（UPSERT）
//   POST /llm-config/test  测试连接（不写 DB）
// -----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../lib/request';
import type {
	LlmConfigResponse,
	UpdateLlmConfigInput,
	TestLlmConfigInput,
	TestLlmConnectionResult,
} from '../types/llm-config';

// === Query Keys ===
export const llmConfigKeys = {
	all: ['llm-config'] as const,
};

// === 纯请求函数 ===

export async function fetchLlmConfig(): Promise<LlmConfigResponse> {
	return request<LlmConfigResponse>('/llm-config');
}

export async function updateLlmConfig(input: UpdateLlmConfigInput): Promise<LlmConfigResponse> {
	return request<LlmConfigResponse>('/llm-config', {
		method: 'PUT',
		data: input,
	});
}

export async function testLlmConnection(input: TestLlmConfigInput): Promise<TestLlmConnectionResult> {
	return request<TestLlmConnectionResult>('/llm-config/test', {
		method: 'POST',
		data: input,
	});
}

// === React Query Hooks ===

// 读取当前配置（含 env 兜底信息）
export function useLlmConfig() {
	return useQuery({
		queryKey: llmConfigKeys.all,
		queryFn: fetchLlmConfig,
		staleTime: 60 * 1000,
	});
}

// 更新配置（成功后失效缓存触发重新拉取）
export function useUpdateLlmConfig() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: updateLlmConfig,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: llmConfigKeys.all });
		},
	});
}

// 测试连接（不缓存）
export function useTestLlmConnection() {
	return useMutation({
		mutationFn: testLlmConnection,
	});
}
