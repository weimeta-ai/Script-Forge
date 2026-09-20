// 分析进度页（p00 同款：8 节点纵向卡片 + timeline + 完成自动跳转）
// -----------------------------------------------------------------------------
// 路由：/analyzing-task/:taskId?scriptId=xxx
// 数据：useTaskStatus（8 节点分析）
// 状态：
//   - task.status === 'done' → 600ms 后跳转 /report/:scriptId?tab=...
//   - task.status === 'error' → 显示错误，提供返回上传页按钮
// =============================================================================

import { Loader2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
	useActiveTask,
	useRetryAnalysis,
	useStopAnalysis,
	useTaskStatus,
	type TaskEvent
} from '../api/scripts'
import { creditKeys, useMyBalance } from '../api/credit'
import { AnimatedProgress } from '../components/AnimatedProgress'
import {
	MagnifierBookAnimation,
	type BookAnimStatus
} from '../components/MagnifierBookAnimation'
import { PageBackground } from '../components/shell'
import { easeSnappy } from '../lib/animations'
import { fmtCredits } from '../lib/credit-tx-display'
import { ANALYSIS_NODES } from '../lib/nodes'
import { useQueryClient } from '@tanstack/react-query'

type TaskPhase = 'analyze'

interface NodeViewState {
	id: string
	name: string
	en: string
	desc: string
	icon: string
	progress: number
	status: 'pending' | 'running' | 'done' | 'error'
	lastMessage?: string
}

interface TimelineItem {
	key: string
	label: string
	message: string
	time: string
	tone: 'running' | 'done' | 'error' | 'neutral'
}

export default function AnalyzingTaskPage() {
	const navigate = useNavigate()
	const { taskId } = useParams<{ taskId: string }>()
	const [searchParams] = useSearchParams()
	const scriptId = searchParams.get('scriptId') ?? undefined
	const phase = (searchParams.get('phase') as TaskPhase | null) ?? 'analyze'

	// URL 兜底：taskId 缺失但 scriptId 存在时，查剧本最近活跃 task 并 replace URL
	// 场景：用户从 History 卡片"分析中"点击进入，或刷新后 URL 丢失 taskId
	const activeTaskQuery = useActiveTask(
		!taskId && scriptId ? scriptId : undefined
	)
	useEffect(() => {
		if (!taskId && scriptId && activeTaskQuery.data?.analyzeTask?.taskId) {
			navigate(
				`/analyzing-task/${activeTaskQuery.data.analyzeTask.taskId}?scriptId=${scriptId}&phase=${phase}`,
				{ replace: true }
			)
		}
	}, [taskId, scriptId, activeTaskQuery.data, navigate, phase])

	// 8 节点分析状态接口
	const analyzeStatus = useTaskStatus(scriptId, taskId)

	// 重试 mutation（error / canceled 状态下使用）
	const retryMutation = useRetryAnalysis()
	// 停止 mutation（running / pending 状态下使用）
	const stopMutation = useStopAnalysis()

	// 余额：失败退款提示展示「当前余额」用，retry 后失效刷新
	const { data: balanceData } = useMyBalance()
	const balance = balanceData?.balance ?? 0
	const queryClient = useQueryClient()

	async function handleRetry() {
		if (!scriptId || !taskId || retryMutation.isPending) return
		try {
			const result = await retryMutation.mutateAsync({
				scriptId,
				taskId
			})
			// 重新分析会再次扣减 2000 积分，刷新余额
			queryClient.invalidateQueries({ queryKey: creditKeys.balance() })
			// 跳转到新 task 的分析页（同 phase / scriptId）
			navigate(
				`/analyzing-task/${result.taskId}?scriptId=${scriptId}&phase=${phase}`,
				{ replace: true }
			)
		} catch (e) {
			// 重试失败：保持原页面，错误信息由 mutation 渲染
			console.error('[AnalyzingTask] retry failed:', e)
		}
	}

	async function handleStop() {
		if (!scriptId || !taskId || stopMutation.isPending) return
		if (!window.confirm('确定停止当前分析？已完成的进度将不会保存。'))
			return
		try {
			await stopMutation.mutateAsync({ scriptId, taskId })
			// 后端改 status='canceled'，前端轮询自动收到并停轮询
			// 不主动 navigate，让用户在原页看到「已停止」状态
		} catch (e) {
			console.error('[AnalyzingTask] stop failed:', e)
		}
	}

	const data = analyzeStatus.data
	const error = analyzeStatus.error

	const [elapsed, setElapsed] = useState(0)
	const startedRef = useRef<number>(0)
	const stoppedRef = useRef(false)
	const recordListRef = useRef<HTMLDivElement>(null)

	// 首次渲染时记录起始时间（避免 useRef 初始化时调用 Date.now 违反纯度规则）
	if (startedRef.current === 0) {
		startedRef.current = Date.now()
	}

	const task = data?.task
	const events = (data?.events ?? []) as TaskEvent[]
	const overall = data?.overall ?? 0

	// 同步 startedAt
	useEffect(() => {
		if (task?.startedAt) {
			startedRef.current = new Date(task.startedAt).getTime()
		}
	}, [task?.startedAt])

	// 完成或失败后停止 + 跳转
	// analyze → /report/:scriptId
	useEffect(() => {
		if (!task) return
		if (task.status === 'done' && task.reportId && !stoppedRef.current) {
			stoppedRef.current = true
			const timer = setTimeout(() => {
				if (!scriptId) return
				navigate(`/report/${scriptId}?tab=report`, { replace: true })
			}, 600)
			return () => clearTimeout(timer)
		}
	}, [task, navigate, scriptId])

	// 任务失败且已退款时，刷新余额（refuse stale 缓存，让"已退回 X 积分，当前余额 Y"展示真实数据）
	useEffect(() => {
		if (task?.status === 'error' && task.creditsRefunded) {
			queryClient.invalidateQueries({ queryKey: creditKeys.balance() })
		}
	}, [task?.status, task?.creditsRefunded, queryClient])

	// 计时器（每秒更新 elapsed）
	useEffect(() => {
		const timer = setInterval(() => {
			setElapsed(Math.round((Date.now() - startedRef.current) / 1000))
		}, 1000)
		return () => clearInterval(timer)
	}, [])

	const nodeStateList = useMemo<NodeViewState[]>(() => {
		const map = new Map<string, NodeViewState>()
		for (const node of ANALYSIS_NODES) {
			map.set(node.id, { ...node, progress: 0, status: 'pending' })
		}
		for (const event of events) {
			if (!event.nodeId || !map.has(event.nodeId)) continue
			const cur = map.get(event.nodeId)!
			if (event.type === 'node_start') {
				map.set(event.nodeId, {
					...cur,
					status: 'running',
					progress: Math.max(cur.progress, 3),
					lastMessage: event.message
				})
			} else if (event.type === 'node_progress') {
				map.set(event.nodeId, {
					...cur,
					status: 'running',
					progress: Math.max(cur.progress, event.percent ?? 0),
					lastMessage: event.message
				})
			} else if (event.type === 'node_done') {
				map.set(event.nodeId, {
					...cur,
					status: 'done',
					progress: 100,
					lastMessage: event.message
				})
			} else if (event.type === 'node_error') {
				map.set(event.nodeId, {
					...cur,
					status: 'error',
					progress: Math.max(cur.progress, 100),
					lastMessage: event.message
				})
			}
		}

		// 兜底：task 整体失败时，把仍处于 running/pending 的节点统一标记为 error。
		// Why：useTaskStatus 在 status==='error' 时立即停止轮询，若 node_error 事件
		// 此刻尚未落库，节点卡片会永远停留在「分析中」。
		const taskFailed = task?.status === 'error'
		if (!taskFailed) {
			return ANALYSIS_NODES.map((n) => map.get(n.id)!)
		}
		const fallbackMessage = task?.errorMessage ?? '分析失败'
		return ANALYSIS_NODES.map((n) => {
			const cur = map.get(n.id)!
			if (cur.status === 'done' || cur.status === 'error') return cur
			return {
				...cur,
				status: 'error',
				progress: Math.max(cur.progress, 100),
				lastMessage: cur.lastMessage ?? fallbackMessage
			}
		})
	}, [events, task?.status, task?.errorMessage])

	const finishedCount = nodeStateList.filter(
		(n) => n.status === 'done'
	).length
	const currentNode =
		nodeStateList.find((n) => n.status === 'running') ?? null
	const currentNodeIndex = currentNode
		? nodeStateList.findIndex((n) => n.id === currentNode.id)
		: finishedCount
	const timeline = useMemo(() => buildTimeline(events), [events])

	// 过程记录：新事件到来时，自动滚动到最新一条
	useEffect(() => {
		const el = recordListRef.current
		if (!el) return
		el.scrollTop = el.scrollHeight
	}, [timeline.length])

	const mm = Math.floor(elapsed / 60)
		.toString()
		.padStart(2, '0')
	const ss = (elapsed % 60).toString().padStart(2, '0')

	const errMessage =
		task?.status === 'error'
			? task.errorMessage ?? '分析失败'
			: error
				? error instanceof Error
					? error.message
					: '查询失败'
				: null

	// 放大镜动画状态：由 task.status 推导
	const animStatus: BookAnimStatus =
		task?.status === 'done'
			? 'done'
			: task?.status === 'error'
				? 'error'
				: task?.status === 'canceled'
					? 'canceled'
					: 'running'

	// Hero 文案
	const heroTitle = '正在生成商业分析报告'
	const heroTag = '多维度智能算法'
	const heroDesc =
		'当前进度直接绑定真实分析节点事件。你现在看到的不是假动画，而是输入整理、知识库推理、结果收束这几步的真实推进。'

	return (
		<div
			style={{
				padding: '32px 24px',
				minHeight: 'calc(100vh - 72px)',
				position: 'relative',
				zIndex: 1
			}}
		>
			<PageBackground decorLevel="L2" />
			<div
				className="mx-auto flex w-full max-w-[1480px] flex-col gap-6"
				style={{ position: 'relative', zIndex: 1 }}
			>
				{/* Hero 区 */}
				<section
					className="panel grid gap-[18px] grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.8fr)]"
					style={{ padding: '22px 24px' }}
				>
					<div
						className="panel-paper-soft"
						style={{
							padding: '18px 18px 16px',
							display: 'grid',
							gap: '14px',
							alignContent: 'start'
						}}
					>
						<div className="eyebrow mb-3">分析会话</div>
						<div className="mb-3 flex flex-wrap items-end gap-3">
							<h1
								className="font-serif font-bold"
								style={{
									fontSize: 'clamp(24px, 3vw, 34px)',
									color: 'var(--color-text)',
									lineHeight: 1.08,
									letterSpacing: '-0.02em'
								}}
							>
								{heroTitle}
							</h1>
							<span
								className="rounded-full px-3 py-1 text-[11px] font-sans"
								style={{
									color: 'var(--color-primary)',
									background: 'rgba(184,68,60,0.08)',
									border: '1px solid rgba(184,68,60,0.14)'
								}}
							>
								{heroTag}
							</span>
						</div>
						{/* <p
							className="max-w-[760px] font-sans text-sm"
							style={{ color: 'var(--color-text-muted)', lineHeight: 1.8 }}
						>
							{heroDesc}
						</p> */}

						<div
							className="mt-5 flex flex-wrap items-center gap-3 font-sans text-xs"
							style={{ color: 'var(--color-text-muted)' }}
						>
							<span
								className="rounded-full px-3 py-1"
								style={{
									background: 'rgba(255,255,255,0.74)',
									border: '1px solid rgba(102,89,76,0.08)'
								}}
							>
								当前阶段：
								{currentNode
									? `0${currentNodeIndex + 1}. ${currentNode.name
									}`
									: task?.status === 'done'
										? '报告已生成'
										: '等待任务启动'}
							</span>
							{/* p00 同款：显示当前文件名（让用户知道在分析哪个剧本） */}
							<span
								className="rounded-full px-3 py-1"
								style={{
									background: 'rgba(255,255,255,0.74)',
									border: '1px solid rgba(102,89,76,0.08)'
								}}
							>
								当前文件：
								{task?.fileName ??
									`task-${taskId?.slice(0, 8)}.txt`}
							</span>
						</div>

						{/* 进度条 */}
						<div className="mt-6">
							<div
								className="mb-3 flex items-center justify-between font-sans text-xs"
								style={{ color: 'var(--color-text-muted)' }}
							>
								<span className="inline-flex items-center gap-2">
									{task?.status !== 'done' &&
										task?.status !== 'error' &&
										task?.status !== 'canceled' && (
											<Loader2
												style={{
													width: 14,
													height: 14,
													animation:
														'spin 1s linear infinite',
													color: 'var(--color-primary)'
												}}
											/>
										)}
									报告生成进度
								</span>
								<AnimatedProgress.Label value={overall} />
							</div>
							<AnimatedProgress
								value={overall}
								height={10}
								showShimmer
								showStripes
								showEdgeGlow
								style={{
									background: 'rgba(102,89,76,0.10)',
									border: '1px solid rgba(102,89,76,0.08)'
								}}
							/>
							{/* 停止按钮：running/pending 显示 */}
							{(task?.status === 'running' ||
								task?.status === 'pending') && (
									<div className="mt-4 text-right">
										<button
											type="button"
											onClick={handleStop}
											disabled={stopMutation.isPending}
											className="font-sans text-sm underline"
											style={{ color: 'var(--color-primary-hover)' }}
										>
											{stopMutation.isPending
												? '停止中…'
												: '停止分析'}
										</button>
									</div>
								)}
						</div>
					</div>

					<div
						className="panel-paper-soft"
						style={{
							padding: '14px 16px',
							display: 'flex',
							flexDirection: 'column',
							gap: '10px'
						}}
					>
						<div className="eyebrow mb-3">进行中...</div>
						{/* 维度标签云：8 个分析维度铺开，按状态着色 */}
						<div
								style={{
									display: 'flex',
									flexWrap: 'wrap',
									gap: 4,
									justifyContent: 'center'
								}}
							>
								{nodeStateList.map((node) => {
									const isDone = node.status === 'done'
									const isRunning = node.status === 'running'
									const isError = node.status === 'error'
									return (
										<motion.span
											key={node.id}
											initial={false}
											animate={{
												opacity: isRunning
													? 1
													: isDone
														? 0.85
														: isError
															? 0.9
															: 0.5,
												scale: isRunning ? 1.04 : 1
											}}
											transition={{
												duration: 0.25,
												ease: easeSnappy
											}}
											style={{
												padding: '3px 9px',
												fontSize: 10.5,
												borderRadius: 10,
												fontWeight: 500,
												whiteSpace: 'nowrap',
												background: isRunning
													? 'var(--color-primary)'
													: isDone
														? 'rgba(184,68,60,0.10)'
														: isError
															? 'rgba(184,68,60,0.06)'
															: 'rgba(102,89,76,0.04)',
												color: isRunning
													? '#fff'
													: isDone
														? 'var(--color-primary)'
														: isError
															? 'var(--color-primary)'
															: 'var(--color-text-subtle)',
												border: `1px solid ${isRunning
													? 'var(--color-primary)'
													: isDone
														? 'rgba(184,68,60,0.22)'
														: isError
															? 'rgba(184,68,60,0.20)'
															: 'rgba(102,89,76,0.08)'
													}`,
												boxShadow: isRunning
													? '0 0 0 3px rgba(184,68,60,0.12)'
													: 'none'
											}}
										>
											{node.name}
										</motion.span>
									)
								})}
							</div>

						{/* 当前阶段动画：放大镜翻书 */}
						<div
							style={{
								display: 'flex',
								justifyContent: 'center',
								alignItems: 'center',
								padding: '2px 0 4px'
							}}
						>
							<div style={{ width: 170, maxWidth: '100%' }}>
								<MagnifierBookAnimation status={animStatus} />
							</div>
						</div>


						<div
							style={{
								height: 1,
								background:
									'rgba(102,89,76,0.08)'
							}}
						/>
						<div className="grid grid-cols-3 gap-2">
							<MetricCard
								label="已完成节点"
								value={`${finishedCount}/8`}
							/>
							<MetricCard label="已耗时" value={`${mm}:${ss}`} />
							<MetricCard
								label="当前状态"
								value={
									task?.status === 'done'
										? '完成'
										: task?.status === 'error'
											? '异常'
											: '分析中'
								}
							/>
						</div>

					</div>
				</section>

				{/* 节点卡片 + Timeline（8 节点）*/}
				<section className="grid gap-[22px] grid-cols-1 lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.75fr)]">
					<div className="panel" style={{ padding: '20px' }}>
						<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
							<div>
								<div className="eyebrow mb-2">工作阶段</div>
								<div
									className="font-serif text-2xl font-bold"
									style={{ color: 'var(--color-text)' }}
								>
									分析阶段
								</div>
							</div>
							<div
								className="font-sans text-xs"
								style={{ color: 'var(--color-text-muted)' }}
							>
								{`已完成 ${finishedCount} / 8，当前结果会持续写入最终报告`}
							</div>
						</div>

						<div className="flex flex-col">
								{nodeStateList.map((node, index) => (
									<NodeCard
										key={node.id}
										node={node}
										isLast={
											index === nodeStateList.length - 1
										}
									/>
								))}
							</div>
					</div>

					<aside
						className="panel-paper-soft"
						style={{
							padding: '20px',
							alignSelf: 'start',
							height: 'clamp(420px, 60vh, 640px)',
							display: 'flex',
							flexDirection: 'column'
						}}
					>
						<div className="eyebrow mb-2">实时记录</div>
						<div
							className="mb-4 font-serif text-2xl font-bold"
							style={{ color: 'var(--color-text)' }}
						>
							过程记录
						</div>

						<div
							ref={recordListRef}
							className="flex flex-col"
							style={{
								flex: 1,
								minHeight: 0,
								overflowY: 'auto',
								paddingRight: '4px'
							}}
						>
							{timeline.length ? (
								timeline.map((item, index) => (
									<TimelineCard
										key={item.key}
										item={item}
										isLast={index === timeline.length - 1}
									/>
								))
							) : (
								<div
									className="font-sans text-sm"
									style={{ color: 'var(--color-text-muted)' }}
								>
									正在等待第一条任务事件。
								</div>
							)}
						</div>

						{/* 失败退款提示：task.status="error" 显示 */}
						{task?.status === "error" && (
							task.creditsRefunded ? (
								<div
									className="mt-5 rounded-[12px] px-4 py-3 font-sans text-sm"
									style={{
										color: 'rgb(22 163 74)',
										background: 'rgba(34 197 94 / 8%)',
										border: '1px solid rgba(34 197 94 / 24%)'
									}}
								>
									本次分析未完成，已退回 {fmtCredits(2000)} 积分，当前余额{' '}
									{fmtCredits(balance)}
								</div>
							) : (
								<div
									className="mt-5 rounded-[12px] px-4 py-3 font-sans text-sm"
									style={{
										color: 'rgb(161 98 7)',
										background: 'rgba(234 179 8 / 8%)',
										border: '1px solid rgba(234 179 8 / 24%)'
									}}
								>
									退款处理中…
								</div>
							)
						)}

						{errMessage && (
							<div
								className="mt-5 rounded-[12px] px-4 py-3 font-sans text-sm"
								style={{
									color: 'var(--color-primary)',
									background: 'rgba(184,68,60,0.08)',
									border: '1px solid rgba(184,68,60,0.14)'
								}}
							>
								{errMessage}
								{/* 重试按钮 */}
								{task &&
									'mode' in task &&
									task.mode && (
										<button
											type="button"
											onClick={handleRetry}
											disabled={retryMutation.isPending}
											className="ml-3 underline"
											style={{ color: 'var(--color-primary-hover)' }}
										>
											{retryMutation.isPending
												? '重试中…'
												: `重试（${task.mode === 'ultra'
													? '极速'
													: task.mode ===
														'fast'
														? '快速'
														: '标准'
												}模式）`}
										</button>
									)}
								<button
									type="button"
									onClick={() => navigate('/upload')}
									className="ml-3 underline"
									style={{ color: 'var(--color-primary-hover)' }}
								>
									返回上传页
								</button>
							</div>
						)}

						{/* 已停止状态：task.status="canceled" 显示 */}
						{task?.status === "canceled" && (
							<div
								className="mt-5 rounded-[12px] px-4 py-3 font-sans text-sm"
								style={{
									color: 'var(--color-text-muted)',
									background: 'rgba(102,89,76,0.06)',
									border: '1px solid rgba(102,89,76,0.12)'
								}}
							>
								已停止分析
								{task && 'mode' in task && task.mode && (
									<button
										type="button"
										onClick={handleRetry}
										disabled={retryMutation.isPending}
										className="ml-3 underline"
										style={{ color: 'var(--color-primary-hover)' }}
									>
										{retryMutation.isPending
											? '重试中…'
											: `重新分析（${task.mode === 'ultra'
												? '极速'
												: task.mode === 'fast'
													? '快速'
													: '标准'
											}模式）`}
									</button>
								)}
								<button
									type="button"
									onClick={() => navigate('/history')}
									className="ml-3 underline"
									style={{ color: 'var(--color-primary-hover)' }}
								>
									返回历史
								</button>
							</div>
						)}
					</aside>
				</section>
			</div>
		</div>
	)
}

function NodeCard({
	node,
	isLast
}: {
	node: NodeViewState
	isLast: boolean
}) {
	const isRunning = node.status === 'running'
	const isDone = node.status === 'done'
	const isError = node.status === 'error'

	return (
		<motion.div
			whileHover={{ y: -2 }}
			transition={{ duration: 0.22, ease: easeSnappy }}
			style={{
				padding: '12px 16px 14px',
				borderRadius: '14px',
				border: isRunning
					? '1px solid rgba(184,68,60,0.14)'
					: isDone
						? '1px solid rgba(184,68,60,0.14)'
						: isError
							? '1px solid rgba(184,68,60,0.24)'
							: '1px solid rgba(102,89,76,0.10)',
				background: 'rgba(250,246,239,0.72)',
				boxShadow: 'none',
				marginBottom: isLast ? 0 : 12
			}}
		>
			<div className="flex flex-wrap items-center gap-3">
				<div
					className="font-serif text-lg font-bold"
					style={{ color: 'var(--color-text)' }}
				>
					{node.name}
				</div>
				<span
					className="rounded-full px-2.5 py-1 text-[11px] font-sans"
					style={{
						color:
							isRunning || isDone || isError
								? 'var(--color-primary)'
								: 'var(--color-text-subtle)',
						background:
							isError || isDone || isRunning
								? 'rgba(184,68,60,0.08)'
								: 'rgba(102,89,76,0.06)'
					}}
				>
					{isError
						? '异常'
						: isDone
							? '已完成'
							: isRunning
								? '分析中'
								: '等待中'}
				</span>
				<div
					className="ml-auto font-mono text-sm"
					style={{
						color: isRunning || isDone ? 'var(--color-primary)' : 'var(--color-text-subtle)'
					}}
				>
					<AnimatedProgress.Label value={node.progress} />
				</div>
			</div>
			<div
				className="mt-1 mb-2 font-sans text-xs"
				style={{ color: 'var(--color-text-subtle)' }}
			>
				{node.en} · {node.desc}
			</div>
			<AnimatedProgress
				value={node.progress}
				height={6}
				showShimmer
				showStripes={false}
				showEdgeGlow={false}
				isError={isError}
			/>
			<div
				className="mt-2 font-sans text-xs"
				style={{ color: 'var(--color-text-muted)', lineHeight: 1.6 }}
			>
				{node.lastMessage
					? summarizeNodeMessage(node.lastMessage)
					: '等待进入该阶段'}
			</div>
		</motion.div>
	)
}

function TimelineCard({
	item,
	isLast,
}: {
	item: TimelineItem
	isLast: boolean
}) {
	// 节点配色：根据 tone 区分状态
	const nodeColor =
		item.tone === 'error'
			? 'var(--color-primary)'
			: item.tone === 'running'
				? 'var(--color-primary)'
				: item.tone === 'done'
					? 'rgba(184,68,60,0.55)'
					: '#A89A8A'
	const isPulsing = item.tone === 'running'

	return (
		<div className="relative flex" style={{ minHeight: '40px' }}>
			{/* 左：时间戳（固定宽度，mono 字体） */}
			<div
				className="font-mono text-[11px]"
				style={{
					width: '52px',
					flexShrink: 0,
					paddingTop: '3px',
					color: 'var(--color-text-subtle)',
					letterSpacing: '0.02em',
					fontVariantNumeric: 'tabular-nums',
				}}
			>
				{item.time}
			</div>

			{/* 中：轨道（节点 + 垂直连接线） */}
			<div
				className="relative flex flex-col items-center"
				style={{ width: '14px', flexShrink: 0 }}
			>
				{/* 节点圆点 */}
				<div
					style={{
						width: '8px',
						height: '8px',
						borderRadius: '50%',
						background: nodeColor,
						marginTop: '6px',
						boxShadow: isPulsing
							? '0 0 0 4px rgba(184,68,60,0.12)'
							: 'none',
						animation: isPulsing
							? 'timeline-pulse 1.6s ease-in-out infinite'
							: 'none',
						zIndex: 1,
					}}
				/>
				{/* 垂直连接线：从节点下方延伸到下一项 */}
				{!isLast && (
					<div
						style={{
							position: 'absolute',
							top: '14px',
							bottom: '-10px',
							width: '1px',
							background: 'rgba(102,89,76,0.14)',
							left: '50%',
							transform: 'translateX(-50%)',
						}}
					/>
				)}
			</div>

			{/* 右：内容（标签 + 消息） */}
			<div
				className="flex-1"
				style={{
					paddingBottom: isLast ? '0' : '14px',
					paddingLeft: '4px',
				}}
			>

				<div
					className="font-sans text-sm"
					style={{ color: 'var(--color-text)', lineHeight: 1.6 }}
				>
					{item.message}
				</div>
			</div>
		</div>
	)
}

function MetricCard({ label, value }: { label: string; value: string }) {
	return (
		<div
			style={{
				padding: '12px 14px',
				borderRadius: '12px',
				background: 'rgba(255,255,255,0.72)',
				border: '1px solid rgba(102,89,76,0.08)'
			}}
		>
			<div
				className="font-sans text-[11px]"
				style={{ color: 'var(--color-text-subtle)', marginBottom: '6px' }}
			>
				{label}
			</div>
			<div
				className="font-serif text-[22px] font-bold leading-none"
				style={{ color: 'var(--color-text)' }}
			>
				{value}
			</div>
		</div>
	)
}

function summarizeNodeMessage(message: string): string {
	return message
		.replace('· 正在整理输入内容', '：正在整理你上传的剧本内容')
		.replace('· 已构建分析提示词', '：本阶段提示词已经准备完成')
		.replace('· 正在调用知识库', '：正在调用知识库生成结果')
		.replace(
			'· 正在整理知识库返回结果',
			'：知识库已经返回，正在整理输出内容'
		)
		.replace('· 完成', '：本阶段已完成')
}

function buildTimeline(events: TaskEvent[]): TimelineItem[] {
	const filtered = events.filter((event) => {
		if (event.type === 'log') return true
		if (
			event.type === 'node_start' ||
			event.type === 'node_done' ||
			event.type === 'node_error'
		)
			return true
		if (
			event.type === 'node_progress' &&
			(event.percent === 52 || event.percent === 82)
		)
			return true
		return false
	})
	// 最新事件排在最下面：保持时间正序（旧 → 新），仅截取最近 12 条避免无限增长
	return filtered.slice(-12).map((event, index) => ({
		key: `${event.ts}-${event.nodeId || event.type}-${index}`,
		label: event.nodeName || event.nodeId || renderEventLabel(event.type),
		message: event.message
			? summarizeNodeMessage(event.message)
			: renderEventLabel(event.type),
		time: new Date(event.ts).toLocaleTimeString('zh-CN', {
			hour12: false
		}),
		tone:
			event.type === 'node_error' || event.type === 'task_error'
				? 'error'
				: event.type === 'node_done' || event.type === 'task_done'
					? 'done'
					: event.type === 'log'
						? 'neutral'
						: 'running'
	}))
}

function renderEventLabel(type: string): string {
	if (type === 'node_start') return '开始分析'
	if (type === 'node_progress') return '处理中'
	if (type === 'node_done') return '该节点完成'
	if (type === 'task_done') return '全部分析完成'
	if (type === 'task_error') return '任务失败'
	return type
}
