import { useQuery } from '@tanstack/react-query';
import { request } from '../lib/request';

// === 类型 ===
export interface UserResponse {
	id: number;
	name: string;
	email: string;
	company: { name: string };
}

// === Query Keys（集中管理，避免字符串散落） ===
export const exampleKeys = {
	all: ['examples'] as const,
	user: (id: number) => [...exampleKeys.all, 'user', id] as const,
};

// === 纯请求函数（可被任意调用，不绑定 React） ===
// 注意：JSONPlaceholder 用完整 URL，request 内部的 BASE_URL 不影响（前缀为空字符串）
export function fetchUser(id: number) {
	return request<UserResponse>(`https://jsonplaceholder.typicode.com/users/${id}`);
}

// === Query Hook（业务层使用） ===
export function useUser(id: number) {
	return useQuery({
		queryKey: exampleKeys.user(id),
		queryFn: () => fetchUser(id),
	});
}
