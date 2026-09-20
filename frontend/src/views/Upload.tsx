// 上传页（三模式独立页 — 上传文件 / 粘贴文本 / 批量导入）
// -----------------------------------------------------------------------------
// 流程：
//   1. 用户选择 tab（upload / paste / batch）
//   2. upload 模式：拖拽或点击选单文件，校验类型 + 大小 + 空文件
//   3. paste 模式：textarea 输入，实时字数 + 超限禁用
//   4. batch 模式：多文件选择 + 标题编辑 + 3 路并发上传/分析（不阻塞 UI）
//   5. 提交：upload→POST /scripts/upload，paste→POST /scripts
//   6. 创建成功后立即 POST /scripts/:id/analyze 触发分析
//   7. 拿到 taskId 后 navigate('/analyzing-task/' + taskId?scriptId=xxx)
//
// 安全/一致性增强：
//   - 文件预校验：扩展名 + 大小 + 0 字节
//   - 批量上限 50 个、3 路并发
//   - 防重入 submittingRef
//   - 批量运行 useBlocker + beforeunload 双重拦截
//   - 取消：AbortController + 已 analyze 的调 stop（409 静默吞）
//   - 孤儿补偿：upload 成功 analyze 失败 → 自动 delete script
// =============================================================================

import { useQueryClient } from '@tanstack/react-query'
import {
	CheckCircle2,
	Clock,
	FilePlus2,
	Loader2,
	Lock as LockIcon,
	X as StopIcon,
	Trash2,
	Upload as UploadIcon,
	XCircle
} from 'lucide-react'
import type {
	CSSProperties,
	KeyboardEvent as ReactKeyboardEvent,
	ReactNode
} from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useBlocker, useNavigate } from 'react-router-dom'
import { creditKeys, useMyBalance } from '../api/credit'
import {
	useCreateScript,
	useDeleteScript,
	useStopAnalysis,
	useTriggerAnalysis,
	useUploadScript
} from '../api/scripts'
import { AnimatedProgress } from '../components/AnimatedProgress'
import { PageBackground } from '../components/shell'
import { fmtCredits } from '../lib/credit-tx-display'
import { RequestError } from '../lib/request'
import { toast } from '../store/toast'

// === 常量 ===
const ACCEPT =
	'.txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const ALLOWED_EXT = ['txt', 'md', 'pdf', 'docx'] as const
const MAX_SIZE = 20 * 1024 * 1024 // 20MB
const MAX_PASTE_LENGTH = 500_000 // 50 万字
const MAX_BATCH_COUNT = 50
const MAX_CONCURRENCY = 3
const TITLE_MAX = 255
const COST_PER_ANALYZE = 2000 // 单次剧本分析消耗积分（与后端 analyze.standard 一致）

type Mode = 'upload' | 'paste' | 'batch'
type BatchStatus = 'pending' | 'uploading' | 'queued' | 'done' | 'error'

interface BatchItem {
	id: string
	file: File
	title: string
	status: BatchStatus
	scriptId?: string
	taskId?: string
	error?: string
}

const MODES: { key: Mode; label: string }[] = [
	{ key: 'upload', label: '上传文件' },
	{ key: 'paste', label: '粘贴文本' },
	{ key: 'batch', label: '批量导入' }
]

// === 样式常量（避免重复构造对象） ===
const cardCinemaStyle: CSSProperties = {
	border: '1px solid rgba(230,74,25,0.2)',
	background:
		'radial-gradient(80% 60% at 20% 0%, rgba(255,122,77,0.1) 0%, transparent 70%), rgba(255,252,247,0.92)',
	boxShadow: '0 4px 20px rgba(102,89,76,0.06)'
}

const tabActiveStyle: CSSProperties = {
	color: '#F7F2E8',
	background: 'var(--color-primary)',
	border: '1px solid var(--color-primary)',
	cursor: 'pointer'
}

const tabInactiveStyle: CSSProperties = {
	color: 'var(--color-text-muted)',
	background: 'rgba(102,89,76,0.06)',
	border: '1px solid rgba(102,89,76,0.1)',
	cursor: 'pointer'
}

const dropzoneBaseStyle: CSSProperties = {
	borderRadius: '20px',
	transition: 'all 180ms ease'
}

// === Hook：路由离开 + 浏览器关闭双重拦截 ===
function useLeaveGuard(shouldBlock: boolean) {
	const blocker = useBlocker(shouldBlock)
	useEffect(() => {
		if (blocker.state === 'blocked') {
			const ok = window.confirm('批量任务进行中，离开会中断，确定离开？')
			if (ok) blocker.proceed()
			else blocker.reset()
		}
	}, [blocker])

	useEffect(() => {
		if (!shouldBlock) return
		const handler = (e: BeforeUnloadEvent) => {
			e.preventDefault()
			e.returnValue = ''
		}
		window.addEventListener('beforeunload', handler)
		return () => window.removeEventListener('beforeunload', handler)
	}, [shouldBlock])
}

// === 工具：文件预校验（统一入口，给 onPickFile / addBatchFiles 复用） ===
function validateFile(f: File): { ok: true } | { ok: false; msg: string } {
	const ext = f.name.split('.').pop()?.toLowerCase() || ''
	if (!(ALLOWED_EXT as readonly string[]).includes(ext)) {
		return {
			ok: false,
			msg: `不支持的格式：.${ext}。请使用 txt / pdf / docx / md`
		}
	}
	if (f.size === 0) {
		return { ok: false, msg: `文件为空：${f.name}` }
	}
	if (f.size > MAX_SIZE) {
		return { ok: false, msg: `文件超过 20MB 限制：${f.name}` }
	}
	return { ok: true }
}

function errText(e: unknown, fallback = '未知错误'): string {
	if (e instanceof RequestError) return e.message
	if (e instanceof Error && e.message) return e.message
	return fallback
}

export default function UploadPage() {
	const navigate = useNavigate()
	const [file, setFile] = useState<File | null>(null)
	const [title, setTitle] = useState('')
	const [pastedText, setPastedText] = useState('')
	const [mode, setMode] = useState<Mode>('upload')
	const [drag, setDrag] = useState(false)
	const [err, setErr] = useState<string | null>(null)

	const [batchItems, setBatchItems] = useState<BatchItem[]>([])
	const [batchDrag, setBatchDrag] = useState(false)
	const [batchRunning, setBatchRunning] = useState(false)
	const [batchError, setBatchError] = useState<string | null>(null)

	const inputRef = useRef<HTMLInputElement | null>(null)
	const batchInputRef = useRef<HTMLInputElement | null>(null)
	// 防重入：submit 与 runBatch 共用
	const submittingRef = useRef(false)
	// 批量取消信号
	const cancelRef = useRef<AbortController | null>(null)

	const uploadMutation = useUploadScript()
	const createMutation = useCreateScript()
	const deleteMutation = useDeleteScript()
	const analyzeMutation = useTriggerAnalysis()
	const stopMutation = useStopAnalysis()

	// 积分余额：进入页面即拉取，staleTime 5s（hook 内已设 10s，足够）
	const { data: balanceData } = useMyBalance()
	const balance = balanceData?.balance ?? 0
	const insufficientBalance = balance < COST_PER_ANALYZE
	const queryClient = useQueryClient()

	const submitting =
		uploadMutation.isPending ||
		createMutation.isPending ||
		analyzeMutation.isPending

	// 路由离开 + 浏览器关闭拦截
	useLeaveGuard(batchRunning)

	// === 派生：粘贴字数 + 标题字数 实时校验 ===
	const pasteOverLimit = pastedText.length > MAX_PASTE_LENGTH
	const canSubmitPaste =
		mode !== 'paste' || (!pasteOverLimit && pastedText.trim().length > 0)
	const canSubmitUpload = mode !== 'upload' || Boolean(file)
	const canSubmit =
		canSubmitPaste &&
		canSubmitUpload &&
		title.trim().length > 0 &&
		!insufficientBalance

	// === 单文件选择 ===
	const onPickFile = useCallback((f: File | null) => {
		setErr(null)
		if (!f) {
			setFile(null)
			return
		}
		const r = validateFile(f)
		if (!r.ok) {
			setErr(r.msg)
			return
		}
		setFile(f)
		setTitle((prev) => prev || f.name.replace(/\.[^.]+$/, ''))
	}, [])

	// === 单文件/粘贴 提交 ===
	const submit = useCallback(async () => {
		if (submittingRef.current) return
		submittingRef.current = true
		setErr(null)

		// 提到 try 外面：catch 块要用来做孤儿补偿
		let scriptId: string | undefined
		let analyzeSucceeded = false

		try {
			if (mode === 'upload' && file) {
				if (!title.trim()) {
					setErr('请输入剧本标题')
					return
				}
				const script = await uploadMutation.mutateAsync({
					title: title.trim(),
					file
				})
				scriptId = script.id
			} else if (mode === 'paste' && pastedText.trim()) {
				if (!title.trim()) {
					setErr('请输入剧本标题')
					return
				}
				if (pasteOverLimit) {
					setErr('文本超过 50 万字限制')
					return
				}
				const script = await createMutation.mutateAsync({
					title: title.trim(),
					sourceContent: pastedText
				})
				scriptId = script.id
			} else {
				setErr('请上传文件或粘贴文本')
				return
			}

			const { taskId } = await analyzeMutation.mutateAsync({
				id: scriptId
			})
			analyzeSucceeded = true
			// 提交成功后刷新余额（lockCredits 已扣减）
			queryClient.invalidateQueries({ queryKey: creditKeys.balance() })
			navigate(`/analyzing-task/${taskId}?scriptId=${scriptId}`, {
				replace: true
			})
		} catch (e) {
			// INSUFFICIENT_CREDITS：余额不足，保留 script 草稿（用户充值后可在历史里重新分析）
			const isInsufficient =
				e instanceof RequestError && e.code === 'INSUFFICIENT_CREDITS'
			// 孤儿补偿：upload 成功但 analyze 失败 -> 删除 script（避免 History 残留僵尸记录）
			// 但 INSUFFICIENT_CREDITS 时不删，保留草稿
			if (scriptId && !analyzeSucceeded && !isInsufficient) {
				try {
					await deleteMutation.mutateAsync(scriptId)
				} catch {
					// 删除失败不阻塞错误展示
				}
			}
			setErr(errText(e, '网络错误'))
			// 余额变化后刷新（可能是 INSUFFICIENT_CREDITS，也可能是其他扣减）
			queryClient.invalidateQueries({ queryKey: creditKeys.balance() })
		} finally {
			submittingRef.current = false
		}
	}, [
		mode,
		file,
		title,
		pastedText,
		pasteOverLimit,
		uploadMutation,
		createMutation,
		analyzeMutation,
		deleteMutation,
		navigate,
		queryClient
	])

	// === 切 tab：清错误 + 批量运行时禁切 ===
	const switchMode = useCallback(
		(next: Mode) => {
			if (batchRunning) return
			setErr(null)
			setBatchError(null)
			setMode(next)
		},
		[batchRunning]
	)

	// === 批量：添加文件 ===
	const addBatchFiles = useCallback((files: FileList | File[]) => {
		setBatchError(null)
		const arr = Array.from(files)
		setBatchItems((prev) => {
			const newItems: BatchItem[] = []
			for (const f of arr) {
				if (prev.length + newItems.length >= MAX_BATCH_COUNT) {
					setBatchError(
						`已达批量上限 ${MAX_BATCH_COUNT} 个，超出部分被跳过`
					)
					break
				}
				const r = validateFile(f)
				if (!r.ok) {
					setBatchError(r.msg)
					continue
				}
				// 三维去重：name + size + lastModified
				const exists = prev.some(
					(i) =>
						i.file.name === f.name &&
						i.file.size === f.size &&
						i.file.lastModified === f.lastModified
				)
				if (exists) continue
				newItems.push({
					id: crypto.randomUUID(),
					file: f,
					title: f.name.replace(/\.[^.]+$/, ''),
					status: 'pending'
				})
			}
			return [...prev, ...newItems]
		})
	}, [])

	const removeBatchItem = useCallback((id: string) => {
		setBatchItems((prev) => prev.filter((i) => i.id !== id))
	}, [])

	const updateBatchTitle = useCallback((id: string, v: string) => {
		setBatchItems((prev) =>
			prev.map((i) => (i.id === id ? { ...i, title: v } : i))
		)
	}, [])

	// === 批量：聚合统计（一次 reduce） ===
	const batchStats = useMemo(() => {
		return batchItems.reduce(
			(acc, i) => {
				acc.total++
				if (i.status === 'done') acc.done++
				else if (i.status === 'error') acc.error++
				else acc.waiting++
				return acc
			},
			{ total: 0, done: 0, error: 0, waiting: 0 }
		)
	}, [batchItems])

	const batchProgress =
		batchStats.total === 0
			? 0
			: Math.round(
					((batchStats.done + batchStats.error) / batchStats.total) *
						100
			  )

	// === 批量：本次待处理的总积分消耗 ===
	const batchCost = batchStats.waiting * COST_PER_ANALYZE
	const batchInsufficientBalance = batchCost > 0 && balance < batchCost

	// === 批量：取消（主动 stop 已 analyze 的 task，不必等 worker 走取消点） ===
	const cancelBatch = useCallback(async () => {
		cancelRef.current?.abort()
		const running = batchItems.filter(
			(i) => i.status === 'queued' && i.taskId && i.scriptId
		)
		await Promise.all(
			running.map((i) =>
				stopMutation
					.mutateAsync({ scriptId: i.scriptId!, taskId: i.taskId! })
					.catch(() => {
						// 409 conflict / 已 canceled 等都静默吞
					})
			)
		)
	}, [batchItems, stopMutation])

	// === 批量：3 路并发执行 ===
	const runBatch = useCallback(async () => {
		if (submittingRef.current) return
		submittingRef.current = true
		setBatchError(null)
		setBatchRunning(true)
		cancelRef.current = new AbortController()
		const signal = cancelRef.current.signal

		try {
			const queue = batchItems.filter(
				(i) => i.status === 'pending' || i.status === 'error'
			)
			let successCount = 0
			let failCount = 0
			let idx = 0

			const worker = async () => {
				while (idx < queue.length && !signal.aborted) {
					const item = queue[idx++]
					// 局部跟踪：用于 catch 时判断孤儿补偿
					let scriptId: string | undefined
					let taskId: string | undefined
					try {
						setBatchItems((prev) =>
							prev.map((i) =>
								i.id === item.id
									? {
											...i,
											status: 'uploading',
											error: undefined
									  }
									: i
							)
						)
						const script = await uploadMutation.mutateAsync({
							title:
								item.title.trim() ||
								item.file.name.replace(/\.[^.]+$/, ''),
							file: item.file
						})
						scriptId = script.id
						setBatchItems((prev) =>
							prev.map((i) =>
								i.id === item.id
									? { ...i, status: 'queued', scriptId }
									: i
							)
						)

						// 取消点 1：上传完成但未触发 analyze → 删孤儿
						if (signal.aborted) {
							try {
								await deleteMutation.mutateAsync(scriptId)
							} catch {
								// ignore
							}
							setBatchItems((prev) =>
								prev.map((i) =>
									i.id === item.id
										? {
												...i,
												status: 'pending',
												scriptId: undefined
										  }
										: i
								)
							)
							break
						}

						const r = await analyzeMutation.mutateAsync({
							id: scriptId
						})
						taskId = r.taskId
						setBatchItems((prev) =>
							prev.map((i) =>
								i.id === item.id ? { ...i, taskId } : i
							)
						)

						// 取消点 2：已 analyze → 调 stop（409 静默吞）
						if (signal.aborted) {
							try {
								await stopMutation.mutateAsync({
									scriptId,
									taskId
								})
							} catch {
								// ignore
							}
							setBatchItems((prev) =>
								prev.map((i) =>
									i.id === item.id
										? {
												...i,
												status: 'pending',
												scriptId: undefined,
												taskId: undefined
										  }
										: i
								)
							)
							break
						}

						setBatchItems((prev) =>
							prev.map((i) =>
								i.id === item.id ? { ...i, status: 'done' } : i
							)
						)
						successCount++
					} catch (e) {
						// 孤儿补偿：upload 成功但 analyze 失败 → 删 script
						if (scriptId && !taskId) {
							try {
								await deleteMutation.mutateAsync(scriptId)
							} catch {
								// ignore
							}
						}
						const msg = errText(e)
						setBatchItems((prev) =>
							prev.map((i) =>
								i.id === item.id
									? {
											...i,
											status: 'error',
											error: msg,
											scriptId: undefined,
											taskId: undefined
									  }
									: i
							)
						)
						failCount++
					}
				}
			}

			await Promise.all(
				Array.from(
					{ length: Math.min(MAX_CONCURRENCY, queue.length) },
					() => worker()
				)
			)

			if (signal.aborted) {
				toast.info('已停止批量任务')
				// 把中断时还在 uploading/queued 的项回退到 pending
				setBatchItems((prev) =>
					prev.map((i) =>
						i.status === 'uploading' || i.status === 'queued'
							? {
									...i,
									status: 'pending',
									scriptId: undefined,
									taskId: undefined
							  }
							: i
					)
				)
			} else if (failCount === 0 && successCount > 0) {
				toast.success(`批量完成：${successCount} 个全部成功`)
				setBatchItems([])
				navigate('/history', { replace: true })
			} else if (successCount > 0) {
				toast.error(
					`批量完成：${successCount} 成功 / ${failCount} 失败，失败项可重试`
				)
			} else if (failCount > 0) {
				toast.error(`批量失败：${failCount} 个全部失败，请检查后重试`)
			}
		} finally {
			setBatchRunning(false)
			submittingRef.current = false
			cancelRef.current = null
		}
	}, [
		batchItems,
		uploadMutation,
		analyzeMutation,
		deleteMutation,
		stopMutation,
		navigate
	])

	// === 键盘激活拖拽区（a11y） ===
	const onDropzoneKey = (cb: () => void) => (e: ReactKeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault()
			cb()
		}
	}

	return (
		<div
			style={{
				position: 'relative',
				padding: '32px 28px',
				minHeight: 'calc(100vh - 72px)'
			}}
		>
			<PageBackground decorLevel="L2" />

			<div
				className="mx-auto w-full max-w-[80vw]"
				style={{ position: 'relative', zIndex: 1 }}
			>
				{/* Hero */}
				<div
					style={{
						...cardCinemaStyle,
						display: 'flex',
						flexDirection: 'column',
						gap: 12,
						padding: 28,
						borderRadius: 14,
						marginBottom: 24,
						position: 'relative',
						overflow: 'hidden'
					}}
				>
					<div className="flex flex-wrap items-center gap-3">
						<h1
							className="font-serif"
							style={{
								margin: 0,
								fontSize: 'clamp(28px, 3vw, 40px)',
								fontWeight: 600,
								lineHeight: 1.1,
								letterSpacing: '-0.02em',
								color: 'var(--color-text)'
							}}
						>
							导入剧本
						</h1>
					</div>
					<p
						className="font-sans"
						style={{
							margin: 0,
							maxWidth: 680,
							fontSize: 13,
							color: 'var(--color-text-muted)',
							lineHeight: 1.7
						}}
					>
						支持 txt、pdf、docx、md。单文件 ≤ 20MB，粘贴文本 ≤ 50
						万字
					</p>
				</div>

				<div className="grid w-full gap-6 grid-cols-1 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,360px)]">
					{/* 主区 */}
					<section
						style={{
							...cardCinemaStyle,
							display: 'flex',
							flexDirection: 'column',
							gap: 16,
							padding: 24,
							borderRadius: 14
						}}
					>
						{/* 标题（仅 upload/paste） */}
						{mode !== 'batch' && (
							<div className="mb-6">
								<label
									className="mb-2 block font-sans text-xs"
									style={{
										color: 'var(--color-text-subtle)',
										letterSpacing: '0.1em'
									}}
								>
									剧本标题
								</label>
								<input
									type="text"
									value={title}
									onChange={(e) => setTitle(e.target.value)}
									placeholder="给你的剧本起一个名字"
									className="input-cinema"
									maxLength={TITLE_MAX}
									aria-label="剧本标题"
								/>
								<div
									className="mt-1 text-right font-sans text-[11px]"
									style={{
										color:
											title.length >= TITLE_MAX - 10
												? 'var(--color-primary)'
												: 'var(--color-text-subtle)'
									}}
								>
									{title.length} / {TITLE_MAX}
								</div>
							</div>
						)}

						{/* Tab 切换（数据驱动；批量运行时禁切避免资源竞争） */}
						<div
							className="mb-6 flex flex-wrap items-center gap-3 font-sans text-sm"
							role="tablist"
							aria-label="导入模式"
						>
							{MODES.map((m) => (
								<button
									key={m.key}
									type="button"
									role="tab"
									aria-selected={mode === m.key}
									disabled={batchRunning}
									onClick={() => switchMode(m.key)}
									className="rounded-full px-4 py-2 transition-colors"
									style={{
										...(mode === m.key
											? tabActiveStyle
											: tabInactiveStyle),
										opacity: batchRunning ? 0.5 : 1,
										cursor: batchRunning
											? 'not-allowed'
											: 'pointer'
									}}
								>
									{m.label}
								</button>
							))}
						</div>

						{/* 内容区 - upload 模式 */}
						{mode === 'upload' && (
							<div
								role="button"
								tabIndex={0}
								aria-label="选择剧本文件（拖入或按 Enter 选择）"
								style={{
									...dropzoneBaseStyle,
									minHeight: '320px',
									border: drag
										? '1px solid rgba(184,68,60,0.35)'
										: '1px dashed rgba(102,89,76,0.22)',
									background: drag
										? 'rgba(184,68,60,0.05)'
										: 'rgba(255,252,247,0.78)',
									cursor: 'pointer'
								}}
								onDragOver={(e) => {
									e.preventDefault()
									if (!drag) setDrag(true)
								}}
								onDragLeave={() => setDrag(false)}
								onDrop={(e) => {
									e.preventDefault()
									setDrag(false)
									const f = e.dataTransfer.files?.[0]
									if (f) onPickFile(f)
								}}
								onClick={() => inputRef.current?.click()}
								onKeyDown={onDropzoneKey(() =>
									inputRef.current?.click()
								)}
							>
								<input
									ref={inputRef}
									type="file"
									accept={ACCEPT}
									aria-label="选择剧本文件"
									style={{ display: 'none' }}
									onChange={(e) => {
										const f = e.target.files?.[0]
										if (f) onPickFile(f)
										// 清空 value：用户取消或重选同一文件能再次触发 onChange
										e.target.value = ''
									}}
								/>
								<div
									className="flex h-full flex-col items-center justify-center px-8 text-center"
									style={{ minHeight: '320px' }}
								>
									<div
										style={{
											width: '64px',
											height: '64px',
											borderRadius: '18px',
											display: 'flex',
											alignItems: 'center',
											justifyContent: 'center',
											background: 'rgba(184,68,60,0.08)',
											marginBottom: '20px'
										}}
									>
										<UploadIcon
											size={28}
											color="var(--color-primary)"
										/>
									</div>
									{file ? (
										<>
											<div
												className="font-serif text-2xl font-bold"
												style={{
													color: 'var(--color-text)'
												}}
											>
												{file.name}
											</div>
											<div
												className="mt-3 font-sans text-sm"
												style={{
													color: 'var(--color-text-muted)'
												}}
											>
												{(file.size / 1024).toFixed(1)}{' '}
												KB · 点击重新选择文件
											</div>
										</>
									) : (
										<>
											<div
												className="font-serif text-3xl font-bold"
												style={{
													color: 'var(--color-text)'
												}}
											>
												将剧本拖入此处
											</div>
											<div
												className="mt-3 font-sans text-sm"
												style={{
													color: 'var(--color-text-muted)'
												}}
											>
												或点击选择本地文件
											</div>
											<div
												className="mt-6 rounded-full px-4 py-2 font-sans text-xs"
												style={{
													color: 'var(--color-text-subtle)',
													background:
														'rgba(102,89,76,0.05)'
												}}
											>
												单文件 ≤ 20MB
											</div>
										</>
									)}
								</div>
							</div>
						)}

						{/* 内容区 - paste 模式 */}
						{mode === 'paste' && (
							<div
								className="panel-paper-soft"
								style={{ minHeight: '320px', padding: '22px' }}
							>
								<textarea
									value={pastedText}
									onChange={(e) =>
										setPastedText(e.target.value)
									}
									placeholder="将剧本文本粘贴到这里，建议保留基本段落、场次和人物对白格式。"
									className="w-full resize-none bg-transparent font-sans outline-none"
									aria-label="粘贴剧本文本"
									style={{
										minHeight: '260px',
										color: 'var(--color-text)',
										fontSize: '15px',
										lineHeight: '1.85'
									}}
								/>
								<div
									className="mt-4 flex items-center justify-between font-sans text-xs"
									style={{
										color: pasteOverLimit
											? 'var(--color-primary)'
											: 'var(--color-text-subtle)'
									}}
								>
									<span>
										建议保留标题、分集、场次和关键对白，知识库判断会更稳定。
									</span>
									<span>
										{pastedText.length.toLocaleString()} /{' '}
										{MAX_PASTE_LENGTH.toLocaleString()}
										{pasteOverLimit ? ' ⚠ 超限' : ''}
									</span>
								</div>
							</div>
						)}

						{/* 内容区 - batch 模式 */}
						{mode === 'batch' && (
							<div
								style={{
									display: 'flex',
									flexDirection: 'column',
									flex: 1,
									minHeight: 0
								}}
							>
								{/* 多文件选择区 */}
								<div
									role="button"
									tabIndex={batchRunning ? -1 : 0}
									aria-label="选择多个剧本文件（拖入或按 Enter 选择）"
									aria-disabled={batchRunning}
									style={{
										...dropzoneBaseStyle,
										display: 'flex',
										flexDirection: 'column',
										flex: 1,
										minHeight: '200px',
										border: batchDrag
											? '1px solid rgba(184,68,60,0.35)'
											: '1px dashed rgba(102,89,76,0.22)',
										background: batchDrag
											? 'rgba(184,68,60,0.05)'
											: 'rgba(255,252,247,0.78)',
										cursor: batchRunning
											? 'not-allowed'
											: 'pointer',
										opacity: batchRunning ? 0.6 : 1
									}}
									onDragOver={(e) => {
										e.preventDefault()
										if (!batchRunning && !batchDrag)
											setBatchDrag(true)
									}}
									onDragLeave={() => setBatchDrag(false)}
									onDrop={(e) => {
										e.preventDefault()
										setBatchDrag(false)
										if (batchRunning) return
										const files = e.dataTransfer.files
										if (files && files.length > 0) {
											addBatchFiles(files)
										}
									}}
									onClick={() => {
										if (!batchRunning)
											batchInputRef.current?.click()
									}}
									onKeyDown={
										batchRunning
											? undefined
											: onDropzoneKey(() =>
													batchInputRef.current?.click()
											  )
									}
								>
									<input
										ref={batchInputRef}
										type="file"
										multiple
										accept={ACCEPT}
										aria-label="选择多个剧本文件"
										style={{ display: 'none' }}
										onChange={(e) => {
											if (
												e.target.files &&
												e.target.files.length > 0
											) {
												addBatchFiles(e.target.files)
											}
											// 允许重复选同一文件
											e.target.value = ''
										}}
									/>
									<div
										className="flex flex-col items-center justify-center px-8 text-center"
										style={{ flex: 1, minHeight: '200px' }}
									>
										<div
											style={{
												width: '56px',
												height: '56px',
												borderRadius: '16px',
												display: 'flex',
												alignItems: 'center',
												justifyContent: 'center',
												background:
													'rgba(184,68,60,0.08)',
												marginBottom: '16px'
											}}
										>
											<FilePlus2
												size={24}
												color="var(--color-primary)"
											/>
										</div>
										<div
											className="font-serif text-2xl font-bold"
											style={{
												color: 'var(--color-text)'
											}}
										>
											拖入多个剧本文件
										</div>
										<div
											className="mt-2 font-sans text-sm"
											style={{
												color: 'var(--color-text-muted)'
											}}
										>
											或点击选择（支持一次选多个），txt /
											pdf / docx / md，单文件 ≤ 20MB，最多{' '}
											{MAX_BATCH_COUNT} 个
										</div>
									</div>
								</div>

								{/* 批量整体进度（运行中或已完成时显示） */}
								{batchStats.total > 0 && (
									<div
										className="mt-5"
										aria-live="polite"
										aria-atomic="true"
									>
										<div
											className="mb-2 flex items-center justify-between font-sans text-xs"
											style={{
												color: 'var(--color-text-subtle)'
											}}
										>
											<span>
												{batchRunning
													? '处理中…'
													: '当前进度'}
												（
												{batchStats.done +
													batchStats.error}{' '}
												/ {batchStats.total}）
											</span>
											<span>
												{batchStats.done} 成功 ·{' '}
												{batchStats.error} 失败 ·{' '}
												{batchStats.waiting} 待处理
											</span>
										</div>
										<AnimatedProgress
											value={batchProgress}
											height={8}
											showStripes={batchRunning}
											isError={
												batchStats.error > 0 &&
												!batchRunning
											}
										/>
									</div>
								)}

								{/* 文件列表 */}
								{batchItems.length > 0 && (
									<div className="mt-5 grid gap-2">
										{batchItems.map((item, idx) => (
											<BatchRow
												key={item.id}
												index={idx}
												item={item}
												onTitleChange={(v) =>
													updateBatchTitle(item.id, v)
												}
												onRemove={() =>
													removeBatchItem(item.id)
												}
												disabled={batchRunning}
											/>
										))}
									</div>
								)}

								{/* 批量错误 */}
								{batchError && (
									<ErrorMsg
										text={batchError}
										className="mt-4"
									/>
								)}

								{/* 批量操作行 */}
								<div className="mt-8 flex flex-wrap items-center justify-between gap-4">
									<div>
										<div
											className="font-sans text-xs"
											style={{
												color: 'var(--color-text-subtle)'
											}}
										>
											{batchItems.length === 0
												? '3 路并发上传/分析，避免知识库并发限流'
												: `共 ${batchStats.total} 个 · 已提交 ${batchStats.done} · 失败 ${batchStats.error} · 待处理 ${batchStats.waiting}`}
										</div>
										{batchCost > 0 && (
											<div
												className="font-sans text-xs mt-1"
												style={{
													color: 'rgb(220 38 38)'
												}}
											>
												本次分析将消耗{' '}
												{fmtCredits(batchCost)} 积分
												{batchInsufficientBalance && (
													<>
														，当前余额{' '}
														{fmtCredits(balance)}
														积分，还差{' '}
														{fmtCredits(
															batchCost - balance
														)}
														积分。
													</>
												)}
											</div>
										)}
									</div>
									<div className="flex flex-wrap gap-3">
										{batchStats.done > 0 && !batchRunning && (
											<Link
												to="/history"
												className="btn-cinema-ghost"
												style={{
													height: '48px',
													lineHeight: '48px'
												}}
											>
												查看历史
											</Link>
										)}
										{batchRunning && (
											<button
												type="button"
												onClick={cancelBatch}
												className="btn-cinema-ghost"
												style={{
													height: '48px',
													lineHeight: '48px',
													minWidth: '120px',
													display: 'flex',
													alignItems: 'center',
													justifyContent: 'center',
													gap: 6
												}}
											>
												<StopIcon size={14} />
												停止
											</button>
										)}
										<button
											type="button"
											onClick={runBatch}
											disabled={
												batchRunning ||
												batchStats.waiting === 0
											}
											className="btn-cinema-primary"
											style={{
												minWidth: '220px',
												height: '48px'
											}}
										>
											{batchRunning
												? '处理中…'
												: '批量导入并分析'}
										</button>
									</div>
								</div>
							</div>
						)}

						{/* 单文件/粘贴 错误提示 */}
						{mode !== 'batch' && err && <ErrorMsg text={err} />}

						{/* 单文件/粘贴 操作行 */}
						{mode !== 'batch' && (
							<div className="mt-8">
								<div className="flex flex-wrap items-center justify-between gap-4">
									<div>
										<div
											className="font-sans text-xs"
											style={{
												color: 'var(--color-text-subtle)'
											}}
										>
											你上传的内容仅用于当前分析任务，报告生成后可在历史中查看。
										</div>
										<div
											className="font-sans text-xs mt-1"
											style={{
												color: 'rgb(220 38 38)'
											}}
										>
											本次分析将消耗{' '}
											{fmtCredits(COST_PER_ANALYZE)} 积分
											{insufficientBalance && (
												<>
													，当前余额{' '}
													{fmtCredits(balance)}
													积分，还差{' '}
													{fmtCredits(
														COST_PER_ANALYZE -
															balance
													)}
													积分。
												</>
											)}
										</div>
									</div>
									<button
										type="button"
										onClick={submit}
										disabled={submitting || !canSubmit}
										className="btn-cinema-primary"
										style={{
											minWidth: '220px',
											height: '48px'
										}}
									>
										{submitting ? '提交中…' : '开始分析'}
									</button>
								</div>
								{insufficientBalance && (
									<div
										role="alert"
										className="mt-3 font-sans text-xs"
										style={{
											color: 'rgb(220 38 38)',
											background: 'rgba(239 68 68 / 8%)',
											border: '1px solid rgba(239 68 68 / 24%)',
											borderRadius: '8px',
											padding: '8px 12px'
										}}
									>
										积分不足，请联系系统工作人员充值
									</div>
								)}
							</div>
						)}
					</section>

					{/* 侧栏：提交前检查清单 */}
					<aside
						className="panel-paper"
						style={{
							...cardCinemaStyle,
							padding: '24px',
							alignSelf: 'start',
							borderRadius: '14px'
						}}
					>
						<div className="eyebrow mb-2">提交前确认</div>
						<div
							className="font-serif text-2xl font-bold"
							style={{ color: 'var(--color-text)' }}
						>
							提交前检查
						</div>

						<div className="mt-5 grid gap-3">
							<ChecklistItem text="剧本标题、题材、人物关系尽量明确" />
							<ChecklistItem text="保留分段和对白，减少纯碎片文本" />
							<ChecklistItem text="若是片段稿，建议至少包含核心冲突段落" />
							<ChecklistItem text="分析将直接调用后台已配置的知识库" />
						</div>

						<InfoBlock
							icon={<Clock size={14} />}
							title="评估流程"
							text="上传完成后，点击「开始分析」，知识库将于五分钟内生成专业、客观的剧本评估报告。"
						/>

						<InfoBlock
							icon={<LockIcon size={14} />}
							title="数据安全"
							text="全程 SSL 加密传输，评估完成即自动删除原文件，仅留存评估报告，确保你的作品机密与版权安全。"
						/>
					</aside>
				</div>
			</div>
		</div>
	)
}

// === 子组件：错误提示（role=alert，a11y 友好） ===
function ErrorMsg({ text, className }: { text: string; className?: string }) {
	return (
		<div
			role="alert"
			className={`rounded-[12px] px-4 py-3 font-sans text-sm ${
				className ?? 'mt-5'
			}`}
			style={{
				color: 'var(--color-primary)',
				background: 'rgba(184,68,60,0.08)',
				border: '1px solid rgba(184,68,60,0.18)'
			}}
		>
			{text}
		</div>
	)
}

// === 子组件：批量文件行（memo 优化） ===
const BATCH_STATUS_MAP: Record<
	BatchStatus,
	{ Icon: typeof Clock; color: string; text: string; spin?: boolean }
> = {
	pending: { Icon: Clock, color: 'var(--color-text-subtle)', text: '等待' },
	uploading: {
		Icon: Loader2,
		color: 'var(--color-primary)',
		text: '上传中',
		spin: true
	},
	queued: {
		Icon: Loader2,
		color: 'var(--color-primary)',
		text: '已入队',
		spin: true
	},
	done: { Icon: CheckCircle2, color: '#4A7C5A', text: '已提交' },
	error: { Icon: XCircle, color: 'var(--color-primary)', text: '失败' }
}

export const BatchRow = memo(function BatchRow({
	index,
	item,
	onTitleChange,
	onRemove,
	disabled
}: {
	index: number
	item: BatchItem
	onTitleChange: (v: string) => void
	onRemove: () => void
	disabled: boolean
}) {
	const info = BATCH_STATUS_MAP[item.status]
	const { Icon } = info
	const titleLocked =
		disabled ||
		item.status === 'uploading' ||
		item.status === 'queued' ||
		item.status === 'done'

	return (
		<div
			style={{
				padding: '10px 14px',
				borderRadius: '12px',
				background: 'rgba(255,252,247,0.82)',
				border:
					item.status === 'error'
						? '1px solid rgba(184,68,60,0.24)'
						: '1px solid rgba(102,89,76,0.1)'
			}}
		>
			<div className="grid items-center gap-[12px] grid-cols-[28px_minmax(0,1fr)_28px] sm:grid-cols-[28px_minmax(0,1fr)_88px_92px_28px]">
				<div
					className="font-mono text-xs"
					style={{ color: 'var(--color-text-subtle)' }}
				>
					#{index + 1}
				</div>
				<input
					type="text"
					value={item.title}
					onChange={(e) => onTitleChange(e.target.value)}
					disabled={titleLocked}
					className="font-sans text-sm"
					aria-label={`第 ${index + 1} 个剧本标题`}
					style={{
						background: 'transparent',
						border: 'none',
						outline: 'none',
						color: 'var(--color-text)',
						padding: '4px 0',
						width: '100%',
						minWidth: 0
					}}
					maxLength={TITLE_MAX}
				/>
				<button
					type="button"
					onClick={onRemove}
					disabled={disabled}
					aria-label={`移除第 ${index + 1} 个文件`}
					title="移除"
					className="row-start-1 col-start-3 sm:col-start-5"
					style={{
						background: 'transparent',
						border: 'none',
						color: 'var(--color-text-subtle)',
						padding: 4,
						opacity: disabled ? 0.4 : 1,
						cursor: disabled ? 'not-allowed' : 'pointer',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center'
					}}
				>
					<Trash2 size={14} />
				</button>
				<div
					className="col-start-1 col-end-[-1] sm:col-start-3 sm:col-auto flex items-center gap-3 font-mono text-xs"
					style={{ color: 'var(--color-text-subtle)' }}
				>
					<span>{(item.file.size / 1024).toFixed(1)} KB</span>
					<span
						className="flex items-center gap-1 font-sans"
						style={{ color: info.color }}
					>
						<Icon
							size={12}
							className={info.spin ? 'animate-spin' : ''}
						/>
						<span>{info.text}</span>
					</span>
				</div>
			</div>
			{item.error && (
				<div
					className="mt-1 font-sans text-xs"
					style={{
						color: 'var(--color-primary)',
						paddingLeft: '40px'
					}}
				>
					{item.error}
				</div>
			)}
		</div>
	)
})

// === 子组件：侧栏信息卡 ===
function InfoBlock({
	icon,
	title,
	text
}: {
	icon: ReactNode
	title: string
	text: string
}) {
	return (
		<div
			className="mt-5 rounded-[16px]"
			style={{
				padding: '16px',
				background:
					'linear-gradient(135deg, rgba(184,68,60,0.06) 0%, rgba(255,255,255,0.78) 100%)',
				border: '1px solid rgba(184,68,60,0.18)'
			}}
		>
			<div
				className="mb-2 flex items-center gap-1.5 font-sans text-[11px]"
				style={{
					color: 'var(--color-primary)',
					letterSpacing: '0.1em'
				}}
			>
				<span
					style={{
						display: 'inline-flex',
						alignItems: 'center',
						justifyContent: 'center',
						width: 22,
						height: 22,
						borderRadius: 6,
						background: 'rgba(184,68,60,0.12)'
					}}
				>
					{icon}
				</span>
				<span style={{ fontWeight: 700 }}>{title}</span>
			</div>
			<div
				className="font-sans text-[13px]"
				style={{ color: 'var(--color-text)', lineHeight: 1.75 }}
			>
				{text}
			</div>
		</div>
	)
}

function ChecklistItem({ text }: { text: string }) {
	return (
		<div
			style={{
				display: 'flex',
				gap: '12px',
				alignItems: 'flex-start',
				padding: '12px 14px',
				borderRadius: '12px',
				background: 'rgba(255,255,255,0.72)',
				border: '1px solid rgba(102,89,76,0.08)'
			}}
		>
			<span
				style={{
					width: '8px',
					height: '8px',
					marginTop: '7px',
					borderRadius: '999px',
					background: 'var(--color-primary)',
					flexShrink: 0
				}}
			/>
			<span
				className="font-sans text-sm"
				style={{ color: 'var(--color-text-muted)', lineHeight: 1.7 }}
			>
				{text}
			</span>
		</div>
	)
}
