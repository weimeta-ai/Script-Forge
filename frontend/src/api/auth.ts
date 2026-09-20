// 鉴权相关 API
// -----------------------------------------------------------------------------
// 设计模式：
// - fetchLogin / fetchMe / fetchRegister 是纯请求函数（不绑定 React）
// - useLogin / useMe / useRegister 是 React Query hooks（业务层用）
// - 这种分离让请求函数可被任意场景调用（如非 React 的初始化脚本）
// -----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../lib/request';
import type { AuthResponse, LoginInput, RegisterInput, User } from '../types/auth';

// === Query Keys ===
// 集中管理，避免字符串散落；改动时只改一处
export const authKeys = {
	all: ['auth'] as const,
	me: () => [...authKeys.all, 'me'] as const,
};

// === 纯请求函数 ===

// 登录（不需要带 token）
export async function fetchLogin(input: LoginInput) {
	return request<AuthResponse>('/auth/login', {
		method: 'POST',
		data: input,
		withAuth: false, // 避免带旧 token
	});
}

// 注册（不需要带 token）
export async function fetchRegister(input: RegisterInput) {
	return request<AuthResponse>('/auth/register', {
		method: 'POST',
		data: input,
		withAuth: false,
	});
}

// 获取当前登录用户（需要 token）
export async function fetchMe() {
	return request<User>('/auth/me');
}

// === React Query Hooks ===

// 登录 mutation
// 成功后：写入 auth store + 让 react-query 失效 me（虽然刚登录不需要，但保持一致性）
export function useLogin() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: fetchLogin,
		onSuccess: (data) => {
			// 写入 zustand store（触发持久化）
			useAuthStore.getState().setAuth(data);
			// 预取 me（让后续 useMe 直接命中缓存）
			queryClient.setQueryData(authKeys.me(), data.user);
		},
	});
}

// 注册 mutation（注册即登录）
export function useRegister() {
	return useMutation({
		mutationFn: fetchRegister,
	});
}

// 当前用户 query
// enabled: 只在有 token 时发起请求（避免未登录时无谓调用）
export function useMe() {
	const hasToken = useAuthStore((s) => !!s.token);
	return useQuery({
		queryKey: authKeys.me(),
		queryFn: fetchMe,
		enabled: hasToken,
		staleTime: 5 * 60 * 1000, // 5 分钟内不重复请求
	});
}

// -----------------------------------------------------------------------------
// 上述 useLogin 里用了 useAuthStore，需要 import
// 放在文件末尾避免循环依赖问题（zustand 的 getState 是 lazy 的）
// -----------------------------------------------------------------------------
import { useAuthStore } from '../store/auth';
