// CreditAdjustDrawer - 积分调配右侧抽屉（admin only）
// -----------------------------------------------------------------------------
// 功能：
//   - 从用户管理列表行内"积分调配"按钮触发，保留列表和筛选状态
//   - 头部展示用户头像/用户名/当前余额
//   - 调配方式 tabs：增加积分 | 扣减积分
//   - 增加积分：固定 2000/4000/6000 三档快捷按钮 + 自定义数量输入
//   - 调配原因下拉推荐 + 自定义
//   - 调配后余额预览（扣减不允许小于 0）
//   - 最近变动 5 条 + 查看全部记录链接
//   - 二次确认 Modal（用户/类型/数量/调配后余额/原因）
//   - 防重复提交（mutation.isPending 时按钮 disabled）
// =============================================================================

import {
	ArrowRight,
	CheckCircle2,
	Coins,
	Loader2,
	ShieldAlert,
	X
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAdminUserDetail } from '../../api/admin-users'
import {
	useAdjustUserCredits,
	useUserCreditTransactions
} from '../../api/credit'
import { fmtCredits, fmtDelta, txDisplay } from '../../lib/credit-tx-display'
import { RequestError } from '../../lib/request'
import type { AdjustCategory, AdjustCreditsInput } from '../../types/credit'
import styles from './CreditAdjustDrawer.module.css'

interface Props {
	userId: string | null // null 时抽屉不打开
	open: boolean
	onClose: () => void
}

const QUICK_AMOUNTS = [2000, 4000, 6000]

const REASON_OPTIONS = [
	'展会现场充值',
	'现场体验补发',
	'异常任务补偿',
	'__custom__'
] as const

type ReasonOption = typeof REASON_OPTIONS[number]

export function CreditAdjustDrawer({ userId, open, onClose }: Props) {
	// 抽屉关闭时仍保留 userId 以做退出动画
	const effectiveUserId = userId ?? ''

	return (
		<AnimatePresence>
			{open && effectiveUserId && (
				<DrawerInner
					key={effectiveUserId}
					userId={effectiveUserId}
					onClose={onClose}
				/>
			)}
		</AnimatePresence>
	)
}

function DrawerInner({
	userId,
	onClose
}: {
	userId: string
	onClose: () => void
}) {
	const { data: user, isLoading: userLoading } = useAdminUserDetail(userId)
	const { data: txData } = useUserCreditTransactions(userId, { pageSize: 5 })

	// 调配方式：add=增加积分（recharge/compensate），deduct=扣减积分
	const [mode, setMode] = useState<'add' | 'deduct'>('add')
	const [amount, setAmount] = useState<number>(2000) // 正整数（提交时按 mode 转 delta 符号）
	const [reasonOption, setReasonOption] =
		useState<ReasonOption>('展会现场充值')
	const [customReason, setCustomReason] = useState('')
	const [category, setCategory] = useState<AdjustCategory>('recharge')
	const [confirmOpen, setConfirmOpen] = useState(false)
	const [successMsg, setSuccessMsg] = useState<string | null>(null)

	const adjustMutation = useAdjustUserCredits(userId)

	// Esc 关闭
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				if (confirmOpen) setConfirmOpen(false)
				else onClose()
			}
		}
		window.addEventListener('keydown', handler)
		return () => window.removeEventListener('keydown', handler)
	}, [onClose, confirmOpen])

	const currentBalance = user?.creditBalance ?? 0
	const delta = mode === 'add' ? amount : -amount
	const balanceAfter = currentBalance + delta
	const invalidDeduct = mode === 'deduct' && balanceAfter < 0
	const invalidAmount = amount <= 0 || !Number.isInteger(amount)
	const invalidReason =
		reasonOption === '__custom__' ? !customReason.trim() : !reasonOption
	const canSubmit =
		!invalidAmount &&
		!invalidDeduct &&
		!invalidReason &&
		!adjustMutation.isPending

	const finalRemark =
		reasonOption === '__custom__' ? customReason.trim() : reasonOption

	// 切换 mode 时重置 amount 和 category
	function switchMode(next: 'add' | 'deduct') {
		if (next === mode) return
		setMode(next)
		setAmount(next === 'add' ? 2000 : 100)
		setCategory(next === 'add' ? 'recharge' : 'deduct')
		setSuccessMsg(null)
	}

	// 点快捷档位：自动填入数量，category=recharge（后台充值）
	function applyQuickAmount(value: number) {
		setAmount(value)
		setCategory('recharge')
		setSuccessMsg(null)
	}

	// 手动输入数量：增加模式下 category=compensate（人工补偿）
	function handleAmountChange(v: number) {
		setAmount(v)
		if (mode === 'add') {
			// 如果输入值正好是快捷档位之一，仍算 recharge；否则 compensate
			setCategory(QUICK_AMOUNTS.includes(v) ? 'recharge' : 'compensate')
		}
		setSuccessMsg(null)
	}

	function handleReasonChange(v: ReasonOption) {
		setReasonOption(v)
		setSuccessMsg(null)
	}

	function openConfirm() {
		if (!canSubmit) return
		setConfirmOpen(true)
	}

	function handleSubmit() {
		if (!canSubmit) return
		const input: AdjustCreditsInput = {
			delta,
			remark: finalRemark,
			category
		}
		adjustMutation.mutate(input, {
			onSuccess: (res) => {
				setSuccessMsg(
					`调配成功：${finalRemark}，当前余额 ${fmtCredits(
						res.balanceAfter
					)}`
				)
				setConfirmOpen(false)
			}
		})
	}

	const recentTxs = useMemo(() => txData?.items ?? [], [txData])

	return (
		<>
			<motion.div
				className={styles.overlay}
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				exit={{ opacity: 0 }}
				transition={{ duration: 0.15 }}
				onClick={onClose}
			/>
			<motion.aside
				className={styles.drawer}
				initial={{ x: '100%' }}
				animate={{ x: 0 }}
				exit={{ x: '100%' }}
				transition={{ type: 'spring', damping: 30, stiffness: 320 }}
			>
				{/* ========== 头部 ========== */}
				<header className={styles.header}>
					<div className={styles.headerLeft}>
						<div className={styles.headerIcon}>
							<Coins />
						</div>
						<div>
							<h2 className={styles.title}>积分调配</h2>
							<p className={styles.subtitle}>工作人员操作区</p>
						</div>
					</div>
					<button
						type="button"
						className={styles.closeBtn}
						onClick={onClose}
						aria-label="关闭"
					>
						<X />
					</button>
				</header>

				{/* ========== 用户信息卡 ========== */}
				<section className={styles.userCard}>
					{userLoading ? (
						<div className={styles.userCardLoading}>
							<Loader2 className={styles.spinner} />
							<span>加载用户信息…</span>
						</div>
					) : user ? (
						<>
							<div className={styles.userRow}>
								<span className={styles.avatar}>
									{user.username?.[0]?.toUpperCase() ?? 'U'}
								</span>
								<div className={styles.userMeta}>
									<span className={styles.userName}>
										{user.displayName || user.username}
									</span>
									<span className={styles.userSub}>
										@{user.username}
									</span>
								</div>
							</div>
							<div className={styles.balanceRow}>
								<span className={styles.balanceLabel}>
									当前余额
								</span>
								<span
									className={`${styles.balanceValue} ${
										currentBalance < 2000
											? styles.balanceLow
											: ''
									}`}
								>
									{fmtCredits(currentBalance)}
								</span>
								{currentBalance < 2000 && (
									<span className={styles.balanceWarn}>
										余额不足
									</span>
								)}
							</div>
						</>
					) : (
						<div className={styles.userCardError}>
							用户信息加载失败
						</div>
					)}
				</section>

				{/* ========== 调配表单 ========== */}
				<section className={styles.formSection}>
					{/* 调配方式 tabs */}
					<div className={styles.tabs}>
						<button
							type="button"
							className={`${styles.tab} ${
								mode === 'add' ? styles.tabActive : ''
							}`}
							onClick={() => switchMode('add')}
						>
							增加积分
						</button>
						<button
							type="button"
							className={`${styles.tab} ${
								mode === 'deduct' ? styles.tabActive : ''
							}`}
							onClick={() => switchMode('deduct')}
						>
							扣减积分
						</button>
					</div>

					{/* 快捷档位（仅增加模式） */}
					{mode === 'add' && (
						<div className={styles.field}>
							<span className={styles.label}>
								快捷档位（点击填入）
							</span>
							<div className={styles.quickRow}>
								{QUICK_AMOUNTS.map((amt) => (
									<button
										key={amt}
										type="button"
										className={`${styles.quickBtn} ${
											amount === amt &&
											category === 'recharge'
												? styles.quickBtnActive
												: ''
										}`}
										onClick={() => applyQuickAmount(amt)}
									>
										+{fmtCredits(amt)}
									</button>
								))}
							</div>
						</div>
					)}

					{/* 数量输入 */}
					<div className={styles.field}>
						<span className={styles.label}>
							{mode === 'add' ? '充值数量' : '扣减数量'}（正整数）
						</span>
						<input
							className={styles.amountInput}
							type="number"
							min={1}
							step={1}
							value={amount}
							onChange={(e) =>
								handleAmountChange(
									Math.max(
										1,
										Math.floor(Number(e.target.value) || 1)
									)
								)
							}
						/>
						{mode === 'add' && (
							<span className={styles.hint}>
								{category === 'recharge'
									? '当前为后台充值（快捷档位）'
									: '当前为人工补偿（自定义金额）'}
							</span>
						)}
					</div>

					{/* 调配原因 */}
					<div className={styles.field}>
						<span className={styles.label}>调配原因（必填）</span>
						<select
							className={styles.select}
							value={reasonOption}
							onChange={(e) =>
								handleReasonChange(
									e.target.value as ReasonOption
								)
							}
						>
							<option value="展会现场充值">展会现场充值</option>
							<option value="现场体验补发">现场体验补发</option>
							<option value="异常任务补偿">异常任务补偿</option>
							<option value="__custom__">其他（自定义）</option>
						</select>
						{reasonOption === '__custom__' && (
							<input
								className={styles.input}
								placeholder="请输入调配原因"
								value={customReason}
								onChange={(e) =>
									setCustomReason(e.target.value)
								}
								maxLength={255}
							/>
						)}
					</div>

					{/* 余额预览 */}
					<div
						className={`${styles.previewCard} ${
							invalidDeduct ? styles.previewCardDanger : ''
						}`}
					>
						<div className={styles.previewRow}>
							<span className={styles.previewLabel}>
								调配前余额
							</span>
							<span className={styles.previewValue}>
								{fmtCredits(currentBalance)}
							</span>
						</div>
						<ArrowRight className={styles.previewArrow} />
						<div className={styles.previewRow}>
							<span className={styles.previewLabel}>
								调配后余额
							</span>
							<span
								className={`${styles.previewValue} ${
									balanceAfter < 0
										? styles.previewValueDanger
										: ''
								}`}
							>
								{fmtCredits(balanceAfter)}
							</span>
						</div>
						<div className={styles.previewDelta}>
							<span className={styles.previewDeltaLabel}>
								变化量
							</span>
							<span
								className={
									delta > 0
										? styles.deltaPositive
										: styles.deltaNegative
								}
							>
								{fmtDelta(delta)}
							</span>
						</div>
					</div>

					{invalidDeduct && (
						<div className={styles.errorBox}>
							<ShieldAlert className={styles.errorIcon} />
							<span>
								扣减后余额不能小于 0（当前{' '}
								{fmtCredits(currentBalance)}）
							</span>
						</div>
					)}

					{adjustMutation.error && (
						<div className={styles.errorBox}>
							<ShieldAlert className={styles.errorIcon} />
							<span>
								调配失败：
								{(adjustMutation.error as RequestError).message}
							</span>
						</div>
					)}

					{successMsg && (
						<div className={styles.successBox}>
							<CheckCircle2 className={styles.successIcon} />
							<span>{successMsg}</span>
						</div>
					)}

					{/* 最近变动 */}
					<div className={styles.recentSection}>
						<div className={styles.recentHeader}>
							<span className={styles.recentTitle}>最近变动</span>
							<Link
								to={`/admin/users/${userId}`}
								className={styles.viewAllLink}
								onClick={onClose}
							>
								查看全部记录
							</Link>
						</div>
						{recentTxs.length === 0 ? (
							<div className={styles.recentEmpty}>
								暂无变动记录
							</div>
						) : (
							<ul className={styles.recentList}>
								{recentTxs.map((tx) => {
									const display = txDisplay(tx.type)
									return (
										<li
											key={tx.id}
											className={styles.recentItem}
										>
											<div
												className={
													styles.recentItemLeft
												}
											>
												<span
													className={`${
														styles.recentBadge
													} ${
														display.positive
															? styles.recentBadgePositive
															: styles.recentBadgeNegative
													}`}
												>
													{display.label}
												</span>
												<span
													className={
														styles.recentRemark
													}
												>
													{tx.remark ?? '—'}
												</span>
											</div>
											<div
												className={
													styles.recentItemRight
												}
											>
												<span
													className={
														display.positive
															? styles.deltaPositive
															: styles.deltaNegative
													}
												>
													{fmtDelta(tx.delta)}
												</span>
												<span
													className={
														styles.recentBalance
													}
												>
													余额{' '}
													{fmtCredits(
														tx.balanceAfter
													)}
												</span>
											</div>
										</li>
									)
								})}
							</ul>
						)}
					</div>
				</section>

				{/* ========== 底部按钮 ========== */}
				<footer className={styles.footer}>
					<button
						type="button"
						className={styles.cancelBtn}
						onClick={onClose}
						disabled={adjustMutation.isPending}
					>
						关闭
					</button>
					<button
						type="button"
						className={styles.submitBtn}
						onClick={openConfirm}
						disabled={!canSubmit}
					>
						{adjustMutation.isPending ? (
							<>
								<Loader2 className={styles.spinner} />
								<span>处理中…</span>
							</>
						) : (
							<>
								<Coins />
								<span>确认调配</span>
							</>
						)}
					</button>
				</footer>

				{/* ========== 二次确认 Modal ========== */}
				<AnimatePresence>
					{confirmOpen && (
						<ConfirmModal
							userName={
								user?.displayName || user?.username || '—'
							}
							mode={mode}
							amount={amount}
							category={category}
							reason={finalRemark}
							currentBalance={currentBalance}
							balanceAfter={balanceAfter}
							isPending={adjustMutation.isPending}
							onCancel={() => setConfirmOpen(false)}
							onConfirm={handleSubmit}
						/>
					)}
				</AnimatePresence>
			</motion.aside>
		</>
	)
}

// =============================================================================
// 二次确认 Modal（覆盖在抽屉之上，居中展示）
// =============================================================================
function ConfirmModal({
	userName,
	mode,
	amount,
	category,
	reason,
	currentBalance,
	balanceAfter,
	isPending,
	onCancel,
	onConfirm
}: {
	userName: string
	mode: 'add' | 'deduct'
	amount: number
	category: AdjustCategory
	reason: string
	currentBalance: number
	balanceAfter: number
	isPending: boolean
	onCancel: () => void
	onConfirm: () => void
}) {
	const categoryLabel =
		category === 'recharge'
			? '后台充值'
			: category === 'compensate'
			? '人工补偿'
			: '人工扣减'

	return (
		<motion.div
			className={styles.confirmOverlay}
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0 }}
			onClick={onCancel}
		>
			<motion.div
				className={styles.confirmModal}
				initial={{ scale: 0.95, opacity: 0 }}
				animate={{ scale: 1, opacity: 1 }}
				exit={{ scale: 0.95, opacity: 0 }}
				onClick={(e) => e.stopPropagation()}
			>
				<div className={styles.confirmHeader}>
					<h3>请确认调配信息</h3>
				</div>
				<div className={styles.confirmBody}>
					<div className={styles.confirmRow}>
						<span className={styles.confirmLabel}>用户</span>
						<span className={styles.confirmValue}>{userName}</span>
					</div>
					<div className={styles.confirmRow}>
						<span className={styles.confirmLabel}>调配类型</span>
						<span className={styles.confirmValue}>
							{categoryLabel}
						</span>
					</div>
					<div className={styles.confirmRow}>
						<span className={styles.confirmLabel}>调配数量</span>
						<span
							className={
								mode === 'add'
									? styles.deltaPositive
									: styles.deltaNegative
							}
						>
							{mode === 'add' ? '+' : '-'}
							{fmtCredits(amount)}
						</span>
					</div>
					<div className={styles.confirmRow}>
						<span className={styles.confirmLabel}>调配前余额</span>
						<span className={styles.confirmValue}>
							{fmtCredits(currentBalance)}
						</span>
					</div>
					<div className={styles.confirmRow}>
						<span className={styles.confirmLabel}>调配后余额</span>
						<span
							className={`${styles.confirmValue} ${styles.confirmValueHighlight}`}
						>
							{fmtCredits(balanceAfter)}
						</span>
					</div>
					<div className={styles.confirmRow}>
						<span className={styles.confirmLabel}>调配原因</span>
						<span className={styles.confirmValue}>{reason}</span>
					</div>
				</div>
				<div className={styles.confirmActions}>
					<button
						type="button"
						className={styles.cancelBtn}
						onClick={onCancel}
						disabled={isPending}
					>
						返回修改
					</button>
					<button
						type="button"
						className={styles.submitBtn}
						onClick={onConfirm}
						disabled={isPending}
					>
						{isPending ? (
							<>
								<Loader2 className={styles.spinner} />
								<span>提交中…</span>
							</>
						) : (
							<>
								<CheckCircle2 />
								<span>确认并立即生效</span>
							</>
						)}
					</button>
				</div>
			</motion.div>
		</motion.div>
	)
}
