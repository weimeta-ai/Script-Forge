// Prompt 配置 API（admin only）
// -----------------------------------------------------------------------------
// 5 个接口：
//   GET   /prompt-config                              所有 type 当前摘要
//   GET   /prompt-config/:type                        当前完整 + 历史列表
//   GET   /prompt-config/:type/versions/:versionId    单版本完整 content
//   PUT   /prompt-config/:type                        保存新版本
//   POST  /prompt-config/:type/rollback/:versionId    回滚
// -----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../lib/request';
import type { PromptType } from '../types/prompt-config';
import type {
	PromptSummaryResponse,
	PromptDetailResponse,
	PromptVersionDetail,
	SavePromptInput,
	SavedPromptResponse,
} from '../types/prompt-config';

// === Query Keys ===
export const promptConfigKeys = {
	all: ['prompt-config'] as const,
	detail: (type: PromptType) => ['prompt-config', type] as const,
	version: (type: PromptType, versionId: number) =>
		['prompt-config', type, 'versions', versionId] as const,
};

// === 纯请求函数 ===

export async function fetchPromptSummary(): Promise<PromptSummaryResponse> {
	return request<PromptSummaryResponse>('/prompt-config');
}

export async function fetchPromptDetail(
	type: PromptType,
): Promise<PromptDetailResponse> {
	return request<PromptDetailResponse>(`/prompt-config/${type}`);
}

export async function fetchPromptVersion(
	type: PromptType,
	versionId: number,
): Promise<PromptVersionDetail> {
	return request<PromptVersionDetail>(
		`/prompt-config/${type}/versions/${versionId}`,
	);
}

export async function savePrompt(
	type: PromptType,
	input: SavePromptInput,
): Promise<SavedPromptResponse> {
	return request<SavedPromptResponse>(`/prompt-config/${type}`, {
		method: 'PUT',
		data: input,
	});
}

export async function rollbackPrompt(
	type: PromptType,
	versionId: number,
): Promise<SavedPromptResponse> {
	return request<SavedPromptResponse>(
		`/prompt-config/${type}/rollback/${versionId}`,
		{ method: 'POST' },
	);
}

// === React Query Hooks ===

export function usePromptSummary() {
	return useQuery({
		queryKey: promptConfigKeys.all,
		queryFn: fetchPromptSummary,
		staleTime: 60 * 1000,
	});
}

export function usePromptDetail(type: PromptType) {
	return useQuery({
		queryKey: promptConfigKeys.detail(type),
		queryFn: () => fetchPromptDetail(type),
		staleTime: 30 * 1000,
	});
}

export function usePromptVersion(type: PromptType, versionId: number) {
	return useQuery({
		queryKey: promptConfigKeys.version(type, versionId),
		queryFn: () => fetchPromptVersion(type, versionId),
		enabled: typeof versionId === 'number' && versionId > 0,
		staleTime: 5 * 60 * 1000,
	});
}

export function useSavePrompt(type: PromptType) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: SavePromptInput) => savePrompt(type, input),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: promptConfigKeys.all });
			queryClient.invalidateQueries({
				queryKey: promptConfigKeys.detail(type),
			});
		},
	});
}

export function useRollbackPrompt(type: PromptType) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (versionId: number) => rollbackPrompt(type, versionId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: promptConfigKeys.all });
			queryClient.invalidateQueries({
				queryKey: promptConfigKeys.detail(type),
			});
		},
	});
}
