// Admin 路由守卫（5c 阶段）
// -----------------------------------------------------------------------------
// 用法：<AdminRoute><KnowledgeImport /></AdminRoute>
// 行为：非 admin 重定向到 /workspace（防 URL 猜测）；admin 才渲染 children
// 设计：与 RequireAuth 同构模式，但基于 role 而非 token
// -----------------------------------------------------------------------------

import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';

export function AdminRoute({ children }: { children: React.ReactNode }) {
	const role = useAuthStore((s) => s.user?.role);
	if (role !== 'admin') {
		// 普通用户只能看 /upload 和 /history（其余管理页一律拒）
		return <Navigate to="/upload" replace />;
	}
	return <>{children}</>;
}
