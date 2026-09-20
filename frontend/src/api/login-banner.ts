// 登录页轮播图 API
// -----------------------------------------------------------------------------
// 5 个接口：
//   GET    /login-banners         公开  登录页拉启用列表（不带 token）
//   GET    /login-banners/admin   admin 后台拉全部列表
//   POST   /login-banners         admin multipart 上传
//   PATCH  /login-banners/:id     admin 更新
//   DELETE /login-banners/:id     admin 删除
// -----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../lib/request';
import type {
	AdminLoginBanner,
	LoginBanner,
	UpdateBannerInput,
} from '../types/login-banner';

// === Query Keys ===
// admin 与 public 共用失效（任何修改都让两边都刷新）
export const loginBannerKeys = {
	all: ['login-banners'] as const,
	public: ['login-banners', 'public'] as const,
	admin: ['login-banners', 'admin'] as const,
};

// === 纯请求函数 ===

// 公开接口：不带 token（withAuth: false）
export async function fetchActiveBanners(): Promise<LoginBanner[]> {
	const res = await request<{ items: LoginBanner[] }>('/login-banners', {
		withAuth: false,
	});
	return res.items;
}

// Admin 接口：带 token
export async function fetchAllBanners(): Promise<AdminLoginBanner[]> {
	const res = await request<{ items: AdminLoginBanner[] }>('/login-banners/admin');
	return res.items;
}

export async function uploadBanner(file: File): Promise<AdminLoginBanner> {
	const formData = new FormData();
	formData.append('file', file);
	return request<AdminLoginBanner>('/login-banners', {
		method: 'POST',
		formData,
	});
}

export async function updateBanner(
	id: string,
	patch: UpdateBannerInput,
): Promise<AdminLoginBanner> {
	return request<AdminLoginBanner>(`/login-banners/${id}`, {
		method: 'PATCH',
		data: patch,
	});
}

export async function deleteBanner(id: string): Promise<void> {
	await request<void>(`/login-banners/${id}`, { method: 'DELETE' });
}

// === React Query Hooks ===

// 登录页用：拉启用列表
export function useActiveBanners() {
	return useQuery({
		queryKey: loginBannerKeys.public,
		queryFn: fetchActiveBanners,
		staleTime: 60 * 1000,
	});
}

// 后台用：拉全部
export function useAdminBanners() {
	return useQuery({
		queryKey: loginBannerKeys.admin,
		queryFn: fetchAllBanners,
		staleTime: 30 * 1000,
	});
}

export function useUploadBanner() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: uploadBanner,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: loginBannerKeys.all });
		},
	});
}

export function useUpdateBanner() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ id, patch }: { id: string; patch: UpdateBannerInput }) =>
			updateBanner(id, patch),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: loginBannerKeys.all });
		},
	});
}

export function useDeleteBanner() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: deleteBanner,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: loginBannerKeys.all });
		},
	});
}
