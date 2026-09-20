// 登录/注册页共享左栏（轮播主视觉 + 底部品牌信息条）
// -----------------------------------------------------------------------------
// 职责（SOLID-S）：仅负责左栏视觉呈现
//   - 拉取后台上传的启用轮播（useActiveBanners）
//   - 三态渲染：有数据 → LoginCarousel；加载中 → Loader2；空 → 静态 loginBg 兜底
//   - 底部品牌信息条（v1.0 · © 唯元剧创）
// =============================================================================

import { Loader2 } from 'lucide-react';
import { useActiveBanners } from '../../api/login-banner';
import loginBg from '../../assets/login.jpg';
import { LoginCarousel } from '../LoginCarousel';

export function AuthLeftPanel() {
	const { data: banners, isLoading: bannersLoading } = useActiveBanners();

	return (
		<section
			className="panel-paper lg:min-h-[calc(100vh-48px)]"
			style={{
				margin: '10px',
				padding: '28px 30px',
				overflow: 'hidden',
				position: 'relative',
			}}
		>
			{/* 装饰背景层 */}
			<div
				style={{
					position: 'absolute',
					inset: 0,
					pointerEvents: 'none',
				}}
			/>

			<div className="relative z-10 flex h-full flex-col">
				{/* 主视觉：轮播图（后台上传 → OSS → 登录页展示；空时回退到静态图） */}
				<div
					className="relative mt-5 flex-1 overflow-hidden"
					style={{
						minHeight: '280px',
						borderRadius: '16px',
						border: '1px solid rgba(102,89,76,0.12)',
						boxShadow: '0 12px 32px -14px rgba(28,24,21,0.22)',
					}}
				>
					{banners && banners.length > 0 ? (
						<LoginCarousel banners={banners} />
					) : bannersLoading ? (
						<div
							className="absolute inset-0 flex items-center justify-center"
							style={{ background: 'rgba(28,24,21,0.04)' }}
						>
							<Loader2
								size={28}
								className="animate-spin"
								style={{ color: 'var(--color-text-subtle)' }}
							/>
						</div>
					) : (
						<>
							<img
								src={loginBg}
								alt="剧本审片工作台主视觉"
								className="absolute inset-0 h-full w-full object-cover"
								style={{ filter: 'saturate(0.94) contrast(1.02)' }}
							/>
							{/* 底部渐变压暗：增强胶片感 */}
							<div
								className="absolute inset-0"
								style={{
									background:
										'linear-gradient(180deg, transparent 55%, rgba(28,24,21,0.22) 100%)',
									pointerEvents: 'none',
								}}
							/>
						</>
					)}
				</div>

				{/* 底部：品牌信息（mt-auto 推到底） */}
				<div
					className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-6 text-[11px]"
					style={{
						color: 'var(--color-text-subtle)',
						borderTop: '1px solid rgba(102,89,76,0.08)',
					}}
				>
					<span>v1.0 · 专为剧本审片流程打造</span>
					<span>© 唯元剧创</span>
				</div>
			</div>
		</section>
	);
}
