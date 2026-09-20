// 用户级配置 API（admin only）：LLM / 图片 / 复制模板
// -----------------------------------------------------------------------------
// 端点（挂在 /api/admin/users/:id 下）：
//   GET   /llm-config              读取脱敏
//   PUT   /llm-config              UPSERT
//   POST  /llm-config/test         测试连接
//   GET   /image-config            读取脱敏
//   PUT   /image-config            UPSERT
//   POST  /image-config/test       测试连接
//   POST  /copy-template           从全局模板复制
// -----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../lib/request';
import type {
	CopyTemplateResult,
	TestConnectionResult,
	TestImageConfigInput,
	TestLlmConfigInput,
	UserImageConfigMasked,
	UserLlmConfigMasked,
} from '../types/admin-user';
import type { UpdateLlmConfigInput } from '../types/llm-config';
import type { UpdateImageConfigInput } from '../types/image-config';

// 与 image-config 类型一致（更新入参）
// 复用现有 types/llm-config 的 UpdateLlmConfigInput；
// 图片类型在 types/image-config 内已有定义，这里 import 一下避免重复
// （types/image-config 的导出名见下）

// 单用户配置 query key
export const userConfigKeys = {
	llm: (userId: string) => ['admin-users', userId, 'llm-config'] as const,
	image: (userId: string) => ['admin-users', userId, 'image-config'] as const,
};

// === LLM 配置 ===

export async function getUserLlmConfig(userId: string): Promise<UserLlmConfigMasked | null> {
	const resp = await request<{ config: UserLlmConfigMasked | null }>(
		`/admin/users/${userId}/llm-config`,
	);
	return resp.config;
}

export async function updateUserLlmConfig(
	userId: string,
	input: UpdateLlmConfigInput,
): Promise<UserLlmConfigMasked> {
	return request<UserLlmConfigMasked>(`/admin/users/${userId}/llm-config`, {
		method: 'PUT',
		data: input,
	});
}

export async function testUserLlmConfig(
	userId: string,
	input: TestLlmConfigInput,
): Promise<TestConnectionResult> {
	return request<TestConnectionResult>(`/admin/users/${userId}/llm-config/test`, {
		method: 'POST',
		data: input,
	});
}

// === 图片配置 ===

export async function getUserImageConfig(
	userId: string,
): Promise<UserImageConfigMasked | null> {
	const resp = await request<{ config: UserImageConfigMasked | null }>(
		`/admin/users/${userId}/image-config`,
	);
	return resp.config;
}

export async function updateUserImageConfig(
	userId: string,
	input: UpdateImageConfigInput,
): Promise<UserImageConfigMasked> {
	return request<UserImageConfigMasked>(`/admin/users/${userId}/image-config`, {
		method: 'PUT',
		data: input,
	});
}

export async function testUserImageConfig(
	userId: string,
	input: TestImageConfigInput,
): Promise<TestConnectionResult> {
	return request<TestConnectionResult>(`/admin/users/${userId}/image-config/test`, {
		method: 'POST',
		data: input,
	});
}

// === 复制模板 ===

export async function copyTemplate(
	userId: string,
	opts?: { llm?: boolean; image?: boolean },
): Promise<CopyTemplateResult> {
	return request<CopyTemplateResult>(`/admin/users/${userId}/copy-template`, {
		method: 'POST',
		data: opts ?? {},
	});
}

// === React Query Hooks ===

export function useUserLlmConfig(userId: string | undefined) {
	return useQuery({
		queryKey: userId ? userConfigKeys.llm(userId) : ['admin-users', 'undefined', 'llm-config'],
		queryFn: () => {
			if (!userId) throw new Error('userId 必填');
			return getUserLlmConfig(userId);
		},
		enabled: !!userId,
		staleTime: 30 * 1000,
	});
}

export function useUserImageConfig(userId: string | undefined) {
	return useQuery({
		queryKey: userId ? userConfigKeys.image(userId) : ['admin-users', 'undefined', 'image-config'],
		queryFn: () => {
			if (!userId) throw new Error('userId 必填');
			return getUserImageConfig(userId);
		},
		enabled: !!userId,
		staleTime: 30 * 1000,
	});
}

export function useUpdateUserLlmConfig(userId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: UpdateLlmConfigInput) => updateUserLlmConfig(userId, input),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: userConfigKeys.llm(userId) });
			queryClient.invalidateQueries({ queryKey: ['admin-users', 'detail', userId] });
		},
	});
}

export function useUpdateUserImageConfig(userId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: UpdateImageConfigInput) => updateUserImageConfig(userId, input),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: userConfigKeys.image(userId) });
			queryClient.invalidateQueries({ queryKey: ['admin-users', 'detail', userId] });
		},
	});
}

export function useTestUserLlmConfig(userId: string) {
	return useMutation({
		mutationFn: (input: TestLlmConfigInput) => testUserLlmConfig(userId, input),
	});
}

export function useTestUserImageConfig(userId: string) {
	return useMutation({
		mutationFn: (input: TestImageConfigInput) => testUserImageConfig(userId, input),
	});
}

export function useCopyTemplate(userId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (opts?: { llm?: boolean; image?: boolean }) => copyTemplate(userId, opts),
		onSuccess: () => {
			// 复制后失效所有相关 query
			queryClient.invalidateQueries({ queryKey: ['admin-users', userId] });
			queryClient.invalidateQueries({ queryKey: ['admin-users', 'detail', userId] });
		},
	});
}
