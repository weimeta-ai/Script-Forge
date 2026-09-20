// 登录/注册页共享右栏表单卡（Logo + 标题槽位 + 表单容器 + 底部版权）
// -----------------------------------------------------------------------------
// 职责（SOLID-S）：仅负责右栏容器与品牌头部
//   - 等高 + flex 垂直居中
//   - 统一渲染品牌 Logo（固定，非 props）
//   - 通过 props 暴露 eyebrow / title / subtitle 文案槽位
//   - children 为具体表单字段（Login/Register 各自传入）
// =============================================================================

import type { ReactNode } from 'react';

interface AuthFormCardProps {
	eyebrow: string;
	title: string;
	subtitle: string;
	children: ReactNode;
}

export function AuthFormCard({ eyebrow, title, subtitle, children }: AuthFormCardProps) {
	return (
		<aside
			className="animate-fade-up lg:min-h-[calc(100vh-48px)]"
			style={{
				margin: '10px',

				padding: '32px 28px',
				boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5)',
				display: 'flex',
				flexDirection: 'column',
				justifyContent: 'center',
			}}
		>
			<div className="flex flex-col">
				{/* 头部：Logo + 标题 */}
				<div className="mb-8 text-center">

					<div className="eyebrow mb-2">{eyebrow}</div>
					<h2
						className="font-serif text-[30px] font-bold"
						style={{
							color: 'var(--color-text)',
							lineHeight: 1.08,
							letterSpacing: '-0.02em',
						}}
					>
						{title}
					</h2>
					<p
						className="mt-2 font-sans text-sm"
						style={{ color: 'var(--color-text-muted)', lineHeight: 1.7 }}
					>
						{subtitle}
					</p>
				</div>

				{/* 表单内容（children） */}
				{children}

				{/* 底部：版权 */}
				<div
					className="mt-6 flex items-center justify-between pt-5 text-[11px]"
					style={{
						color: 'var(--color-text-subtle)',
						borderTop: '1px solid rgba(102,89,76,0.08)',
					}}
				>
					<span>© 唯元剧创</span>
					<div className="flex gap-3">
						<span style={{ opacity: 0.6 }}>隐私</span>
						<span style={{ opacity: 0.6 }}>条款</span>
					</div>
				</div>
			</div>
		</aside>
	);
}
