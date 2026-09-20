import { QueryClient } from '@tanstack/react-query';

// 全局默认配置
// - staleTime: 30s 内不重复请求（缓解 StrictMode 双发与快速切回触发）
// - retry: 失败重试 1 次（默认 3 次对原型项目偏多）
// - refetchOnWindowFocus: 关闭，避免切窗频繁刷新
export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 30_000,
			retry: 1,
			refetchOnWindowFocus: false,
		},
		mutations: {
			retry: 0,
		},
	},
});
