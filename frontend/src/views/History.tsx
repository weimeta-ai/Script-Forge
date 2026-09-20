// 历史页（海报卡：整张封面图 + 顶部标签/状态 + 底部名称/评级 浮层）
// -----------------------------------------------------------------------------
// 路由：/history
// 数据：useScripts() 拉取 GET /scripts（含 scoreDetails.score/grade）
// 交互：点击卡片跳转 /report/:scriptId；批量模式：勾选 → 批量导出/删除
// =============================================================================

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
	scriptKeys,
	useActiveTask,
	useBatchExportPdf,
	useDeleteScript,
	useRetryAnalysis,
	useScripts,
	type ScriptListItem
} from '../api/scripts'
import coverFallback from '../assets/defalt.png'
import { PageBackground } from '../components/shell/PageBackground'
import { toast } from '../store/toast'

export default function HistoryPage() {
	const { data: scripts, isLoading } = useScripts()
	const list = scripts ?? []
	const queryClient = useQueryClient()

	// 批量操作状态
	const [selectionMode, setSelectionMode] = useState(false)
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
	const batchExportMutation = useBatchExportPdf()
	const deleteMutation = useDeleteScript()

	const allSelected = list.length > 0 && selectedIds.size === list.length

	function toggleSelect(id: string) {
		setSelectedIds((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}
	function toggleSelectAll() {
		if (allSelected) setSelectedIds(new Set())
		else setSelectedIds(new Set(list.map((s) => s.id)))
	}

	// 退出选择模式时清空选中（避免下次进入残留旧勾选）
	function exitSelection() {
		setSelectionMode(false)
		setSelectedIds(new Set())
	}

	// 批量导出：调后端 zip 接口 → blob 下载
	async function handleBatchExport() {
		if (selectedIds.size === 0 || batchExportMutation.isPending) return
		try {
			const blob = await batchExportMutation.mutateAsync(
				Array.from(selectedIds)
			)
			const url = URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = url
			a.download = `剧本报告打包-${selectedIds.size}份-${Date.now()}.zip`
			a.click()
			URL.revokeObjectURL(url)
			exitSelection()
		} catch (err) {
			console.error('[History] batch export failed:', err)
			alert(err instanceof Error ? err.message : '批量导出失败')
		}
	}

	// 批量删除：并行调用 useDeleteScript，全部完成后自动失效 list 查询
	async function handleBatchDelete() {
		if (selectedIds.size === 0) return
		if (
			!window.confirm(
				`确定删除选中的 ${selectedIds.size} 个剧本？此操作不可撤销。`
			)
		)
			return
		try {
			const ids = Array.from(selectedIds)
			await Promise.all(
				ids.map((id) => deleteMutation.mutateAsync(id))
			)
			exitSelection()
			// 失效 list 缓存，触发重新拉取（双保险：useDeleteScript 内部也会失效）
			queryClient.invalidateQueries({ queryKey: scriptKeys.list() })
		} catch (err) {
			console.error('[History] batch delete failed:', err)
			alert(err instanceof Error ? err.message : '批量删除失败')
		}
	}

	return (
		<div
			style={{
				position: 'relative',
				padding: '40px 32px',
				minHeight: 'calc(100vh - 72px)'
			}}
		>
			{/* 与知识库一致的装饰背景 */}
			<PageBackground decorLevel="L2" />

			{/* 自适应布局：max-width 提升到 1800px，超宽屏也能填满 */}
			<div
				className="mx-auto w-full"
				style={{
					maxWidth: 1800,

					position: 'relative',
					zIndex: 1,

				}}
			>
				<div style={{
					padding: 20,
					marginBottom: 40,
					borderRadius: '14px',
					border: '1px solid rgba(230, 74, 25, 0.2)',
					background: 'radial-gradient(80% 60% at 20% 0%, rgba(255, 122, 77, 0.1) 0%, transparent 70%), rgba(255, 252, 247, 0.92)',
					boxShadow: 'rgba(102, 89, 76, 0.06) 0px 4px 20px'
				}}>
					<div className="eyebrow mb-3">历史分析</div>
					<h1
						className="font-serif font-bold mb-2"
						style={{
							fontSize: 'clamp(28px, 4vw, 40px)',
							color: '#1C1815',
							lineHeight: 1.15,
							letterSpacing: '-0.02em'
						}}
					>
						我的剧本分析
					</h1>
					<p
						className="font-sans text-sm mb-8"
						style={{ color: '#66594C' }}
					>
						所有上传过的剧本分析报告，点击进入查看完整内容。
					</p>

					{/* 批量操作工具栏：仅在有数据时显示 */}
					{!isLoading && list.length > 0 && (
						<BatchToolbar
							selectionMode={selectionMode}
							selectedCount={selectedIds.size}
							total={list.length}
							allSelected={allSelected}
							onEnterSelection={() => setSelectionMode(true)}
							onExitSelection={exitSelection}
							onToggleAll={toggleSelectAll}
							onBatchExport={handleBatchExport}
							onBatchDelete={handleBatchDelete}
							exporting={batchExportMutation.isPending}
						/>
					)}
				</div>
				{isLoading ? (
					<div
						className="font-sans text-sm"
						style={{ color: '#66594C' }}
					>
						正在加载…
					</div>
				) : list.length === 0 ? (
					<div
						className="panel text-center"
						style={{ padding: '80px 40px' }}
					>
						<div
							className="font-serif text-2xl mb-2"
							style={{ color: '#1C1815' }}
						>
							还没有分析记录
						</div>
						<p
							className="font-sans text-sm mb-6"
							style={{ color: '#66594C' }}
						>
							上传你的第一个剧本。
						</p>
						<Link
							to="/upload"
							className="btn-primary inline-block"
							style={{
								height: '40px',
								lineHeight: '40px',
								padding: '0 24px'
							}}
						>
							立即上传
						</Link>
					</div>
				) : (
					// 自适应网格：1 → 2 → 3 → 4 → 5 → 6 列，配合 max-width:1800px 在 2K/4K 屏填满
					<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
						{list.map((s) => (
							<HistoryCard
								key={s.id}
								script={s}
								selectionMode={selectionMode}
								isSelected={selectedIds.has(s.id)}
								onToggleSelect={() => toggleSelect(s.id)}
							/>
						))}
					</div>
				)}
			</div>
		</div >
	)
}

// 批量操作工具栏
function BatchToolbar(props: {
	selectionMode: boolean
	selectedCount: number
	total: number
	allSelected: boolean
	onEnterSelection: () => void
	onExitSelection: () => void
	onToggleAll: () => void
	onBatchExport: () => void
	onBatchDelete: () => void
	exporting: boolean
}) {
	if (!props.selectionMode) {
		return (
			<div className="mb-6 flex items-center gap-3 flex-wrap">
				<button
					type="button"
					onClick={props.onEnterSelection}
					className="btn-ghost font-sans"
					style={{ height: 36, padding: '0 14px', fontSize: 13 }}
				>
					批量操作
				</button>
			</div>
		)
	}
	return (
		<div
			className="mb-6 flex items-center gap-3 flex-wrap"
			style={{
				padding: '10px 14px',
				background: 'rgba(255,251,247,0.92)',
				border: '1px solid rgba(184,68,60,0.18)',
				borderRadius: 10,
				boxShadow: '0 4px 16px rgba(102,89,76,0.06)'
			}}
		>
			<label
				className="flex items-center gap-2 font-sans text-sm cursor-pointer"
				style={{ color: '#1C1815' }}
			>
				<input
					type="checkbox"
					checked={props.allSelected}
					onChange={props.onToggleAll}
					style={{
						width: 16,
						height: 16,
						accentColor: '#B8443C',
						cursor: 'pointer'
					}}
				/>
				全选
			</label>
			<span className="font-sans text-sm" style={{ color: '#66594C' }}>
				已选 <b style={{ color: '#B8443C' }}>{props.selectedCount}</b> /{' '}
				{props.total}
			</span>
			<div className="flex-1" />
			<button
				type="button"
				onClick={props.onBatchExport}
				disabled={props.selectedCount === 0 || props.exporting}
				className="btn-primary font-sans"
				style={{ height: 32, padding: '0 14px', fontSize: 12.5 }}
			>
				{props.exporting ? '打包中…' : '批量导出 PDF'}
			</button>
			<button
				type="button"
				onClick={props.onBatchDelete}
				disabled={props.selectedCount === 0}
				className="btn-ghost font-sans"
				style={{
					height: 32,
					padding: '0 14px',
					fontSize: 12.5,
					color: '#B8443C',
					borderColor: 'rgba(184,68,60,0.4)'
				}}
			>
				批量删除
			</button>
			<button
				type="button"
				onClick={props.onExitSelection}
				className="font-sans text-sm underline"
				style={{ color: '#8B7B6A' }}
			>
				取消
			</button>
		</div>
	)
}

function HistoryCard({
	script,
	selectionMode,
	isSelected,
	onToggleSelect
}: {
	script: ScriptListItem
	selectionMode: boolean
	isSelected: boolean
	onToggleSelect: () => void
}) {
	const [hovered, setHovered] = useState(false)
	const navigate = useNavigate()
	// 查剧本最近活跃任务（running/pending），用于显示「进行中」状态 + 跳转分析页
	// 注：cover 任务不算"分析中"（isAnalyzing 仅看 analyzeTask），但卡片单独展示封面生成状态
	const { data: activeTaskData } = useActiveTask(script.id)
	const activeTask = activeTaskData?.analyzeTask ?? null
	const coverTaskStatus = activeTaskData?.coverTask?.status ?? null
	const isCoverRunning =
		coverTaskStatus === 'running' || coverTaskStatus === 'pending'
	const deleteMutation = useDeleteScript()
	const retryMutation = useRetryAnalysis()
	const queryClient = useQueryClient()

	// 封面任务从生成中 → 结束：刷新列表（候选落库）+ toast 引导用户去报告页挑选
	const prevCoverStatusRef = useRef<string | null>(null)
	useEffect(() => {
		const prev = prevCoverStatusRef.current
		prevCoverStatusRef.current = coverTaskStatus
		if (prev !== 'running' && prev !== 'pending') return
		if (coverTaskStatus === 'running' || coverTaskStatus === 'pending') return
		queryClient.invalidateQueries({ queryKey: scriptKeys.list() })
		toast.success(`「${script.title || '未命名剧本'}」封面已生成，进入报告页可挑选`)
	}, [coverTaskStatus, queryClient, script.title])

	const isAnalyzing = Boolean(activeTask)
	const fileName = script.fileName ?? `${script.title}.txt`
	const score = script.scoreDetails?.score
	const grade = script.scoreDetails?.grade
	const lastTaskStatus = script.lastTask?.status

	// 评级颜色映射：基于分数分档（≥80 红 A / ≥70 棕 B / ≥60 灰 C / <60 深灰）
	const gradeColor = getGradeColor(score)
	const hasScore = score !== undefined && score > 0

	// 简介：从报告 markdown 提取纯文本前 120 字（hover 时显示在遮罩层）
	const synopsis = extractSynopsis(script.scoreDetails?.report, 120)

	// 终态无评分：被用户停止 / 分析失败（不进入详情，提供重试 + 删除）
	const isStopped = !isAnalyzing && !hasScore && lastTaskStatus === 'canceled'
	const isError = !isAnalyzing && !hasScore && lastTaskStatus === 'error'
	const isTerminalNoScore = isStopped || isError

	// 已完成（无活跃任务且有评分）
	const isCompleted = !isAnalyzing && hasScore

	// 防御性兜底：任务已 done 但 score 解析失败（解析端回归或历史数据未回填）
	// 视为已完成，可进报告页（report markdown 仍在数据库），分数区空白
	const isDoneButNoScore = !isAnalyzing && !hasScore && lastTaskStatus === 'done'

	// 跳转目标：分析中 → 分析进度页；已完成 → 报告页；停止/失败 → null（不可点击）
	const linkTo = isAnalyzing
		? `/analyzing-task/${activeTask!.taskId}?scriptId=${script.id}`
		: (isCompleted || isDoneButNoScore)
			? `/report/${script.id}`
			: null

	// 状态徽章文本与配色（四态：进行中 / 已完成 / 已停止 / 分析失败）
	const badge = isAnalyzing
		? {
			text: `进行中 ${activeTask!.progress}%`,
			bg: 'rgba(184,68,60,0.95)'
		}
		: (isCompleted || isDoneButNoScore)
			? { text: '✓ 已完成', bg: 'rgba(70,130,90,0.92)' }
			: isStopped
				? { text: '⊘ 已停止', bg: 'rgba(102,89,76,0.85)' }
				: isError
					? { text: '⚠ 分析失败', bg: 'rgba(184,68,60,0.92)' }
					: { text: '待分析', bg: 'rgba(102,89,76,0.85)' }

	// 重试：用最近任务的 mode 触发新 task，并跳到分析进度页
	async function handleRetry(e: React.MouseEvent) {
		e.preventDefault()
		e.stopPropagation()
		if (!script.lastTask || retryMutation.isPending) return
		try {
			const result = await retryMutation.mutateAsync({
				scriptId: script.id,
				taskId: script.lastTask.id
			})
			navigate(`/analyzing-task/${result.taskId}?scriptId=${script.id}`)
		} catch (err) {
			console.error('[History] retry failed:', err)
		}
	}

	// 删除：confirm 二次确认 + 软删（成功后 useDeleteScript 自动刷新列表）
	async function handleDelete(e: React.MouseEvent) {
		e.preventDefault()
		e.stopPropagation()
		if (deleteMutation.isPending) return
		if (!window.confirm(`确定删除「${script.title}」？此操作不可撤销。`))
			return
		try {
			await deleteMutation.mutateAsync(script.id)
		} catch (err) {
			console.error('[History] delete failed:', err)
		}
	}

	// 是否有真实封面：决定卡片整体配色策略
	// Why：深色卡片+白字能适配任意海报（多数短剧海报是深色高对比）；
	//      但米色缺省图叠在深色卡片上视觉割裂，所以缺省场景切到米色主题
	const hasCover = Boolean(script.coverUrl)
	const coverSrc = script.coverUrl || coverFallback

	// 卡片主题 token：深色（真实封面）/ 米色（缺省图）
	const theme = hasCover
		? {
			cardBg: '#1C1815',
			text: '#FFFBF5',
			textSoft: 'rgba(255,251,247,0.78)',
			titleShadow: '0 1px 4px rgba(0,0,0,0.5)',
			scoreShadow: '0 2px 10px rgba(0,0,0,0.55)',
			chipBg: 'rgba(255,251,247,0.25)',
			chipBorder: 'rgba(255,251,247,0.3)',
			badgeBorder: 'rgba(255,251,247,0.4)',
			badgeShadow: '0 2px 6px rgba(0,0,0,0.2)',
			overlay:
				'linear-gradient(180deg, rgba(28,24,21,0.62) 0%, rgba(28,24,21,0) 28%, rgba(28,24,21,0) 45%, rgba(28,24,21,0.92) 100%)',
			hoverOverlay:
				'linear-gradient(180deg, rgba(28,24,21,0) 0%, rgba(28,24,21,0.88) 45%, rgba(28,24,21,0.96) 100%)',
			hoverEyebrow: 'rgba(255,251,247,0.7)',
			hoverText: 'rgba(255,251,247,0.92)',
			secondaryBtnText: '#FFFBF5',
			secondaryBtnBg: 'rgba(28,24,21,0.55)',
			secondaryBtnBorder: 'rgba(255,251,247,0.3)'
		}
		: {
			cardBg: '#F8F2E5',
			text: '#1C1815',
			textSoft: 'rgba(28,24,21,0.6)',
			titleShadow: 'none',
			scoreShadow: 'none',
			chipBg: 'rgba(212,184,150,0.35)',
			chipBorder: 'rgba(212,184,150,0.6)',
			badgeBorder: 'rgba(255,251,247,0.45)',
			badgeShadow: 'none',
			overlay: 'none',
			hoverOverlay:
				'linear-gradient(180deg, rgba(248,242,229,0) 0%, rgba(248,242,229,0.96) 45%, rgba(248,242,229,1) 100%)',
			hoverEyebrow: 'rgba(93,64,55,0.7)',
			hoverText: 'rgba(28,24,21,0.88)',
			secondaryBtnText: '#5D4037',
			secondaryBtnBg: 'rgba(93,64,55,0.1)',
			secondaryBtnBorder: 'rgba(93,64,55,0.3)'
		}

	// 共享视觉样式（卡片容器）
	const cardStyle: React.CSSProperties = {
		position: 'relative',
		display: 'block',
		borderRadius: 16,
		overflow: 'hidden',
		// 固定 3:4 比例：所有卡片封面大小完全一致
		aspectRatio: '3 / 4',
		background: theme.cardBg,
		border: isSelected
			? '2px solid #B8443C'
			: `1px solid ${hovered ? 'rgba(184,68,60,0.5)' : 'rgba(102,89,76,0.1)'
			}`,
		boxShadow: isSelected
			? '0 0 0 3px rgba(184,68,60,0.22), 0 16px 40px rgba(28,24,21,0.28)'
			: hovered
				? '0 16px 40px rgba(28,24,21,0.28)'
				: '0 2px 10px rgba(102,89,76,0.08)',
		transform: hovered ? 'translateY(-3px)' : 'translateY(0)',
		transition: 'all 240ms cubic-bezier(0.22,1,0.36,1)',
		cursor: selectionMode ? 'pointer' : linkTo ? 'pointer' : 'default'
	}

	// 卡片内层结构（封面 + 渐变 + 内容层）
	// Why 抽出来：Link / div 两种根元素共享同一份内容，避免重复
	const cardInner = (
		<>
			{/* 封面图：absolute 占满整张卡片，hover 时 scale 放大 */}
			<img
				src={coverSrc}
				alt={script.title}
				loading="lazy"
				onError={(e) => {
					const img = e.currentTarget
					if (img.src.endsWith(coverFallback)) return
					img.src = coverFallback
				}}
				style={{
					position: 'absolute',
					inset: 0,
					width: '100%',
					height: '100%',
					objectFit: 'cover',
					display: 'block',
					transform: hovered ? 'scale(1.08)' : 'scale(1)',
					transition: 'transform 600ms cubic-bezier(0.22,1,0.36,1)'
				}}
			/>

			{/* 选择模式下：左上角勾选框（覆盖在分数之上，zIndex 高于内容层） */}
			{selectionMode && (
				<div
					onClick={(e) => {
						e.preventDefault()
						e.stopPropagation()
						onToggleSelect()
					}}
					style={{
						position: 'absolute',
						top: 10,
						left: 10,
						zIndex: 5,
						width: 24,
						height: 24,
						borderRadius: 6,
						border: isSelected
							? '2px solid #B8443C'
							: '2px solid rgba(255,251,247,0.7)',
						background: isSelected
							? '#B8443C'
							: 'rgba(28,24,21,0.55)',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						cursor: 'pointer',
						color: '#FFFBF5',
						fontSize: 14,
						fontWeight: 700,
						lineHeight: 1
					}}
				>
					{isSelected ? '✓' : ''}
				</div>
			)}

			{/* 渐变叠层：仅真实封面图需要（米色缺省图本身已柔和，无需遮罩） */}
			{hasCover && (
				<div
					aria-hidden
					style={{
						position: 'absolute',
						inset: 0,
						background: theme.overlay,
						pointerEvents: 'none'
					}}
				/>
			)}

			{/* 内容层：relative 浮于图片之上 */}
			<div
				style={{
					position: 'relative',
					zIndex: 1,
					display: 'flex',
					flexDirection: 'column',
					height: '100%',
					padding: 14,
					color: theme.text
				}}
			>
				{/* 顶部：分数固定左上角 + 标签/状态徽章靠右 */}
				<div className="flex items-start gap-2">
					{/* 左：评分 + 评级（固定左上角，垂直堆叠：大分数 + 评级胶囊） */}
					{hasScore && (
						<div
							className="flex flex-col"
							style={{ flex: '0 0 auto', gap: 6 }}
						>
							<div
								className="flex items-baseline"
								style={{ gap: 3 }}
							>
								<span
									className="font-serif font-bold"
									style={{
										fontSize: 'clamp(28px, 8vw, 40px)',
										lineHeight: 1,
										color: theme.text,
										letterSpacing: '-0.03em',
										textShadow: theme.scoreShadow
									}}
								>
									{score}
								</span>
								<span
									className="font-sans"
									style={{
										fontSize: 12,
										color: theme.textSoft,
										fontWeight: 500
									}}
								>
									分
								</span>
							</div>
							{grade && (
								<span
									className="font-mono font-bold rounded-full self-start"
									style={{
										fontSize: 11,
										padding: '2px 8px',
										color: '#FFFBF5',
										background: gradeColor,
										border: `1px solid ${theme.badgeBorder}`,
										letterSpacing: '0.08em',
										boxShadow: theme.badgeShadow
									}}
								>
									{grade}
								</span>
							)}
						</div>
					)}

					{/* 右：标签 + 状态徽章（ml-auto 推到右端） */}
					<div className="flex flex-wrap items-center gap-1.5 justify-end ml-auto">

						{script.genre && (
							<span
								className="rounded-full px-2 py-0.5 font-mono text-[10px]"
								style={{
									color: theme.text,
									background: theme.chipBg,
									border: `1px solid ${theme.chipBorder}`
								}}
							>
								{script.genre}
							</span>
						)}
						{/* 封面生成中徽章：coverTask 后台运行时提示（已完成剧本也会生成封面） */}
						{isCoverRunning && (
							<span
								className="rounded-full px-2 py-0.5 font-mono text-[10px] font-bold animate-pulse"
								style={{
									color: '#FFFBF5',
									background: 'rgba(184,68,60,0.92)',
									border: `1px solid ${theme.badgeBorder}`
								}}
							>
								封面生成中
							</span>
						)}
						{/* 状态徽章：四态配色（已完成不显示，靠评分区分） */}
						{!isCompleted && (
							<span
								className="rounded-full px-2 py-0.5 font-mono text-[10px] font-bold"
								style={{
									color: '#FFFBF5',
									background: badge.bg,
									border: `1px solid ${theme.badgeBorder}`
								}}
							>
								{badge.text}
							</span>
						)}
					</div>
				</div>

				{/* 中部留白让封面图透出 */}
				<div style={{ flex: '1 1 auto' }} />

				{/* 底部：标题 */}
				<h3
					className="font-serif font-bold"
					style={{
						color: theme.text,
						fontSize: 15,
						lineHeight: 1.3,
						display: '-webkit-box',
						WebkitLineClamp: 2,
						WebkitBoxOrient: 'vertical',
						overflow: 'hidden',
						textShadow: theme.titleShadow,
						margin: 0
					}}
				>
					{script.title}
				</h3>

				{/* 终态无评分：重试 + 删除按钮组（常显，底部居中） */}
				{isTerminalNoScore && (
					<div
						className="mt-3 flex items-center justify-end gap-4 font-sans text-xs"
						style={{ color: theme.text }}
					>
						<button
							type="button"
							onClick={handleRetry}
							disabled={retryMutation.isPending}
							className="rounded-full px-3 py-1 font-bold transition-colors"
							style={{
								color: '#FFFBF5',
								background: 'rgba(184,68,60,0.92)',
								border: '1px solid rgba(255,251,247,0.4)',
								opacity: retryMutation.isPending ? 0.6 : 1,
								cursor: retryMutation.isPending
									? 'wait'
									: 'pointer'
							}}
						>
							{retryMutation.isPending ? '重试中…' : '重新分析'}
						</button>
						<button
							type="button"
							onClick={handleDelete}
							disabled={deleteMutation.isPending}
							className="rounded-full px-3 py-1 font-bold transition-colors"
							style={{
								color: theme.secondaryBtnText,
								background: theme.secondaryBtnBg,
								border: `1px solid ${theme.secondaryBtnBorder}`,
								opacity: deleteMutation.isPending ? 0.6 : 1,
								cursor: deleteMutation.isPending
									? 'wait'
									: 'pointer'
							}}
						>
							{deleteMutation.isPending ? '删除中…' : '删除'}
						</button>
					</div>
				)}
			</div>

			{/* Hover 简介 overlay：仅在有报告且非终态无评分时显示 */}
			{hasScore && !isTerminalNoScore && synopsis && (
				<div
					aria-hidden={!hovered}
					className="font-sans"
					style={{
						position: 'absolute',
						inset: 0,
						zIndex: 2,
						display: 'flex',
						flexDirection: 'column',
						justifyContent: 'flex-end',
						padding: 16,
						color: theme.text,
						background: theme.hoverOverlay,
						opacity: hovered ? 1 : 0,
						transition: 'opacity 240ms ease',
						pointerEvents: hovered ? 'auto' : 'none'
					}}
				>
					<div
						className="font-mono mb-1.5"
						style={{
							fontSize: 10,
							letterSpacing: '0.16em',
							textTransform: 'uppercase',
							color: theme.hoverEyebrow
						}}
					>
						// 简介
					</div>
					<p
						style={{
							margin: 0,
							fontSize: 12.5,
							lineHeight: 1.6,
							color: theme.hoverText,
							display: '-webkit-box',
							WebkitLineClamp: 5,
							WebkitBoxOrient: 'vertical',
							overflow: 'hidden'
						}}
					>
						{synopsis}
					</p>
				</div>
			)}
		</>
	)

	// 选择模式下：点击卡片切换选中（不跳转）
	if (selectionMode) {
		return (
			<div
				title={fileName}
				onMouseEnter={() => setHovered(true)}
				onMouseLeave={() => setHovered(false)}
				onClick={(e) => {
					e.preventDefault()
					e.stopPropagation()
					onToggleSelect()
				}}
				style={cardStyle}
			>
				{cardInner}
			</div>
		)
	}

	// 根元素：可点击状态用 Link 跳转；停止/失败用 div 屏蔽跳转
	if (linkTo) {
		return (
			<Link
				to={linkTo}
				title={fileName}
				onMouseEnter={() => setHovered(true)}
				onMouseLeave={() => setHovered(false)}
				style={cardStyle}
			>
				{cardInner}
			</Link>
		)
	}
	return (
		<div
			title={fileName}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={cardStyle}
		>
			{cardInner}
		</div>
	)
}

// 评级颜色：按分数分档（≥80 红 A / ≥70 棕 B / ≥60 灰 C / <60 深灰 D）
function getGradeColor(score?: number): string {
	if (score === undefined) return '#8B7B6A'
	if (score >= 80) return '#B8443C'
	if (score >= 70) return '#9A6B4F'
	if (score >= 60) return '#8B7B6A'
	return '#66594C'
}

// 从报告 markdown 提取简介
// 优先解析「**一句话介绍**：xxx」字段（详情页明确标注的简介，≤40 字含核心冲突点）
// 降级：老数据无此字段时，去 markdown 标记取前 max 字（保留原行为）
function extractSynopsis(report?: string | null, max = 120): string {
	if (!report) return ''

	const tagline = extractTagline(report)
	if (tagline) return tagline

	const text = report
		.replace(/^#+\s+/gm, '')
		.replace(/```[\s\S]*?```/g, '')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/\*\*([^*]+)\*\*/g, '$1')
		.replace(/\*([^*]+)\*/g, '$1')
		.replace(/!\[[^\]]*\]\([^)]+\)/g, '')
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		.replace(/^\s*[-*+]\s+/gm, '')
		.replace(/^\s*\d+\.\s+/gm, '')
		.replace(/^\s*>\s+/gm, '')
		.replace(/\s+/g, ' ')
		.trim()
	if (!text) return ''
	return text.length > max ? `${text.slice(0, max)}…` : text
}

// 抽取报告中的「一句话介绍」字段值
// Why：basic 与 summary 两节均含此字段；summary 节语义更凝练，取最后一个非空匹配
function extractTagline(report: string): string {
	const matches = Array.from(
		report.matchAll(/\*\*一句话介绍\*\*[：:]\s*([^\n]+)/g),
	)
	for (let i = matches.length - 1; i >= 0; i--) {
		const text = (matches[i][1] ?? '')
			.replace(/\*\*([^*]+)\*\*/g, '$1')
			.replace(/\*([^*]+)\*/g, '$1')
			.replace(/`([^`]+)`/g, '$1')
			.trim()
		if (text) return text
	}
	return ''
}
