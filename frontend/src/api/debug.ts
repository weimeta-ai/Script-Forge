// Debug 日志 API（admin only，前端 Cmd+Shift+L 调试面板用）
// -----------------------------------------------------------------------------
// 1 个接口：
//   GET /debug/logs?limit=200   读最近 N 条运行时日志
//
// 设计要点：
//   - 启用 polling：drawer 打开时每 3 秒拉一次
//   - 关闭时停止 polling（refetchInterval=false）
//   - 仅 admin 能调（后端 requireRole 守卫）
// -----------------------------------------------------------------------------

import { useQuery } from '@tanstack/react-query';
import { request } from '../lib/request';
import type { RuntimeLogsResponse } from '../types/debug';

export const debugKeys = {
	all: ['debug'] as const,
	logs: (limit: number) => ['debug', 'logs', limit] as const,
};

export async function fetchRuntimeLogs(limit = 200): Promise<RuntimeLogsResponse> {
	return request<RuntimeLogsResponse>(`/debug/logs?limit=${limit}`);
}

// polling hook：仅在 enabled=true 时定时拉取（drawer 关闭时不拉）
export function useRuntimeLogs(opts: { enabled: boolean; limit?: number }) {
	const { enabled, limit = 200 } = opts;
	return useQuery({
		queryKey: debugKeys.logs(limit),
		queryFn: () => fetchRuntimeLogs(limit),
		enabled,
		refetchInterval: enabled ? 3000 : false, // 打开时 3 秒轮询
		staleTime: 0, // 每次都重新拉
	});
}
