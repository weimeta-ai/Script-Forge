// 流程状态引导条组件（3 阶段：导入 → 分析 → 导出）
// -----------------------------------------------------------------------------
// 设计要点：
// - full 模式：Report 页用，sticky 顶部，含圆点连线 + 下一步 CTA 主按钮
// - compact 模式：History 卡片用，纵向步骤列表（每阶段一行：圆点+标签+状态），
//   阶段数多时自动纵向扩展，无视觉挤压；父组件传已查数据避免 N+1
// - 类型 / 纯函数 / 常量见 ../lib/pipeline.ts
// =============================================================================

import { ImagePlus, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useActiveTask, useReport, type ActiveTaskInfo } from '../api/scripts';
import {
	nextActionLabel,
	PHASE_LABEL,
	PHASE_ORDER,
	resolvePhases,
	type Phase,
	type PhaseState,
} from '../lib/pipeline';

interface FullProps {
	variant: 'full';
	scriptId: string;
	onExportClick: () => void;
	/** 可选：生成封面回调。传入时在 CTA 旁渲染次级按钮（仅 Report 页使用） */
	onCoverClick?: () => void;
	/** 封面区块是否展开（用于切换按钮文案） */
	coverOpen?: boolean;
	/** PDF 导出进行中（CTA 按钮 spinner + 禁用，给用户即时反馈） */
	exportLoading?: boolean;
}

interface CompactProps {
	variant: 'compact';
	scriptId: string;
	activeTask?: ActiveTaskInfo | null;
	hasAnalyzeScore: boolean;
	/** 主题：light 浅色背景用（默认）/ dark 深色背景用（History 卡片海报式悬浮） */
	theme?: 'light' | 'dark';
	/** 布局：vertical 纵向多行（默认）/ horizontal 横向单行圆点 */
	layout?: 'vertical' | 'horizontal';
}

type Props = FullProps | CompactProps;

export function PipelineStatusBar(props: Props) {
	if (props.variant === 'full') {
		return <FullBar {...props} />;
	}
	return <CompactBar {...props} />;
}

// ----- full 模式（Report 页）-----
function FullBar({
	scriptId,
	onExportClick,
	onCoverClick,
	coverOpen,
	exportLoading = false,
}: FullProps) {
	const navigate = useNavigate();
	const { data: reportData } = useReport(scriptId);
	const { data: activeData } = useActiveTask(scriptId);
	const activeTask = activeData?.analyzeTask ?? null;
	const coverTask = activeData?.coverTask ?? null;

	const hasScript = Boolean(reportData?.script);
	const hasAnalyzeScore = Boolean(
		reportData?.version?.scoreDetails?.score &&
		reportData.version.scoreDetails.score > 0,
	);

	const { states, current } = resolvePhases({
		hasScript,
		hasAnalyzeScore,
		analyzeTask: activeTask,
	});

	const coverRunning =
		!!coverTask &&
		(coverTask.status === 'running' || coverTask.status === 'pending');

	// 圆点点击：根据阶段 + 状态决定跳转
	function handlePhaseAction(phase: Phase) {
		if (phase === 'import') return;
		if (phase === 'analyze') {
			if (states.analyze === 'running' && activeTask) {
				navigate(
					`/analyzing-task/${activeTask.taskId}?scriptId=${scriptId}&phase=analyze`,
				);
			} else if (states.analyze === 'done') {
				navigate(`/report/${scriptId}?tab=report`);
			}
		} else if (phase === 'export') {
			onExportClick();
		}
	}

	return (
		<div
			className="pipeline-status-bar"
			style={{
				position: 'sticky',
				top: 0,
				zIndex: 40,
				marginBottom: 20,
				padding: '14px 22px',
				borderRadius: 14,
				background: 'rgba(255,251,247,0.96)',
				border: '1px solid rgba(184,68,60,0.12)',
				boxShadow: '0 6px 24px rgba(102,89,76,0.08)',
				display: 'flex',
				alignItems: 'center',
				gap: 22,
				flexWrap: 'wrap',
			}}
		>
			<div
				className="font-sans"
				style={{
					fontSize: 11,
					letterSpacing: '0.18em',
					color: '#8B7B6A',
					textTransform: 'uppercase',
				}}
			>
				Pipeline
			</div>

			{/* 圆点 + 连线 */}
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: 0,
					flex: '1 1 auto',
					minWidth: 280,
				}}
			>
				{PHASE_ORDER.map((phase, idx) => {
					const state = states[phase];
					const isCurrent = phase === current;
					const clickable =
						phase !== 'import' &&
						(state === 'done' || state === 'running' || phase === 'export');
					return (
						<div
							key={phase}
							style={{
								display: 'flex',
								alignItems: 'center',
								flex: idx === PHASE_ORDER.length - 1 ? '0 0 auto' : '1 1 auto',
							}}
						>
							<button
								type="button"
								onClick={() => clickable && handlePhaseAction(phase)}
								disabled={!clickable}
								aria-label={`阶段：${PHASE_LABEL[phase]}`}
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: 8,
									background: 'transparent',
									border: 'none',
									padding: 0,
									cursor: clickable ? 'pointer' : 'default',
								}}
							>
								<Dot state={state} isCurrent={isCurrent} />
								<span
									className="font-sans"
									style={{
										fontSize: 13,
										fontWeight: isCurrent ? 600 : 500,
										color: isCurrent
											? '#1C1815'
											: state === 'done'
												? '#66594C'
												: '#8B7B6A',
									}}
								>
									{PHASE_LABEL[phase]}
								</span>
							</button>
							{idx < PHASE_ORDER.length - 1 && <Connector />}
						</div>
					);
				})}
			</div>

			{/* 右侧操作组：生成封面（可选）+ 下一步 CTA */}
			<div
				style={{
					display: 'inline-flex',
					alignItems: 'center',
					gap: 10,
				}}
			>
				{onCoverClick && (
					<button
						type="button"
						onClick={onCoverClick}
						className="btn-ghost font-sans"
						style={{
							height: 36,
							padding: '0 14px',
							fontSize: 13,
							fontWeight: 500,
							letterSpacing: '0.04em',
							whiteSpace: 'nowrap',
							display: 'inline-flex',
							alignItems: 'center',
							gap: 6,
						}}
					>
						<ImagePlus size={14} strokeWidth={2} />
						{coverOpen ? '收起封面' : '生成封面'}
						{coverRunning && (
							<span
								aria-label="封面生成中"
								style={{
									width: 6,
									height: 6,
									borderRadius: '50%',
									background: '#B8443C',
									marginLeft: 2,
									boxShadow: '0 0 0 3px rgba(184,68,60,0.18)',
									animation:
										'pipeline-pulse 1.4s ease-out infinite',
								}}
							/>
						)}
					</button>
				)}

				{/* 下一步 CTA */}
				<button
					type="button"
					onClick={() => handlePhaseAction(current)}
					disabled={exportLoading}
					className="btn-primary font-sans"
					style={{
						height: 36,
						padding: '0 16px',
						fontSize: 13,
						fontWeight: 600,
						letterSpacing: '0.04em',
						whiteSpace: 'nowrap',
						display: 'inline-flex',
						alignItems: 'center',
						gap: 6,
						opacity: exportLoading ? 0.7 : 1,
						cursor: exportLoading ? 'wait' : 'pointer',
					}}
				>
					{exportLoading && current === 'export' ? (
						<>
							<Loader2 size={14} strokeWidth={2.4} className="animate-spin" />
							正在导出…
						</>
					) : (
						<>{nextActionLabel(current, states)} →</>
					)}
				</button>
			</div>
		</div>
	);
}

// ----- compact 模式（History 卡片）-----
function CompactBar({
	activeTask,
	hasAnalyzeScore,
	scriptId,
	theme = 'light',
	layout = 'vertical',
}: CompactProps) {
	const { states, current } = resolvePhases({
		hasScript: true,
		hasAnalyzeScore,
		analyzeTask: activeTask,
	});
	const currentCalc = activeTask?.status === 'running' ? 'analyze' : null;
	const progress = activeTask?.progress;

	// 主题色板：light（浅色背景）/ dark（深色图片背景）
	const palette =
		theme === 'dark'
			? {
				labelCurrent: '#FFFBF5',
				labelDone: 'rgba(255,251,247,0.92)',
				labelPending: 'rgba(255,251,247,0.72)',
				monoCurrent: '#FFB8A8',
				monoDone: 'rgba(255,251,247,0.78)',
				monoPending: 'rgba(255,251,247,0.65)',
			}
			: {
				labelCurrent: '#1C1815',
				labelDone: '#66594C',
				labelPending: '#8B7B6A',
				monoCurrent: '#C95A4F',
				monoDone: '#8B7B6A',
				monoPending: '#A89A8A',
			};

	// 横向单行圆点布局：5 圆点 + 连线 + 右侧当前阶段文字
	if (layout === 'horizontal') {
		const isRunning = currentCalc === 'analyze';
		const statusText = isRunning
			? progress !== undefined
				? `${PHASE_LABEL.analyze} ${progress}%`
				: `${PHASE_LABEL.analyze} 运行中`
			: hasAnalyzeScore
				? `${PHASE_LABEL.analyze} 已完成`
				: `${PHASE_LABEL.analyze} 待开启`;

		return (
			<div
				aria-label="流程状态"
				data-script-id={scriptId}
				className="flex items-center"
				style={{ gap: 10 }}
			>
				<div
					className="flex items-center"
					style={{ flex: '0 0 auto', gap: 0 }}
				>
					{PHASE_ORDER.map((phase, idx) => {
						const state = states[phase];
						const isCurrent = currentCalc === phase;
						return (
							<div
								key={phase}
								className="flex items-center"
								style={{
									flex: idx === PHASE_ORDER.length - 1 ? '0 0 auto' : '1 1 auto',
								}}
							>
								<Dot state={state} isCurrent={isCurrent} size="sm" />
								{idx < PHASE_ORDER.length - 1 && <Connector size="sm" />}
							</div>
						);
					})}
				</div>
				<span
					className="font-mono"
					style={{
						flex: '1 1 auto',
						fontSize: 11,
						color: isRunning ? palette.monoCurrent : palette.monoPending,
						whiteSpace: 'nowrap',
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						letterSpacing: '0.02em',
					}}
				>
					{statusText}
				</span>
			</div>
		);
	}

	// 纵向多行布局（原默认）
	return (
		<div
			aria-label="流程状态"
			data-script-id={scriptId}
			style={{
				display: 'flex',
				flexDirection: 'column',
				gap: 2,
				marginTop: 12,
			}}
		>
			{PHASE_ORDER.map((phase) => {
				const state = states[phase];
				const isCurrent = currentCalc === phase;
				const isDim = state === 'pending' && !isCurrent;
				void current; // current 在纵向布局暂未使用，保留 resolvePhases 返回值一致性

				const statusText =
					state === 'done'
						? '✓ 完成'
						: state === 'running'
							? progress !== undefined
								? `${progress}%`
								: '运行中'
							: '待开启';

				return (
					<div
						key={phase}
						style={{
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'space-between',
							gap: 8,
							padding: '2px 0',
							opacity: isDim ? 0.5 : 1,
						}}
					>
						<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
							<Dot state={state} isCurrent={isCurrent} size="sm" />
							<span
								className="font-sans"
								style={{
									fontSize: 11,
									fontWeight: isCurrent ? 600 : 500,
									color: isCurrent
										? palette.labelCurrent
										: state === 'done'
											? palette.labelDone
											: palette.labelPending,
								}}
							>
								{PHASE_LABEL[phase]}
							</span>
						</div>
						<span
							className="font-mono"
							style={{
								fontSize: 10,
								color: isCurrent
									? palette.monoCurrent
									: state === 'done'
										? palette.monoDone
										: palette.monoPending,
								whiteSpace: 'nowrap',
								letterSpacing: '0.02em',
							}}
						>
							{statusText}
						</span>
					</div>
				);
			})}
		</div>
	);
}

// =============================================================================
// 子组件：圆点 / 连线
// =============================================================================

function Dot({
	state,
	isCurrent,
	size = 'md',
}: {
	state: PhaseState;
	isCurrent: boolean;
	size?: 'sm' | 'md';
}) {
	const dim = size === 'sm' ? 10 : 14;
	const color =
		state === 'done'
			? '#B8443C'
			: state === 'running'
				? '#C95A4F'
				: '#A89A8A';
	const ringColor =
		state === 'done'
			? 'rgba(184,68,60,0.18)'
			: state === 'running'
				? 'rgba(201,90,79,0.22)'
				: 'rgba(168,154,138,0.18)';

	return (
		<span
			style={{
				position: 'relative',
				display: 'inline-flex',
				alignItems: 'center',
				justifyContent: 'center',
				width: dim,
				height: dim,
			}}
		>
			{state === 'running' && (
				<span
					style={{
						position: 'absolute',
						inset: -4,
						borderRadius: '50%',
						border: `1.5px solid ${ringColor}`,
						animation: 'pipeline-pulse 1.4s ease-out infinite',
					}}
				/>
			)}
			<span
				style={{
					width: dim,
					height: dim,
					borderRadius: '50%',
					background: state === 'pending' ? 'transparent' : color,
					border: `1.5px solid ${color}`,
					boxShadow:
						isCurrent && state !== 'pending' ? `0 0 0 3px ${ringColor}` : 'none',
					transition: 'all 240ms cubic-bezier(0.22,1,0.36,1)',
				}}
			/>
		</span>
	);
}

function Connector({ size = 'md' }: { size?: 'sm' | 'md' }) {
	const h = size === 'sm' ? 1.5 : 2;
	return (
		<div
			style={{
				flex: '1 1 auto',
				height: h,
				minWidth: size === 'sm' ? 12 : 24,
				maxWidth: size === 'sm' ? 24 : 60,
				background:
					'linear-gradient(90deg, rgba(184,68,60,0.32), rgba(168,154,138,0.24))',
				borderRadius: h,
				margin: size === 'sm' ? '0 4px' : '0 8px',
			}}
		/>
	);
}
