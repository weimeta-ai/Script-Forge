// 登录页极简轮播组件
// -----------------------------------------------------------------------------
// 交互（极简版）：
//   - 自动播放：5 秒切换
//   - 底部圆点指示器：点击切换
//   - 切换效果：opacity 淡入淡出（图片绝对定位堆叠）
//
// 边界：
//   - banners 为空 → 不渲染（由父组件兜底回退到静态图）
//   - 单张 → 仅静态展示，无圆点
//   - banners 长度变化（删除/新增）→ 自动修正 index
// =============================================================================

import { useEffect, useState } from 'react';
import type { LoginBanner } from '../types/login-banner';

const AUTO_PLAY_INTERVAL = 5000;

interface Props {
	banners: LoginBanner[];
}

export function LoginCarousel({ banners }: Props) {
	const [current, setCurrent] = useState(0);
	const length = banners.length;

	// 渲染时取模推算安全 index（banners 变化导致 current 越界时自动归位，无需 setState 修正）
	const safeIndex = length === 0 ? 0 : current % length;

	// 自动播放（length > 1 时启用）
	useEffect(() => {
		if (length <= 1) return;
		const timer = setInterval(() => {
			setCurrent((prev) => (prev + 1) % length);
		}, AUTO_PLAY_INTERVAL);
		return () => clearInterval(timer);
	}, [length]);

	if (length === 0) return null;

	return (
		<div
			style={{
				position: 'absolute',
				inset: 0,
				overflow: 'hidden',
			}}
		>
			{/* 图片层：所有图绝对定位堆叠，opacity 切换 */}
			{banners.map((banner, idx) => (
				<img
					key={banner.id}
					src={banner.imageUrl}
					alt={banner.title ?? '轮播图'}
					className="absolute inset-0 h-full w-full object-cover"
					style={{
						filter: 'saturate(0.94) contrast(1.02)',
						opacity: idx === safeIndex ? 1 : 0,
						transition: 'opacity 800ms ease-in-out',
						pointerEvents: idx === safeIndex ? 'auto' : 'none',
					}}
					draggable={false}
				/>
			))}

			{/* 底部渐变压暗（保留与原 Login 一致的胶片感） */}
			<div
				className="absolute inset-0"
				style={{
					background:
						'linear-gradient(180deg, transparent 55%, rgba(28,24,21,0.22) 100%)',
					pointerEvents: 'none',
				}}
			/>

			{/* 圆点指示器（单张时不展示） */}
			{length > 1 && (
				<div
					style={{
						position: 'absolute',
						bottom: 14,
						left: '50%',
						transform: 'translateX(-50%)',
						display: 'flex',
						gap: 6,
						zIndex: 2,
					}}
				>
					{banners.map((banner, idx) => {
						const isActive = idx === safeIndex;
						return (
							<button
								key={banner.id}
								type="button"
								onClick={() => setCurrent(idx)}
								aria-label={`切换到第 ${idx + 1} 张`}
								aria-current={isActive ? 'true' : undefined}
								style={{
									width: isActive ? 18 : 6,
									height: 6,
									borderRadius: 3,
									border: 'none',
									padding: 0,
									cursor: 'pointer',
									background: isActive
										? 'rgba(255,255,255,0.92)'
										: 'rgba(255,255,255,0.42)',
									boxShadow: '0 1px 2px rgba(0,0,0,0.18)',
									transition: 'all 280ms ease',
								}}
							/>
						);
					})}
				</div>
			)}
		</div>
	);
}
