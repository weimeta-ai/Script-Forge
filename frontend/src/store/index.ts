import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark';

interface AppState {
	// 计数器：纯本地状态示范
	count: number;
	increment: () => void;

	// 主题切换：含 DOM 副作用示范
	theme: Theme;
	toggleTheme: () => void;
	setTheme: (theme: Theme) => void;
}

export const useAppStore = create<AppState>()(
	persist(
		(set, get) => ({
			count: 0,
			increment: () => set((s) => ({ count: s.count + 1 })),

			// 默认暗黑系
			theme: 'dark',
			toggleTheme: () => {
				const next = get().theme === 'light' ? 'dark' : 'light';
				get().setTheme(next);
			},
			setTheme: (theme) => {
				// 副作用：同步切换 document 的 dark class（Tailwind v4 class 策略）
				document.documentElement.classList.toggle('dark', theme === 'dark');
				set({ theme });
			},
		}),
		{
			name: 'app-storage',
			partialize: (s) => ({ theme: s.theme }),
		},
	),
);

// 启动时同步 DOM：避免 zustand persist 异步 hydrate 期间 .dark 缺失导致首帧白屏
if (typeof document !== 'undefined') {
	document.documentElement.classList.toggle('dark', useAppStore.getState().theme === 'dark');
}
