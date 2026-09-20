// 鉴权状态管理（基于 zustand + persist）
// -----------------------------------------------------------------------------
// 设计要点：
// - token 持久化到 localStorage（刷新页面不丢失）
// - user 也持久化（避免每次刷新都调 /me）
// - 提供 setAuth / clearAuth 两个核心方法
// - 提供 selector：useToken / useUser / useIsAuthenticated 方便组件用
// -----------------------------------------------------------------------------

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../types/auth';

interface AuthState {
	// 状态
	token: string | null;
	user: User | null;

	// 计算属性（getter 风格）
	isAuthenticated: () => boolean;

	// 操作
	setAuth: (data: { token: string; user: User }) => void;
	setUser: (user: User) => void;
	clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
	persist(
		(set, get) => ({
			token: null,
			user: null,

			// 用函数形式，避免持久化"派生值"导致不同步
			isAuthenticated: () => !!get().token,

			// 登录成功 / 注册成功后调用
			setAuth: ({ token, user }) => set({ token, user }),

			// 更新用户信息（如修改昵称后）
			setUser: (user) => set({ user }),

			// 登出 / 401 自动登出
			clearAuth: () => set({ token: null, user: null }),
		}),
		{
			// localStorage 的 key（不能改，否则历史数据丢失）
			name: 'drama-auth',

			// 只持久化 token 和 user，不持久化函数
			partialize: (s) => ({ token: s.token, user: s.user }),
		},
	),
);

// -----------------------------------------------------------------------------
// 非 hook 入口（供 request.ts 等非组件代码使用）
// -----------------------------------------------------------------------------
// 用法：const { token } = useAuthStore.getState()
// 注意：getState() 返回当前快照，不会自动订阅变化
