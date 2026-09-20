// 用户级 Prompt 话术配置 API（admin only）
// -----------------------------------------------------------------------------
// 6 个接口（挂在 /api/admin/users/:id/prompt-config 下）：
//   GET   /                                          所有 type 当前摘要
//   GET   /:type                                     当前完整 + 历史列表
//   GET   /:type/versions/:versionId                 单版本完整 content
//   PUT   /:type                                     保存新版本
//   POST  /:type/rollback/:versionId                 回滚
//   POST  /copy-template                             从全局模板复制指定 type
// -----------------------------------------------------------------------------
// 类型复用 types/prompt-config（响应结构与全局话术一致，DRY）

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

// === Query Keys（按 userId 维度隔离） ===
export const userPromptConfigKeys = {
	all: (userId: string) => ['admin-users', userId, 'prompt-config'] as const,
	detail: (userId: string, type: PromptType) =>
		['admin-users', userId, 'prompt-config', type] as const,
	version: (userId: string, type: PromptType, versionId: number) =>
		['admin-users', userId, 'prompt-config', type, 'versions', versionId] as const,
};

// === 纯请求函数 ===

export async function fetchUserPromptSummary(
	userId: string,
): Promise<PromptSummaryResponse> {
	return request<PromptSummaryResponse>(
		`/admin/users/${userId}/prompt-config`,
	);
}

export async function fetchUserPromptDetail(
	userId: string,
	type: PromptType,
): Promise<PromptDetailResponse> {
	return request<PromptDetailResponse>(
		`/admin/users/${userId}/prompt-config/${type}`,
	);
}

export async function fetchUserPromptVersion(
	userId: string,
	type: PromptType,
	versionId: number,
): Promise<PromptVersionDetail> {
	return request<PromptVersionDetail>(
		`/admin/users/${userId}/prompt-config/${type}/versions/${versionId}`,
	);
}

export async function saveUserPrompt(
	userId: string,
	type: PromptType,
	input: SavePromptInput,
): Promise<SavedPromptResponse> {
	return request<SavedPromptResponse>(
		`/admin/users/${userId}/prompt-config/${type}`,
		{
			method: 'PUT',
			data: input,
		},
	);
}

export async function rollbackUserPrompt(
	userId: string,
	type: PromptType,
	versionId: number,
): Promise<SavedPromptResponse> {
	return request<SavedPromptResponse>(
		`/admin/users/${userId}/prompt-config/${type}/rollback/${versionId}`,
		{ method: 'POST' },
	);
}

export async function copyUserPromptTemplate(
	userId: string,
	type: PromptType,
): Promise<SavedPromptResponse> {
	return request<SavedPromptResponse>(
		`/admin/users/${userId}/prompt-config/copy-template`,
		{
			method: 'POST',
			data: { type },
		},
	);
}

// === React Query Hooks ===

export function useUserPromptSummary(userId: string | undefined) {
	return useQuery({
		queryKey: userId
			? userPromptConfigKeys.all(userId)
			: ['admin-users', 'undefined', 'prompt-config'],
		queryFn: () => {
			if (!userId) throw new Error('userId 必填');
			return fetchUserPromptSummary(userId);
		},
		enabled: !!userId,
		staleTime: 60 * 1000,
	});
}

export function useUserPromptDetail(userId: string | undefined, type: PromptType) {
	return useQuery({
		queryKey: userId
			? userPromptConfigKeys.detail(userId, type)
			: ['admin-users', 'undefined', 'prompt-config', type],
		queryFn: () => {
			if (!userId) throw new Error('userId 必填');
			return fetchUserPromptDetail(userId, type);
		},
		enabled: !!userId,
		staleTime: 30 * 1000,
	});
}

export function useUserPromptVersion(
	userId: string | undefined,
	type: PromptType,
	versionId: number,
) {
	return useQuery({
		queryKey: userId
			? userPromptConfigKeys.version(userId, type, versionId)
			: ['admin-users', 'undefined', 'prompt-config', type, 'versions', versionId],
		queryFn: () => {
			if (!userId) throw new Error('userId 必填');
			return fetchUserPromptVersion(userId, type, versionId);
		},
		enabled: !!userId && typeof versionId === 'number' && versionId > 0,
		staleTime: 5 * 60 * 1000,
	});
}

export function useSaveUserPrompt(userId: string, type: PromptType) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: SavePromptInput) => saveUserPrompt(userId, type, input),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: userPromptConfigKeys.all(userId),
			});
			queryClient.invalidateQueries({
				queryKey: userPromptConfigKeys.detail(userId, type),
			});
		},
	});
}

export function useRollbackUserPrompt(userId: string, type: PromptType) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (versionId: number) => rollbackUserPrompt(userId, type, versionId),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: userPromptConfigKeys.all(userId),
			});
			queryClient.invalidateQueries({
				queryKey: userPromptConfigKeys.detail(userId, type),
			});
		},
	});
}

export function useCopyUserPromptTemplate(userId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (type: PromptType) => copyUserPromptTemplate(userId, type),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: userPromptConfigKeys.all(userId),
			});
		},
	});
}
