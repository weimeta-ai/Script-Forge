// 用户管理 API（admin only）
// -----------------------------------------------------------------------------
// 端点（挂在 /api/admin/users 下）：
//   GET    /                列表（含统计聚合）
//   POST   /                创建用户
//   GET    /:id             详情
//   PATCH  /:id             编辑
// -----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../lib/request';
import type {
	CreateUserInput,
	ListUsersQuery,
	ListUsersResponse,
	UpdateUserInput,
	UserDetailResponse,
} from '../types/admin-user';

export const adminUserKeys = {
	all: ['admin-users'] as const,
	list: (q: ListUsersQuery) => ['admin-users', 'list', q] as const,
	detail: (id: string) => ['admin-users', 'detail', id] as const,
};

// === 纯请求函数 ===

export async function listUsers(query: ListUsersQuery = {}): Promise<ListUsersResponse> {
	// 拼 query string（仅含有值的字段）
	const params = new URLSearchParams();
	if (query.keyword) params.set('keyword', query.keyword);
	if (query.status) params.set('status', query.status);
	if (query.role) params.set('role', query.role);
	if (query.page) params.set('page', String(query.page));
	if (query.pageSize) params.set('pageSize', String(query.pageSize));
	const qs = params.toString();
	return request<ListUsersResponse>(`/admin/users${qs ? `?${qs}` : ''}`);
}

export async function getUserDetail(id: string): Promise<UserDetailResponse> {
	return request<UserDetailResponse>(`/admin/users/${id}`);
}

export async function createUser(input: CreateUserInput): Promise<UserDetailResponse> {
	return request<UserDetailResponse>('/admin/users', {
		method: 'POST',
		data: input,
	});
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<UserDetailResponse> {
	return request<UserDetailResponse>(`/admin/users/${id}`, {
		method: 'PATCH',
		data: input,
	});
}

// === React Query Hooks ===

export function useAdminUsersList(query: ListUsersQuery) {
	return useQuery({
		queryKey: adminUserKeys.list(query),
		queryFn: () => listUsers(query),
		staleTime: 30 * 1000,
	});
}

export function useAdminUserDetail(id: string | undefined) {
	return useQuery({
		queryKey: id ? adminUserKeys.detail(id) : ['admin-users', 'detail', 'undefined'],
		queryFn: () => {
			if (!id) throw new Error('id 必填');
			return getUserDetail(id);
		},
		enabled: !!id,
		staleTime: 30 * 1000,
	});
}

export function useCreateUser() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: createUser,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: adminUserKeys.all });
		},
	});
}

export function useUpdateUser(id: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: UpdateUserInput) => updateUser(id, input),
		onSuccess: () => {
			// 失效列表 + 当前用户详情
			queryClient.invalidateQueries({ queryKey: adminUserKeys.all });
		},
	});
}
