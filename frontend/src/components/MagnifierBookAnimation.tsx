// 放大镜翻书动画：替换「当前阶段」卡片的纯文本展示
// 视觉：一本翻开的纸质剧本 + 放大镜悬浮扫描，按 task.status 切换四态
// 状态：running 扫描 / done ✓ / error 抖动✗ / canceled 降饱和静止
import { motion } from 'motion/react'
import { easeSnappy } from '../lib/animations'

export type BookAnimStatus = 'running' | 'done' | 'error' | 'canceled'

interface Props {
	status: BookAnimStatus
}

// 配色随状态切换：error 边框转深红、canceled 整体降饱和
function getColors(status: BookAnimStatus) {
	if (status === 'error') {
		return {
			pageFill: '#fdf6ec',
			pageStroke: 'rgba(184,68,60,0.45)',
			spineColor: 'rgba(184,68,60,0.55)',
			textColor: 'rgba(184,68,60,0.35)',
			frameColor: '#7a2e29'
		}
	}
	if (status === 'canceled') {
		return {
			pageFill: '#f5efe6',
			pageStroke: 'rgba(102,89,76,0.2)',
			spineColor: 'rgba(102,89,76,0.25)',
			textColor: 'rgba(102,89,76,0.22)',
			frameColor: '#a89a8a'
		}
	}
	return {
		pageFill: '#fdf6ec',
		pageStroke: 'rgba(184,68,60,0.18)',
		spineColor: 'rgba(184,68,60,0.32)',
		textColor: 'rgba(102,89,76,0.3)',
		frameColor: '#8b6f5a'
	}
}

const TEXT_LINES = [86, 98, 110, 122, 134]

const ARIA_LABEL: Record<BookAnimStatus, string> = {
	running: '正在翻阅剧本进行分析',
	done: '剧本分析已完成',
	error: '剧本分析异常',
	canceled: '剧本分析已停止'
}

export function MagnifierBookAnimation({ status }: Props) {
	const colors = getColors(status)
	const isRunning = status === 'running'
	const isError = status === 'error'
	const isCanceled = status === 'canceled'
	const isDone = status === 'done'

	return (
		<motion.svg
			viewBox="0 0 260 170"
			width="100%"
			role="img"
			aria-label={ARIA_LABEL[status]}
			style={{ display: 'block' }}
			initial={{ opacity: 0 }}
			animate={{ opacity: isCanceled ? 0.78 : 1 }}
			transition={{ duration: 0.3, ease: easeSnappy }}
		>
			<title>{ARIA_LABEL[status]}</title>

			{/* 桌面阴影 */}
			<ellipse
				cx={130}
				cy={162}
				rx={96}
				ry={4}
				fill="rgba(102,89,76,0.1)"
			/>

			{/* 书脊厚度（左侧暗色边） */}
			<path
				d="M 40 70 L 33 76 L 33 150 L 40 145 Z"
				fill={colors.frameColor}
				opacity={0.55}
			/>

			{/* 左页 */}
			<path
				d="M 130 60 L 40 70 L 40 145 L 130 155 Z"
				fill={colors.pageFill}
				stroke={colors.pageStroke}
				strokeWidth={1.2}
				strokeLinejoin="round"
			/>
			{/* 左页文字横线 */}
			{TEXT_LINES.map((y, i) => (
				<line
					key={`l-${i}`}
					x1={50}
					y1={y}
					x2={120}
					y2={y}
					stroke={colors.textColor}
					strokeWidth={2}
					strokeLinecap="round"
				/>
			))}

			{/* 右页 */}
			<path
				d="M 130 60 L 220 70 L 220 145 L 130 155 Z"
				fill={colors.pageFill}
				stroke={colors.pageStroke}
				strokeWidth={1.2}
				strokeLinejoin="round"
			/>
			{/* 右页文字横线 */}
			{TEXT_LINES.map((y, i) => (
				<line
					key={`r-${i}`}
					x1={140}
					y1={y}
					x2={210}
					y2={y}
					stroke={colors.textColor}
					strokeWidth={2}
					strokeLinecap="round"
				/>
			))}

			{/* 中缝 */}
			<line
				x1={130}
				y1={60}
				x2={130}
				y2={155}
				stroke={colors.spineColor}
				strokeWidth={1.5}
			/>

			{/* 翻页纸角：仅 running 偶尔翘起，强化「翻阅」感 */}
			<motion.path
				d="M 220 70 L 220 92 L 198 70 Z"
				fill={colors.pageFill}
				stroke={colors.pageStroke}
				strokeWidth={1}
				strokeLinejoin="round"
				initial={false}
				animate={
					isRunning
						? { opacity: [0, 1, 0], scaleX: [0.5, 1, 0.5] }
						: { opacity: 0 }
				}
				transition={{
					duration: 1.6,
					repeat: Infinity,
					repeatDelay: 2.8,
					ease: 'easeInOut'
				}}
				style={{ transformOrigin: '220px 70px' }}
			/>

			{/* 放大镜组：沿矩形轨迹扫描书页中部 */}
			<motion.g
				initial={false}
				animate={
					isRunning
						? { x: [18, 18, -42, -42, 18], y: [-6, 10, 10, -6, -6] }
						: isError
							? { x: [0, -2.5, 2.5, -2.5, 0], y: [0, 1, -1, 0, 0] }
							: { x: 25, y: 20 }
				}
				transition={
					isRunning
						? { duration: 5.5, repeat: Infinity, ease: 'easeInOut' }
						: isError
							? { duration: 0.4, repeat: Infinity, ease: 'linear' }
							: { duration: 0.4, ease: easeSnappy }
				}
			>
				{/* 手柄 */}
				<line
					x1={186}
					y1={94}
					x2={206}
					y2={74}
					stroke={colors.frameColor}
					strokeWidth={4.5}
					strokeLinecap="round"
				/>
				<circle cx={207} cy={73} r={3.8} fill={colors.frameColor} />
				{/* 镜框 */}
				<circle
					cx={170}
					cy={110}
					r={22}
					fill="rgba(255,255,255,0.22)"
					stroke={colors.frameColor}
					strokeWidth={3}
				/>
				{/* 镜片高光 */}
				<path
					d="M 156 100 Q 158 96 164 95"
					stroke="rgba(255,255,255,0.75)"
					strokeWidth={2}
					fill="none"
					strokeLinecap="round"
				/>
			</motion.g>

			{/* 完成标记：done 弹出 ✓ */}
			{isDone && (
				<motion.g
					initial={{ scale: 0, opacity: 0 }}
					animate={{ scale: 1, opacity: 1 }}
					transition={{ duration: 0.32, ease: easeSnappy }}
					style={{ transformOrigin: '225px 42px' }}
				>
					<circle cx={225} cy={42} r={15} fill="#B8443C" />
					<path
						d="M 218.5 42 L 223 46.5 L 231.5 38"
						stroke="white"
						strokeWidth={3}
						fill="none"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</motion.g>
			)}

			{/* 异常标记：error 弹出 ✗ */}
			{isError && (
				<motion.g
					initial={{ scale: 0, opacity: 0 }}
					animate={{ scale: 1, opacity: 1 }}
					transition={{ duration: 0.32, ease: easeSnappy }}
					style={{ transformOrigin: '225px 42px' }}
				>
					<circle cx={225} cy={42} r={15} fill="#B8443C" />
					<path
						d="M 220 37.5 L 230 46.5 M 230 37.5 L 220 46.5"
						stroke="white"
						strokeWidth={3}
						fill="none"
						strokeLinecap="round"
					/>
				</motion.g>
			)}
		</motion.svg>
	)
}
