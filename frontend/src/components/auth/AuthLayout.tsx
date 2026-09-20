// 登录/注册页共享外层壳（GridBackground + 双栏 grid + 共享左栏 + children 右栏）
// -----------------------------------------------------------------------------
// 职责（SOLID-S）：仅负责页面级布局容器
//   - 暖白纸质背景 + 网格装饰
//   - 1.2fr : 440px 双栏 grid 容器（左大右小）
//   - 自动渲染共享左栏（AuthLeftPanel）
//   - children 为右栏表单卡（AuthFormCard）
// =============================================================================

import type { ReactNode } from 'react';
import { GridBackground } from '../shell';
import { AuthLeftPanel } from './AuthLeftPanel';

interface AuthLayoutProps {
	children: ReactNode;
}

export function AuthLayout({ children }: AuthLayoutProps) {
	return (
		<div
			className="px-4 py-4 md:px-6 md:py-6"
			style={{
				position: 'relative',
				minHeight: '100vh',
			}}
		>
			<GridBackground />
			<div
				className="mx-auto grid w-full max-w-[1400px] gap-0 overflow-hidden rounded-[16px] min-h-[calc(100vh-32px)] md:min-h-[calc(100vh-48px)] md:grid-cols-[minmax(0,_1.2fr)_440px]"
				style={{
					position: 'relative',
					zIndex: 1,
				}}
			>
				<AuthLeftPanel />
				{children}
			</div>
		</div>
	);
}
