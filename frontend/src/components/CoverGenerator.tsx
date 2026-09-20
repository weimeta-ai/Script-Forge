// 封面生成器（模态框 + 3 张候选 + 选定交互）
// -----------------------------------------------------------------------------
// 数据流（异步 + 持久化）：
//   - 父组件传 scriptId / title / initialCoverUrl（来自 script.coverUrl，已选定项）
//     以及 initialCandidates（来自 script.coverUrlCandidates，历史候选）
//   - 点击「立即生成 / 重新生成」→ useTriggerCover → 得到 taskId → useTaskStatus 轮询事件
//   - 后台 worker：generateImage(count=3) → 循环 uploadImageFromUrl → 写 coverUrlCandidates → 推 cover_done
//   - 前端监听 cover_done.coverUrls 渲染 3 张候选；用户点候选 → 弹内嵌确认气泡 →
//     点「确认」才调 useSelectCover 持久化 → onClose（点「取消」或别的候选仅切 pending 态）
//   - 关闭弹框任务仍在后台跑（服务端真相），完成时 toast 通知用户回来选定
//
// 进度算法（后端无中间事件，前端模拟）：
//   - 0%   触发瞬间
//   - 5–35%  等待 worker 接手（线性爬升 2s）
//   - 40–85% 收到 cover_start 后缓慢爬升（封顶等待真实完成）
//   - 100%  收到 cover_done
// =============================================================================

import { useQueryClient } from '@tanstack/react-query'
import {
	AlertCircle,
	Check,
	Image as ImageIcon,
	Loader2,
	RefreshCw,
	X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
	scriptKeys,
	useActiveTask,
	useSelectCover,
	useTaskStatus,
	useTriggerCover
} from '../api/scripts'
import { toast } from '../store/toast'

interface CoverGeneratorProps {
	scriptId: string
	title: string
	/** 来自 script.coverUrl，已选定的封面（首次打开就高亮在候选里） */
	initialCoverUrl?: string | null
	/** 来自 script.coverUrlCandidates，历史候选（打开时直接可见，不必重新生成） */
	initialCandidates?: string[]
	/** 受控展开状态（Hero 按钮触发） */
	open: boolean
	onClose: () => void
}

type Stage = 'idle' | 'queued' | 'generating' | 'uploading' | 'done' | 'error'

// 已用时格式化：60s 内「42 秒」，之后「1 分 12 秒」
function formatElapsed(sec: number): string {
	if (sec < 60) return `${sec} 秒`
	return `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`
}

export function CoverGenerator({
	scriptId,
	title,
	initialCoverUrl,
	initialCandidates,
	open,
	onClose
}: CoverGeneratorProps) {
	const [errMsg, setErrMsg] = useState<string | null>(null)
	const [displayProgress, setDisplayProgress] = useState(0)
	const [selectedUrl, setSelectedUrl] = useState<string | null>(initialCoverUrl ?? null)
	// 待确认选定的候选 URL：点击候选图时标记，二次确认后才真正调用 select 接口
	const [pendingUrl, setPendingUrl] = useState<string | null>(null)
	// cover_done 防重 invalidate 标记（按 taskId 去重，同一任务只刷一次 report）
	const invalidatedRef = useRef<string | null>(null)
	// 已耗时（秒）：长等待阶段给用户真实时间感，比假百分比更诚实
	const [elapsedSec, setElapsedSec] = useState(0)
	// 本组件触发过的任务 id：弹框关闭后任务完成时，据此识别"该提醒用户回来选定"
	const generatedTaskIdRef = useRef<string | null>(null)
	// done toast 防重标记（按 taskId 去重）
	const doneNotifiedRef = useRef<string | null>(null)
	const triggerMutation = useTriggerCover()
	const selectMutation = useSelectCover(scriptId)
	const queryClient = useQueryClient()

	// 任务态来源：useActiveTask 的 coverTask（服务端真相），关闭弹框/刷新/跨页面都不丢
	const { data: activeData } = useActiveTask(scriptId)
	const coverTask = activeData?.coverTask ?? null
	const taskId = coverTask?.taskId ?? null
	const statusQuery = useTaskStatus(scriptId, taskId ?? undefined)

	const events = useMemo(
		() => statusQuery.data?.events ?? [],
		[statusQuery.data?.events]
	)
	const coverDoneEvent = useMemo(
		() => events.find((e) => e.type === 'cover_done'),
		[events]
	)
	const coverStartEvent = useMemo(
		() => events.find((e) => e.type === 'cover_start'),
		[events]
	)
	const coverErrorEvent = useMemo(
		() => events.find((e) => e.type === 'cover_error'),
		[events]
	)

	// 候选来源优先级：本轮生成事件 > 父组件传入的历史候选
	const candidates: string[] = coverDoneEvent?.coverUrls ?? initialCandidates ?? []

	const taskStatus = statusQuery.data?.task?.status
	// 续接场景：刷新/重开后 statusQuery 首次渲染时 taskStatus 为 undefined，
	// 不能因此判为「未在跑」——只要 taskId 存在且非终态，就视为 running，让进度条立即可见
	const isRunning =
		taskId !== null &&
		taskStatus !== 'done' &&
		taskStatus !== 'error' &&
		taskStatus !== 'canceled'

	// 阶段判定（驱动文案 + 进度上限）
	const stage: Stage = coverErrorEvent
		? 'error'
		: coverDoneEvent
			? 'done'
			: isRunning
				? coverStartEvent
					? 'uploading'
					: 'generating'
				: taskId
					? 'queued'
					: 'idle'

	const effectiveError =
		coverErrorEvent?.message ?? triggerMutation.error?.message ?? errMsg

	// 触发后启动假进度爬升（5% → 35%），cover_start 后再爬升到 85%
	// 续接场景：刷新/重开后 displayProgress 复位为 0，需同步 coverTask.progress 起步
	useEffect(() => {
		if (!taskId) {
			setDisplayProgress(0)
			return
		}
		if (stage === 'done') {
			setDisplayProgress(100)
			return
		}
		if (stage === 'error') {
			return // 保留当前进度，不爬升
		}
		// 后端真实进度优先：displayProgress 落后于真实值时立即拉齐，避免从 0 重爬
		const realProgress = coverTask?.progress ?? 0
		if (realProgress > 0) {
			setDisplayProgress((p) => Math.max(p, realProgress))
		}
		// 上限：queued=35, generating=70, uploading=85
		const ceiling =
			stage === 'queued' ? 35 : stage === 'generating' ? 70 : 85
		const timer = setInterval(() => {
			setDisplayProgress((p) => {
				if (p >= ceiling) return p
				// 越接近上限爬得越慢（指数衰减）
				const remain = ceiling - p
				const step = Math.max(0.5, remain * 0.08)
				return Math.min(ceiling, p + step)
			})
		}, 240)
		return () => clearInterval(timer)
	}, [taskId, stage, coverTask?.progress])

	// 已耗时计时：coverTask.startedAt 优先（服务端真相，乐观写入时即有值）
	// done/error 时冻结在最后值（展示总耗时）；taskId 清空时无需重置——
	// 显示条件 showElapsed 同步为 false，下次生成由 interval 首次 tick 覆盖
	useEffect(() => {
		if (!taskId) return
		if (stage === 'done' || stage === 'error') return
		const startedAtMs = coverTask?.startedAt
			? new Date(coverTask.startedAt).getTime()
			: Date.now()
		const timer = setInterval(() => {
			setElapsedSec(Math.floor((Date.now() - startedAtMs) / 1000))
		}, 1000)
		return () => clearInterval(timer)
	}, [taskId, stage, coverTask?.startedAt])

	// cover_done 首次出现时刷新 report + detail：让报告页封面卡立刻拿到候选数组
	// 否则用户在弹框里生成完未选定就关闭，报告页 useReport 缓存仍为旧值，徽章逻辑不生效
	useEffect(() => {
		if (!coverDoneEvent || !taskId) return
		if (invalidatedRef.current === taskId) return
		invalidatedRef.current = taskId
		queryClient.invalidateQueries({ queryKey: scriptKeys.detail(scriptId) })
		queryClient.invalidateQueries({ queryKey: scriptKeys.report(scriptId) })
		// 弹框已关闭 + 任务由本组件触发：toast 唤回用户选定封面
		if (
			!open &&
			generatedTaskIdRef.current === taskId &&
			doneNotifiedRef.current !== taskId
		) {
			doneNotifiedRef.current = taskId
			toast.success('封面候选已生成完毕，回到报告页即可挑选心仪的封面')
		}
	}, [coverDoneEvent, taskId, scriptId, queryClient, open])

	// 关闭时重置 UI 态（不清任务引用：taskId 来自 useActiveTask，由服务端真相决定）
	useEffect(() => {
		if (!open) {
			const t = setTimeout(() => {
				setErrMsg(null)
				setDisplayProgress(0)
				setSelectedUrl(initialCoverUrl ?? null)
				setPendingUrl(null)
			}, 250)
			return () => clearTimeout(t)
		}
	}, [open, initialCoverUrl])

	// 关闭弹框：任务进行中时明确告知"后台继续"，避免用户以为中断/卡死
	const handleClose = useCallback(() => {
		if (isRunning || triggerMutation.isPending) {
			toast.info('封面任务将在后台继续生成，完成后会通知你')
		}
		onClose()
	}, [isRunning, triggerMutation.isPending, onClose])

	// ESC 关闭
	useEffect(() => {
		if (!open) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') handleClose()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [open, handleClose])

	async function handleGenerate() {
		setErrMsg(null)
		setDisplayProgress(5)
		try {
			const result = await triggerMutation.mutateAsync(scriptId)
			generatedTaskIdRef.current = result.taskId
			// 乐观写入 active-task 缓存，让 useActiveTask().coverTask 立即出现
			// 5s 内被真数据接管（worker 推 cover_start 后服务端返回真实进度）
			queryClient.setQueryData(
				['scripts', scriptId, 'active-task'],
				(prev: unknown) => ({
					analyzeTask:
						(prev as { analyzeTask?: unknown } | null)?.analyzeTask ?? null,
					coverTask: {
						taskId: result.taskId,
						status: result.status,
						mode: 'standard',
						progress: 0,
						startedAt: new Date().toISOString()
					}
				})
			)
		} catch (e) {
			setErrMsg(
				e instanceof Error ? e.message : '触发封面生成失败，请稍后再试'
			)
		}
	}

	// 打开自动触发已移除：用户主动点「开始生成 / 重新生成」按钮才触发任务。
	// 续接场景（活跃 coverTask 存在）由 useActiveTask + useTaskStatus 自动渲染进度，无需此处干预。

	// 候选点击 → 仅标记 pending，不调接口、不关闭；用户在气泡里二次确认才真正选定
	function handleCandidateClick(url: string) {
		if (selectMutation.isPending) return
		// 已选定同一张：不再弹气泡，避免反复点
		if (selectedUrl === url) return
		setPendingUrl(url)
	}

	// 二次确认：调 select 接口 → 成功后给视觉反馈 → 关闭
	async function handleConfirmSelect() {
		const url = pendingUrl
		if (!url || selectMutation.isPending) return
		try {
			await selectMutation.mutateAsync(url)
			setSelectedUrl(url)
			setPendingUrl(null)
			// 给用户一个视觉反馈窗口，再关闭
			setTimeout(() => onClose(), 280)
		} catch (e) {
			setErrMsg(
				e instanceof Error ? e.message : '选定封面失败，请稍后再试'
			)
		}
	}

	function handleCancelSelect() {
		setPendingUrl(null)
	}

	if (!open) return null

	// 阶段文案对齐真实时序：
	// - cover_start 前：worker 接手中（很快）
	// - cover_start 后：AI 绘制 3 张候选 + 上传 OSS（真正的长耗时阶段，1~3 分钟）
	const stageText =
		stage === 'done'
			? '生成完成'
			: stage === 'error'
				? '生成失败'
				: stage === 'uploading'
					? 'AI 绘制候选封面中…'
					: stage === 'generating'
						? '任务启动中…'
						: stage === 'queued'
							? '排队等待中…'
							: '准备中…'

	// 已用时：queued 之后的所有阶段都展示（done 时即总耗时）
	const showElapsed =
		taskId !== null && stage !== 'idle' && stage !== 'queued'

	const showProgress =
		isRunning || triggerMutation.isPending || stage === 'done' || stage === 'error'

	// 候选缩略图渲染：仅生成中显示 3 个骨架；空态由 EmptyCTA 承担，不再用骨架占位
	const slots: Array<{ kind: 'image'; url: string } | { kind: 'skeleton' }> =
		isRunning
			? [
				{ kind: 'skeleton' },
				{ kind: 'skeleton' },
				{ kind: 'skeleton' }
			]
			: candidates.map((url) => ({ kind: 'image' as const, url }))

	// 空态：首次打开且无历史候选 → 显示「开始生成封面」CTA，等待用户主动触发
	const showEmptyCTA =
		stage === 'idle' && candidates.length === 0 && !triggerMutation.isPending

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="封面生成"
			onClick={handleClose}
			style={{
				position: 'fixed',
				inset: 0,
				zIndex: 100,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				padding: 24,
				background: 'rgba(28,24,21,0.78)',
				animation: 'fade-up 240ms ease both'
			}}
		>
			<div
				onClick={(e) => e.stopPropagation()}
				style={{
					position: 'relative',
					width: 'min(960px, 100%)',
					maxHeight: 'calc(100vh - 48px)',
					overflow: 'auto',
					background: '#FFFBF5',
					borderRadius: 18,
					border: '1px solid rgba(184,68,60,0.18)',
					boxShadow: '0 24px 80px rgba(28,24,21,0.36)',
					padding: 28
				}}
			>
				{/* 顶部：标题 + 关闭 */}
				<div
					className="flex items-start justify-between"
					style={{ marginBottom: 18 }}
				>
					<div>
						<div className="eyebrow mb-1.5">封面生成器</div>
						<h3
							className="font-serif font-bold"
							style={{
								fontSize: 22,
								color: '#1C1815',
								lineHeight: 1.2,
								margin: 0
							}}
						>
							{title || '短剧封面'}
						</h3>
						<div
							className="font-sans"
							style={{ fontSize: 12, color: '#8B7B6A', marginTop: 6 }}
						>
							一次生成 3 张候选，挑选心仪的封面后点击「使用此封面」。
						</div>
					</div>
					<button
						type="button"
						onClick={handleClose}
						aria-label="关闭"
						style={{
							display: 'inline-flex',
							alignItems: 'center',
							justifyContent: 'center',
							width: 32,
							height: 32,
							borderRadius: 8,
							border: '1px solid rgba(102,89,76,0.16)',
							background: 'transparent',
							color: '#66594C',
							cursor: 'pointer',
							transition: 'all 200ms ease'
						}}
						onMouseEnter={(e) => {
							e.currentTarget.style.background = 'rgba(184,68,60,0.08)'
							e.currentTarget.style.color = '#B8443C'
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.background = 'transparent'
							e.currentTarget.style.color = '#66594C'
						}}
					>
						<X size={16} />
					</button>
				</div>

				{/* 候选网格（3 列） */}
				<div
					style={{
						display: 'grid',
						gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
						gap: 14
					}}
				>
					{showEmptyCTA ? (
						<div
							style={{
								gridColumn: '1 / -1',
								padding: '48px 24px',
								borderRadius: 12,
								border: '1.5px dashed rgba(184,68,60,0.3)',
								background:
									'linear-gradient(135deg, rgba(102,89,76,0.04) 0%, rgba(184,68,60,0.04) 100%)',
								display: 'flex',
								flexDirection: 'column',
								alignItems: 'center',
								gap: 12,
								textAlign: 'center'
							}}
						>
							<div
								style={{
									width: 56,
									height: 56,
									borderRadius: '50%',
									background: 'rgba(184,68,60,0.08)',
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									color: '#B8443C'
								}}
							>
								<ImageIcon size={26} />
							</div>
							<div>
								<div
									className="font-serif font-bold"
									style={{
										fontSize: 18,
										color: '#1C1815',
										marginBottom: 4
									}}
								>
									还没有封面
								</div>
								<div
									className="font-sans"
									style={{
										fontSize: 12,
										color: '#8B7B6A',
										lineHeight: 1.6,
										maxWidth: 320
									}}
								>
									AI 将基于剧本标题生成 3 张候选封面，挑选最满意的一张。
								</div>
							</div>

						</div>
					) : (
						slots.map((slot, idx) => {
							if (slot.kind === 'skeleton') {
								return (
									<div
										key={`sk-${idx}`}
										style={{
											aspectRatio: '3 / 4',
											borderRadius: 12,
											overflow: 'hidden',
											background:
												'linear-gradient(135deg, rgba(102,89,76,0.08) 0%, rgba(184,68,60,0.05) 100%)',
											border: '1px solid rgba(102,89,76,0.12)',
											display: 'flex',
											alignItems: 'center',
											justifyContent: 'center',
											position: 'relative'
										}}
									>
										<div
											style={{
												display: 'flex',
												flexDirection: 'column',
												alignItems: 'center',
												gap: 8,
												color: '#8B7B6A'
											}}
										>
											<Loader2 size={22} className="animate-spin" />
											<span className="font-sans text-[11px]">
												{isRunning ? '生成中' : '等待'}
											</span>
										</div>
										{isRunning && <div className="progress-shimmer" />}
									</div>
								)
							}
							const isSelected = selectedUrl === slot.url
							const isPending = pendingUrl === slot.url
							return (
								<div
									key={slot.url}
									style={{
										position: 'relative',
										aspectRatio: '3 / 4',
										borderRadius: 12,
										overflow: 'hidden',
										border: isSelected
											? '2px solid #4A7C5A'
											: isPending
												? '2px solid #B8443C'
												: '1px solid rgba(102,89,76,0.16)',
										boxShadow: isSelected
											? '0 8px 24px rgba(74,124,90,0.18)'
											: isPending
												? '0 8px 24px rgba(184,68,60,0.22)'
												: 'none',
										transition: 'all 200ms ease',
										cursor: 'pointer'
									}}
									onClick={() => handleCandidateClick(slot.url)}
									onMouseEnter={(e) => {
										if (!isSelected && !isPending)
											e.currentTarget.style.borderColor = 'rgba(184,68,60,0.4)'
									}}
									onMouseLeave={(e) => {
										if (!isSelected && !isPending)
											e.currentTarget.style.borderColor = 'rgba(102,89,76,0.16)'
									}}
								>
									<img
										src={slot.url}
										alt={`候选 ${idx + 1}`}
										style={{
											width: '100%',
											height: '100%',
											objectFit: 'cover',
											animation: 'fade-up 360ms ease both'
										}}
										onError={(e) => {
											const img = e.currentTarget;
											const fallback = '/drama-cover-default.svg';
											if (img.src.endsWith(fallback)) return;
											img.src = fallback;
										}}
									/>
									{/* 选中标记 */}
									{isSelected && (
										<div
											style={{
												position: 'absolute',
												top: 8,
												right: 8,
												width: 26,
												height: 26,
												borderRadius: '50%',
												background: '#4A7C5A',
												color: '#FFFBF5',
												display: 'flex',
												alignItems: 'center',
												justifyContent: 'center',
												boxShadow: '0 4px 12px rgba(74,124,90,0.4)'
											}}
										>
											<Check size={14} strokeWidth={3} />
										</div>
									)}
									{/* 底部操作浮层（pending 状态时隐藏，避免与气泡重叠） */}
									{!isPending && (
										<div
											style={{
												position: 'absolute',
												left: 0,
												right: 0,
												bottom: 0,
												padding: '18px 10px 10px',
												background:
													'linear-gradient(180deg, rgba(28,24,21,0) 0%, rgba(28,24,21,0.65) 100%)',
												pointerEvents: 'none'
											}}
										>
											<div
												className="font-sans"
												style={{
													fontSize: 12,
													fontWeight: 600,
													color: '#FFFBF5',
													textAlign: 'center',
													letterSpacing: '0.04em'
												}}
											>
												{isSelected ? '✓ 已选定' : '使用此封面'}
											</div>
										</div>
									)}
									{/* 内嵌确认气泡：点击候选后弹出，确认才调接口 */}
									{isPending && (
										<>
											<div
												style={{
													position: 'absolute',
													inset: 0,
													background: 'rgba(28,24,21,0.55)',
													animation: 'fade-up 180ms ease both'
												}}
											/>
											<div
												className="font-sans"
												style={{
													position: 'absolute',
													top: '50%',
													left: '20%',
													transform: 'translate(-50%, -50%)',
													width: 'min(172px, 82%)',
													padding: '14px 12px 12px',
													borderRadius: 10,
													background: '#FFFBF5',
													boxShadow: '0 12px 32px rgba(28,24,21,0.4)',
													border: '1px solid rgba(184,68,60,0.22)',
													textAlign: 'center',
													animation: 'fade-up 200ms ease both'
												}}
											>
												<div
													style={{
														fontSize: 12,
														fontWeight: 600,
														color: '#1C1815',
														marginBottom: 10,
														letterSpacing: '0.02em'
													}}
												>
													确认使用这张？
												</div>
												<div style={{ display: 'flex', gap: 6 }}>
													<button
														type="button"
														onClick={(e) => {
															e.stopPropagation()
															void handleConfirmSelect()
														}}
														disabled={selectMutation.isPending}
														className="btn-primary"
														style={{
															flex: 1,
															height: 30,
															fontSize: 12,
															padding: 0,
															display: 'inline-flex',
															alignItems: 'center',
															justifyContent: 'center',
															gap: 4
														}}
													>
														{selectMutation.isPending ? (
															<Loader2 size={12} className="animate-spin" />
														) : (
															<Check size={12} strokeWidth={3} />
														)}
														确认
													</button>
													<button
														type="button"
														onClick={(e) => {
															e.stopPropagation()
															handleCancelSelect()
														}}
														className="btn-ghost"
														style={{
															flex: 1,
															height: 30,
															fontSize: 12,
															padding: 0,
															display: 'inline-flex',
															alignItems: 'center',
															justifyContent: 'center',
															gap: 4
														}}
													>
														<X size={12} />
														取消
													</button>
												</div>
											</div>
										</>
									)}
								</div>
							)
						})
					)}
				</div>

				{/* 进度条（仅生成阶段显示） */}
				{showProgress && (
					<div style={{ marginTop: 18 }}>
						<div
							className="flex items-baseline justify-between mb-2"
							style={{ gap: 12 }}
						>
							<span
								className="font-sans"
								style={{
									fontSize: 13,
									fontWeight: 600,
									color:
										stage === 'error'
											? '#B8443C'
											: stage === 'done'
												? '#4A7C5A'
												: '#1C1815'
								}}
							>
								{stage === 'error' && (
									<AlertCircle
										size={13}
										style={{ display: 'inline', marginRight: 4 }}
									/>
								)}
								{stageText}
								{showElapsed && (
									<span
										className="font-sans"
										style={{
											fontWeight: 400,
											fontSize: 11,
											color: '#8B7B6A',
											marginLeft: 6
										}}
									>
										· 已用时 {formatElapsed(elapsedSec)}
									</span>
								)}
							</span>
							<span
								className="font-mono"
								style={{
									fontSize: 16,
									fontWeight: 700,
									color:
										stage === 'error'
											? '#B8443C'
											: stage === 'done'
												? '#4A7C5A'
												: '#B8443C',
									letterSpacing: '-0.02em'
								}}
							>
								{stage === 'error' ? '—' : `${Math.round(displayProgress)}%`}
							</span>
						</div>
						<div
							style={{
								position: 'relative',
								height: 18,
								borderRadius: 999,
								background: 'rgba(102,89,76,0.10)',
								overflow: 'hidden',
								border: '1px solid rgba(102,89,76,0.08)'
							}}
						>
							<div
								style={{
									position: 'absolute',
									inset: 0,
									width: `${displayProgress}%`,
									background:
										stage === 'error'
											? 'linear-gradient(90deg, #B8443C 0%, #98352F 100%)'
											: stage === 'done'
												? 'linear-gradient(90deg, #4A7C5A 0%, #5A8B5A 100%)'
												: 'linear-gradient(90deg, #B8443C 0%, #D6655B 100%)',
									borderRadius: 999,
									transition: 'width 360ms cubic-bezier(0.22,1,0.36,1)'
								}}
							>
								{isRunning && <div className="progress-shimmer" />}
							</div>
						</div>
						{/* 预期管理：明确耗时区间 + 可关闭窗口后台继续 */}
						{(isRunning || triggerMutation.isPending) && (
							<div
								className="font-sans"
								style={{
									marginTop: 8,
									fontSize: 11,
									color: '#8B7B6A',
									lineHeight: 1.6
								}}
							>
								AI 一次绘制 3 张候选封面，约需 1~3 分钟。可关闭此窗口，任务会后台继续，完成后自动通知。
							</div>
						)}
					</div>
				)}

				{/* 错误信息 */}
				{effectiveError && (
					<div
						className="font-sans"
						style={{
							marginTop: 14,
							fontSize: 12,
							padding: '10px 14px',
							borderRadius: 8,
							color: '#B8443C',
							background: 'rgba(184,68,60,0.06)',
							border: '1px solid rgba(184,68,60,0.2)',
							display: 'flex',
							alignItems: 'flex-start',
							gap: 8,
							lineHeight: 1.6
						}}
					>
						<AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
						<span>{effectiveError}</span>
					</div>
				)}

				{/* 操作按钮组 */}
				<div
					style={{
						display: 'flex',
						gap: 10,
						flexWrap: 'wrap',
						marginTop: 18
					}}
				>
					<button
						type="button"
						onClick={handleGenerate}
						disabled={isRunning || triggerMutation.isPending}
						className="btn-primary font-sans"
						style={{ height: 38, padding: '0 18px', fontSize: 13 }}
					>
						<RefreshCw
							size={14}
							className={
								isRunning || triggerMutation.isPending ? 'animate-spin' : ''
							}
						/>
						{candidates.length > 0
							? '重新生成'
							: isRunning || triggerMutation.isPending
								? '生成中…'
								: stage === 'error'
									? '重试'
									: '立即生成'}
					</button>
					{(isRunning || triggerMutation.isPending) && (
						<button
							type="button"
							onClick={handleClose}
							className="btn-ghost font-sans"
							style={{ height: 38, padding: '0 16px', fontSize: 13 }}
						>
							后台运行
						</button>
					)}
					<button
						type="button"
						onClick={handleClose}
						className="btn-ghost font-sans"
						style={{ height: 38, padding: '0 16px', fontSize: 13, marginLeft: 'auto' }}
					>
						完成
					</button>
				</div>

				<div className="font-mono" style={{ fontSize: 10, color: '#A89A8A', marginTop: 10 }}>
					script: {scriptId.slice(0, 8)}…
				</div>
			</div>
		</div>
	)
}
