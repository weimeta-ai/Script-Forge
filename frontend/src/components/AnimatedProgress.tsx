// 进度条组件：motion/react useSpring 驱动 width + 数字滚动 + 流光/斜纹/边缘脉冲四类动画
// -----------------------------------------------------------------------------
// 使用：
//   <AnimatedProgress value={overall} height={10} showStripes />
//   <AnimatedProgress.Label value={overall} />  // spring 滚动数字
// 设计要点：
// - 完成（value >= 100）/ 错误态自动停止装饰动画，避免视觉噪音
// - 沿用项目红→米黄渐变；spring 物理让进度推进有「有机感」
// - MotionConfig reducedMotion="user" 已在 App.tsx 解禁，用户系统开启「减少动态效果」会自动遵守
// Spring 配置说明：
// - stiffness 60 + damping 18 + mass 1.2：偏柔，避免大跨度跳变（0→19）时的瞬间加速
// - 比纯 easeOutQuart 更接近「物体被推动」的物理直觉
// =============================================================================

import { useEffect, type CSSProperties } from 'react';
import {
	motion,
	useMotionValue,
	useSpring,
	useTransform,
} from 'motion/react';

const SPRING_CONFIG = {
	stiffness: 60,
	damping: 18,
	mass: 1.2,
} as const;

type AnimatedProgressProps = {
	value: number;
	/** 条高（px），默认 8 */
	height?: number;
	/** 是否显示流光扫过（默认 true） */
	showShimmer?: boolean;
	/** 是否显示斜纹流动（默认 false，小尺寸条建议关闭） */
	showStripes?: boolean;
	/** 是否显示前沿脉冲发光（默认 true，小尺寸条建议关闭） */
	showEdgeGlow?: boolean;
	/** 错误态：渲染纯红色、关闭动画 */
	isError?: boolean;
	/** 自定义 className（用于覆盖样式时使用） */
	className?: string;
	/** 自定义内联样式（透传到 track 容器） */
	style?: CSSProperties;
};

export function AnimatedProgress({
	value,
	height = 8,
	showShimmer = true,
	showStripes = false,
	showEdgeGlow = true,
	isError = false,
	className,
	style,
}: AnimatedProgressProps) {
	const target = Math.max(0, Math.min(100, value));
	// 初始 0：首帧从 0 滑到目标值，避免 useState(target) 即终值不触发动画
	const mv = useMotionValue(0);
	const spring = useSpring(mv, SPRING_CONFIG);
	const widthPct = useTransform(spring, (v) => `${v}%`);

	useEffect(() => {
		mv.set(target);
	}, [target, mv]);

	const isComplete = target >= 100;
	const isRunning = !isComplete && !isError;

	const trackStyle: CSSProperties = {
		height,
		borderRadius: '999px',
		background: 'rgba(102,89,76,0.08)',
		overflow: 'hidden',
		position: 'relative',
		...style,
	};

	return (
		<div
			className={className}
			style={trackStyle}
			role="progressbar"
			aria-valuenow={target}
			aria-valuemin={0}
			aria-valuemax={100}
		>
			{/* motion.div 直接订阅 MotionValue，绕过 React 渲染循环，性能优于 RAF+setState */}
			<motion.div
				style={{
					width: widthPct,
					height: '100%',
					borderRadius: '999px',
					background: isError
						? '#B8443C'
						: 'linear-gradient(90deg, #B8443C 0%, #C95A4F 55%, #E6B58A 100%)',
					position: 'relative',
					overflow: 'hidden',
				}}
			>
				{isRunning && showStripes && <span className="progress-stripes" />}
				{isRunning && showShimmer && <span className="progress-shimmer" />}
			</motion.div>
			{isRunning && showEdgeGlow && (
				<motion.span
					className="progress-edge-glow"
					style={{ left: widthPct }}
				/>
			)}
		</div>
	);
}

// 数字标签（百分比）：用同一份 spring 配置，保证 width 与数字完全同步
AnimatedProgress.Label = function ProgressLabel({
	value,
	suffix = '%',
	style,
}: {
	value: number;
	suffix?: string;
	style?: CSSProperties;
}) {
	const mv = useMotionValue(0);
	const spring = useSpring(mv, SPRING_CONFIG);
	const text = useTransform(spring, (v) => `${Math.round(v)}${suffix}`);

	useEffect(() => {
		mv.set(value);
	}, [value, mv]);

	return <motion.span style={style}>{text}</motion.span>;
};
