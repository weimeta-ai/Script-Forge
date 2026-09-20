// 路由配置 + 鉴权守卫（p00 同款精简）
// -----------------------------------------------------------------------------
// 设计要点：
// - 用 createBrowserRouter（React Router 7 推荐用法）
// - 路由守卫：RequireAuth（需登录）/ RedirectIfAuthed（已登录跳上传页）
// - 4 个核心路由：/upload /analyzing-task/:taskId /report/:id /history
// - 3 个 admin 路由：/admin/knowledge /admin/llm-config /admin/image-config
// =============================================================================

import { createBrowserRouter, Navigate, Outlet, type RouteObject } from 'react-router-dom';
import { AdminRoute } from '../components/AdminRoute';
import { AppShell, type BarItem } from '../components/shell';
import { useAuthStore } from '../store/auth';
import AnalyzingTaskPage from '../views/AnalyzingTask';
import HistoryPage from '../views/History';
import Login from '../views/Login';
import Register from '../views/Register';
import ReportPage from '../views/Report';
import UploadPage from '../views/Upload';
import ImageConfig from '../views/admin/ImageConfig';
import KnowledgeImport from '../views/admin/KnowledgeImport';
import LLMConfig from '../views/admin/LLMConfig';
import LoginBanners from '../views/admin/LoginBanners';
import OssConfig from '../views/admin/OssConfig';
import PromptConfig from '../views/admin/PromptConfig';
import CreditRules from '../views/admin/CreditRules';
import UserDetail from '../views/admin/UserDetail';
import Users from '../views/admin/Users';

// -----------------------------------------------------------------------------
// 核心页面统一布局：保留原侧边栏（AppSidebar）+ AppShell 外壳
// 用 Outlet 让路由表声明式包裹，避免每个页面单独 import AppShell
// -----------------------------------------------------------------------------
function AppLayout() {
	const topItems: BarItem[] = [{ label: '工作区', value: '短剧预测' }];
	return (
		<AppShell
			decorLevel="L2"
			topItems={topItems}
			topRight={[{ label: '状态', value: '就绪' }]}
			bottomItems={[{ label: '知识库', value: '已启用' }]}
			showBackground={false}
			showHud={false}
		>
			<Outlet />
		</AppShell>
	);
}

// -----------------------------------------------------------------------------
// 路由守卫
// -----------------------------------------------------------------------------

// 需要登录才能访问
// 未登录 → 跳 /login，并把想访问的路径记到 from（登录后回跳）
function RequireAuth({ children }: { children: React.ReactNode }) {
	const token = useAuthStore((s) => s.token);
	if (!token) {
		return <Navigate to="/login" replace state={{ from: location.pathname }} />;
	}
	return <>{children}</>;
}

// 已登录就跳走（用于登录页：已登录用户不该再看登录页）
function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
	const token = useAuthStore((s) => s.token);
	if (token) {
		return <Navigate to="/upload" replace />;
	}
	return <>{children}</>;
}

// -----------------------------------------------------------------------------
// 路由表
// -----------------------------------------------------------------------------
const routes: RouteObject[] = [
	{
		path: '/login',
		element: (
			<RedirectIfAuthed>
				<Login />
			</RedirectIfAuthed>
		),
	},
	{
		path: '/register',
		element: (
			<RedirectIfAuthed>
				<Register />
			</RedirectIfAuthed>
		),
	},
	// 兜底：原 /welcome /workspace 路径统一重定向到 /upload（用户已收藏旧路径不报 404）
	{ path: '/welcome', element: <Navigate to="/upload" replace /> },
	{ path: '/workspace', element: <Navigate to="/upload" replace /> },
	{ path: '/reports', element: <Navigate to="/history" replace /> },
	// 核心路由（p00 同款 4 页面，统一用 AppLayout 保留原侧边栏）
	{
		element: (
			<RequireAuth>
				<AppLayout />
			</RequireAuth>
		),
		children: [
			{ path: '/upload', element: <UploadPage /> },
			{ path: '/analyzing-task/:taskId', element: <AnalyzingTaskPage /> },
			{ path: '/report/:id', element: <ReportPage /> },
			{ path: '/history', element: <HistoryPage /> },
		],
	},
	// admin 路由（admin only）
	{
		path: '/admin/knowledge',
		element: (
			<RequireAuth>
				<AdminRoute>
					<KnowledgeImport />
				</AdminRoute>
			</RequireAuth>
		),
	},
	{
		path: '/admin/llm-config',
		element: (
			<RequireAuth>
				<AdminRoute>
					<LLMConfig />
				</AdminRoute>
			</RequireAuth>
		),
	},
	{
		path: '/admin/image-config',
		element: (
			<RequireAuth>
				<AdminRoute>
					<ImageConfig />
				</AdminRoute>
			</RequireAuth>
		),
	},
	{
		path: '/admin/oss-config',
		element: (
			<RequireAuth>
				<AdminRoute>
					<OssConfig />
				</AdminRoute>
			</RequireAuth>
		),
	},
	{
		path: '/admin/login-banners',
		element: (
			<RequireAuth>
				<AdminRoute>
					<LoginBanners />
				</AdminRoute>
			</RequireAuth>
		),
	},
	{
		path: '/admin/prompt-config',
		element: (
			<RequireAuth>
				<AdminRoute>
					<PromptConfig />
				</AdminRoute>
			</RequireAuth>
		),
	},
	{
		path: '/admin/users',
		element: (
			<RequireAuth>
				<AdminRoute>
					<Users />
				</AdminRoute>
			</RequireAuth>
		),
	},
	{
		path: '/admin/users/:id',
		element: (
			<RequireAuth>
				<AdminRoute>
					<UserDetail />
				</AdminRoute>
			</RequireAuth>
		),
	},
	{
		path: '/admin/credit-rules',
		element: (
			<RequireAuth>
				<AdminRoute>
					<CreditRules />
				</AdminRoute>
			</RequireAuth>
		),
	},
	// 根路径：根据登录状态跳转
	{
		path: '/',
		element: <RootRedirect />,
	},
	// 404 兜底
	{
		path: '*',
		element: <Navigate to="/" replace />,
	},
];

// 根路径智能跳转
function RootRedirect() {
	const token = useAuthStore((s) => s.token);
	if (!token) return <Navigate to="/login" replace />;
	return <Navigate to="/upload" replace />;
}

export const router = createBrowserRouter(routes);
