// 用法统计 API（admin only）
// -----------------------------------------------------------------------------
// 端点（挂在 /api/admin/usage 下）：
//   GET  /users/:id/logs   单用户调用流水
//   GET  /summary          全局聚合
// -----------------------------------------------------------------------------

import { useQuery } from '@tanstack/react-query';
import { request } from '../lib/request';
import type {
	UsageLogType,
	UsageLogsResponse,
	UsageSummaryResponse,
} from '../types/admin-user';

export const adminUsageKeys = {
	logs: (userId: string, type?: UsageLogType, page = 1, pageSize = 20) =>
		['admin-usage', 'logs', userId, { type, page, pageSize }] as const,
	summary: ['admin-usage', 'summary'] as const,
};

// 单用户流水
export async function getUserUsageLogs(
	userId: string,
	opts: { type?: UsageLogType; page?: number; pageSize?: number } = {},
): Promise<UsageLogsResponse> {
	const params = new URLSearchParams();
	if (opts.type) params.set('type', opts.type);
	if (opts.page) params.set('page', String(opts.page));
	if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
	const qs = params.toString();
	return request<UsageLogsResponse>(`/admin/usage/users/${userId}/logs${qs ? `?${qs}` : ''}`);
}

// 全局聚合
export async function getUsageSummary(): Promise<UsageSummaryResponse> {
	return request<UsageSummaryResponse>('/admin/usage/summary');
}

// === Hooks ===

export function useUserUsageLogs(
	userId: string | undefined,
	opts: { type?: UsageLogType; page?: number; pageSize?: number } = {},
) {
	return useQuery({
		queryKey: userId
			? adminUsageKeys.logs(userId, opts.type, opts.page, opts.pageSize)
			: ['admin-usage', 'logs', 'undefined'],
		queryFn: () => {
			if (!userId) throw new Error('userId 必填');
			return getUserUsageLogs(userId, opts);
		},
		enabled: !!userId,
		staleTime: 30 * 1000,
	});
}

export function useUsageSummary() {
	return useQuery({
		queryKey: adminUsageKeys.summary,
		queryFn: getUsageSummary,
		staleTime: 60 * 1000,
	});
}
