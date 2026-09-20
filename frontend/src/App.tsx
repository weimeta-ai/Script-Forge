import { useEffect, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { RouterProvider } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { queryClient } from './lib/queryClient';
import { router } from './router';
import { DebugLogsDrawer } from './components/DebugLogsDrawer';
import { ToastContainer } from './components/Toast';
import { useAuthStore } from './store/auth';

export default function App() {
	const [debugOpen, setDebugOpen] = useState(false);
	const user = useAuthStore((s) => s.user);

	// 全局组合键：Cmd+Shift+L (mac) 或 Ctrl+Shift+L (win/linux)
	// 仅 admin 角色生效（drawer 内部接口也是 admin only）
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
				e.preventDefault();
				setDebugOpen((v) => !v);
			}
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, []);

	return (
		<QueryClientProvider client={queryClient}>
			{/* reducedMotion="user"：默认启用 spring 物理动画，但遵守用户系统的「减少动态效果」设置 */}
			<MotionConfig reducedMotion="user">
				<RouterProvider router={router} />
				{/* 全局 Toast 容器 — 任意位置可触发，固定右上角 */}
				<ToastContainer />
				{/* 仅 admin 显示调试抽屉（非 admin 即使按组合键也无效） */}
				{user?.role === 'admin' && (
					<DebugLogsDrawer open={debugOpen} onClose={() => setDebugOpen(false)} />
				)}
				<ReactQueryDevtools initialIsOpen={false} />
			</MotionConfig>
		</QueryClientProvider>
	);
}
