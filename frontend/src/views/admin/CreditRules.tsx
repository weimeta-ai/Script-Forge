// 积分规则页（运营视角，admin only）
// -----------------------------------------------------------------------------
// 设计目标：让不懂代码的运营也能秒懂、秒改。
//   - 按 code 前缀自动分组（剧本分析 / 封面生成 / 其他）
//   - 每张卡片展示中文业务说明，code 仅作为小字徽章
//   - 扣费额度可就地编辑（点击 → 输入框，回车保存、ESC 取消、失焦保存）
//   - 启用/停用：彩色状态徽章 + 开关
//   - 支持新建/删除规则——管理员可自行配置，code 需与业务端约定（如 analyze.standard）
// =============================================================================

import {
	AlertCircle,
	ArrowLeft,
	Coins,
	Info,
	Loader2,
	Pencil,
	Plus,
	Trash2,
	X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
	useCreateCreditRule,
	useCreditRules,
	useDeleteCreditRule,
	useUpdateCreditRule,
} from '../../api/credit';
import { AppShell, type BarItem } from '../../components/shell';
import { slideUp, staggerContainer } from '../../lib/animations';
import { fmtCredits } from '../../lib/credit-tx-display';
import {
	getRuleDisplay,
	groupRulesByBusiness,
	HIDDEN_RULE_CODES,
	PRESET_RULE_CODES,
} from '../../lib/credit-rules-display';
import { RequestError } from '../../lib/request';
import type { CreditRule } from '../../types/credit';
import styles from './CreditRules.module.css';

export default function CreditRules() {
	const navigate = useNavigate();
	const { data, isLoading, error } = useCreditRules();
	const [editingId, setEditingId] = useState<string | null>(null);
	const [createOpen, setCreateOpen] = useState(false);

	const topItems: BarItem[] = [{ icon: Coins, label: '管理', value: '积分规则' }];

	const groups = data?.items ? groupRulesByBusiness(data.items) : [];

	return (
		<AppShell>
			<div className={styles.toolbar}>
				<div className={styles.toolbarLeft}>
					<button
						type="button"
						className={styles.backBtn}
						onClick={() => navigate('/admin/users')}
					>
						<ArrowLeft strokeWidth={2} />
						<span>返回用户管理</span>
					</button>
					<div className={styles.divider} />
					<span className={styles.breadcrumb}>积分规则</span>
				</div>
				<span className={styles.tag}>管理 · 积分规则</span>
			</div>

			<motion.div
				variants={staggerContainer}
				initial="hidden"
				animate="show"
				className={styles.hero}
			>
				<motion.div variants={slideUp} className={styles.heroHeader}>
					<div className={styles.heroHeaderLeft}>
						<span className={styles.heroTag}>// 计费 · 规则</span>
						<h1 className={styles.heroTitle}>
							积分 <span className={styles.heroGradient}>计费规则</span>
						</h1>
						<p className={styles.heroSubtitle}>
							下方列出了所有业务动作对应的扣费额度。点击「扣费额度」可直接修改，点击开关可启用或停用某条规则。
						</p>
					</div>
					<button
						type="button"
						className={styles.createBtn}
						onClick={() => setCreateOpen(true)}
					>
						<Plus />
						<span>新建规则</span>
					</button>
				</motion.div>

				<motion.div variants={slideUp} className={styles.tipBar}>
					<Info className={styles.tipIcon} />
					<div className={styles.tipText}>
						<strong>如何使用：</strong>
						<span>
							调高额度会让用户扣费更多，调低则更省；停用某条规则后，对应的业务动作将无法触发（用户操作时会提示「规则未启用」）。
						</span>
					</div>
				</motion.div>
			</motion.div>

			{error && (
				<div className={styles.errorBox}>
					<AlertCircle className={styles.errorIcon} />
					<span>加载失败：{(error as RequestError).message}</span>
				</div>
			)}

			{isLoading ? (
				<div className={styles.loadingRow}>
					<Loader2 className={styles.spinner} />
					<span>加载规则…</span>
				</div>
			) : groups.length === 0 ? (
				<div className={styles.emptyRow}>
					<span>暂无规则，点击下方按钮配置第一条扣费规则。</span>
					<button
						type="button"
						className={styles.createBtn}
						onClick={() => setCreateOpen(true)}
					>
						<Plus />
						<span>新建规则</span>
					</button>
				</div>
			) : (
				<div className={styles.groups}>
					{groups.map((g) => (
						<motion.section
							key={g.group}
							variants={slideUp}
							className={styles.group}
						>
							<div className={styles.groupHeader}>
								<h2 className={styles.groupTitle}>{g.group}</h2>
								<span className={styles.groupCount}>{g.items.length} 条规则</span>
							</div>
							<div className={styles.cardList}>
								{g.items.map((rule) => (
									<RuleCard
										key={rule.id}
										rule={rule}
										isEditing={editingId === rule.id}
										onStartEdit={() => setEditingId(rule.id)}
										onEndEdit={() => setEditingId(null)}
									/>
								))}
							</div>
						</motion.section>
					))}
				</div>
			)}

			<AnimatePresence>
				{createOpen && (
					<CreateRuleModal
						existingCodes={new Set((data?.items ?? []).map((r) => r.code))}
						onClose={() => setCreateOpen(false)}
					/>
				)}
			</AnimatePresence>
		</AppShell>
	);
}

// =============================================================================
// 单条规则卡片
// =============================================================================
function RuleCard({
	rule,
	isEditing,
	onStartEdit,
	onEndEdit,
}: {
	rule: CreditRule;
	isEditing: boolean;
	onStartEdit: () => void;
	onEndEdit: () => void;
}) {
	const display = getRuleDisplay(rule.code);
	const updateMutation = useUpdateCreditRule(rule.id);
	const deleteMutation = useDeleteCreditRule();
	const [descEditing, setDescEditing] = useState(false);
	const mutationError = (updateMutation.error ??
		deleteMutation.error) as RequestError | undefined;

	function handleToggle() {
		updateMutation.mutate({ enabled: !rule.enabled });
	}

	function handleDelete() {
		if (
			window.confirm(
				`确定删除规则「${rule.name}」（${rule.code}）吗？\n删除后对应业务动作将无法扣费，已产生的积分流水不受影响。`,
			)
		) {
			deleteMutation.mutate(rule.id);
		}
	}

	return (
		<div
			className={`${styles.card} ${rule.enabled ? '' : styles.cardDisabled}`}
		>
			<div className={styles.cardMain}>
				<div className={styles.cardTitleRow}>
					<h3 className={styles.cardTitle}>{rule.name}</h3>
					<span
						className={`${styles.badge} ${
							rule.enabled ? styles.badgeOn : styles.badgeOff
						}`}
					>
						<span className={styles.badgeDot} />
						{rule.enabled ? '已启用' : '已停用'}
					</span>
				</div>
				<DescriptionEditor
					rule={rule}
					fallbackText={display.description}
					isEditing={descEditing}
					onStartEdit={() => setDescEditing(true)}
					onEndEdit={() => setDescEditing(false)}
					disabled={updateMutation.isPending}
				/>
				<div className={styles.cardMeta}>
					{display.suggestion && (
						<span className={styles.suggestion}>建议：{display.suggestion}</span>
					)}
					<span className={styles.cardMetaSpacer} />
					<button
						type="button"
						className={styles.deleteBtn}
						onClick={handleDelete}
						disabled={updateMutation.isPending || deleteMutation.isPending}
						title="删除规则"
					>
						<Trash2 />
						<span>删除</span>
					</button>
				</div>
			</div>

			<div className={styles.cardSide}>
				<CreditEditor
					rule={rule}
					isEditing={isEditing}
					onStartEdit={onStartEdit}
					onEndEdit={onEndEdit}
					disabled={updateMutation.isPending}
				/>
				<div className={styles.toggleRow}>
					<span className={styles.toggleLabel}>
						{rule.enabled ? '允许扣费' : '已停用'}
					</span>
					<button
						type="button"
						className={`${styles.toggle} ${rule.enabled ? styles.on : ''}`}
						onClick={handleToggle}
						aria-pressed={rule.enabled}
						aria-label={rule.enabled ? '停用规则' : '启用规则'}
						disabled={updateMutation.isPending}
					/>
				</div>
				{mutationError && (
					<span className={styles.inlineError}>
						<AlertCircle className={styles.inlineErrorIcon} />
						{mutationError.message}
					</span>
				)}
			</div>
		</div>
	);
}

// =============================================================================
// 就地编辑扣费额度（点击 → 输入框；回车/失焦保存，ESC 取消）
// =============================================================================
function CreditEditor({
	rule,
	isEditing,
	onStartEdit,
	onEndEdit,
	disabled,
}: {
	rule: CreditRule;
	isEditing: boolean;
	onStartEdit: () => void;
	onEndEdit: () => void;
	disabled: boolean;
}) {
	const updateMutation = useUpdateCreditRule(rule.id);
	const [value, setValue] = useState(String(rule.creditsPerUnit));
	const inputRef = useRef<HTMLInputElement | null>(null);

	// 进入编辑态时同步初始值并聚焦
	useEffect(() => {
		if (isEditing) {
			setValue(String(rule.creditsPerUnit));
			// 等一帧让 input 挂载
			requestAnimationFrame(() => {
				inputRef.current?.focus();
				inputRef.current?.select();
			});
		}
	}, [isEditing, rule.creditsPerUnit]);

	function commit() {
		const next = Math.max(0, Math.floor(Number(value) || 0));
		if (next === rule.creditsPerUnit) {
			onEndEdit();
			return;
		}
		updateMutation.mutate(
			{ creditsPerUnit: next },
			{ onSuccess: () => onEndEdit() },
		);
	}

	function cancel() {
		setValue(String(rule.creditsPerUnit));
		onEndEdit();
	}

	function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancel();
		}
	}

	if (!isEditing) {
		return (
			<button
				type="button"
				className={styles.creditDisplay}
				onClick={onStartEdit}
				title="点击修改扣费额度"
				disabled={disabled}
			>
				<span className={styles.creditValue}>{fmtCredits(rule.creditsPerUnit)}</span>
				<span className={styles.creditUnit}>积分 / 次</span>
				<Pencil className={styles.creditEditIcon} />
			</button>
		);
	}

	return (
		<div className={styles.creditEdit}>
			<input
				ref={inputRef}
				type="number"
				className={styles.creditInput}
				value={value}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={onKeyDown}
				onBlur={commit}
				min={0}
				step={1}
				disabled={updateMutation.isPending}
			/>
			<span className={styles.creditUnit}>积分 / 次</span>
			{updateMutation.isPending && (
				<Loader2 className={styles.spinner} />
			)}
			<button
				type="button"
				className={styles.creditCancelBtn}
				onClick={cancel}
				aria-label="取消"
			>
				<X />
			</button>
		</div>
	);
}

// =============================================================================
// 用途说明就地编辑（点击 → 输入框；失焦/按钮保存，ESC 取消）
// 自填说明优先展示，为空时显示系统内置文案
// =============================================================================
function DescriptionEditor({
	rule,
	fallbackText,
	isEditing,
	onStartEdit,
	onEndEdit,
	disabled,
}: {
	rule: CreditRule;
	fallbackText: string;
	isEditing: boolean;
	onStartEdit: () => void;
	onEndEdit: () => void;
	disabled: boolean;
}) {
	if (!isEditing) {
		return (
			<button
				type="button"
				className={`${styles.cardDesc} ${styles.cardDescEditable}`}
				onClick={onStartEdit}
				title="点击修改用途说明"
				disabled={disabled}
			>
				{rule.description || fallbackText}
				{!rule.description && <span className={styles.descDefaultTag}>默认</span>}
				<Pencil className={styles.descEditIcon} />
			</button>
		);
	}
	return <DescEditInput rule={rule} onDone={onEndEdit} />;
}

function DescEditInput({ rule, onDone }: { rule: CreditRule; onDone: () => void }) {
	const updateMutation = useUpdateCreditRule(rule.id);
	const [value, setValue] = useState(rule.description ?? '');

	function commit() {
		const next = value.trim() || null;
		if (next === (rule.description ?? null)) {
			onDone();
			return;
		}
		updateMutation.mutate({ description: next }, { onSuccess: onDone });
	}

	function cancel() {
		onDone();
	}

	function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
		if (e.key === 'Escape') {
			e.preventDefault();
			cancel();
		} else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			commit();
		}
	}

	return (
		<div className={styles.descEdit}>
			<textarea
				ref={(el) => {
					if (el) {
						el.focus();
						el.select();
					}
				}}
				className={styles.descInput}
				value={value}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={onKeyDown}
				onBlur={commit}
				maxLength={500}
				rows={2}
				placeholder="填写该规则的用途说明（如：用户上传剧本后做完整分析时扣费）"
				disabled={updateMutation.isPending}
			/>
			<div className={styles.descEditActions}>
				{updateMutation.isPending ? (
					<Loader2 className={styles.spinner} />
				) : (
					<>
						<span className={styles.descEditHint}>⌘/Ctrl+Enter 保存 · ESC 取消</span>
						<button
							type="button"
							className={styles.creditCancelBtn}
							onMouseDown={(e) => e.preventDefault()}
							onClick={cancel}
							aria-label="取消"
						>
							<X />
						</button>
					</>
				)}
			</div>
		</div>
	);
}
// =============================================================================
// 新建规则弹窗（业务动作 / 名称 / 用途说明 / 代码 / 扣费额度；校验对齐后端 createRuleSchema）
// =============================================================================
function CreateRuleModal({
	existingCodes,
	onClose,
}: {
	existingCodes: Set<string>;
	onClose: () => void;
}) {
	const createMutation = useCreateCreditRule();
	const [codeChoice, setCodeChoice] = useState('');
	const [customCode, setCustomCode] = useState('');
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [credits, setCredits] = useState('2000');
	const mutationError = createMutation.error as RequestError | undefined;

	// Esc 关闭
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [onClose]);

	const finalCode = codeChoice === '__custom__' ? customCode : codeChoice;

	// 下拉选择：预设项自动带出默认名称；自定义则清空让运营填写
	function handleCodeChoice(v: string) {
		setCodeChoice(v);
		const preset = PRESET_RULE_CODES.find((p) => p.code === v);
		if (preset) setName(preset.name);
		else if (v === '__custom__') setName('');
	}

	const nameValid = name.trim().length >= 1 && name.trim().length <= 128;
	const codeValid = /^[a-z0-9_.-]+$/.test(finalCode) && finalCode.length <= 64;
	const creditsNum = Math.floor(Number(credits));
	const creditsValid =
		Number.isFinite(creditsNum) && creditsNum >= 0 && creditsNum <= 1_000_000;
	const canSubmit =
		nameValid && codeValid && creditsValid && !createMutation.isPending;

	function submit(e: React.FormEvent) {
		e.preventDefault();
		if (!canSubmit) return;
		createMutation.mutate(
			{
				code: finalCode,
				name: name.trim(),
				description: description.trim() || null,
				creditsPerUnit: creditsNum,
				unitType: 'per_call',
				enabled: true,
			},
			{ onSuccess: onClose },
		);
	}

	return (
		<motion.div
			className={styles.modalOverlay}
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0 }}
			onClick={onClose}
		>
			<motion.form
				className={styles.modalCard}
				initial={{ scale: 0.95, opacity: 0 }}
				animate={{ scale: 1, opacity: 1 }}
				exit={{ scale: 0.95, opacity: 0 }}
				onClick={(e) => e.stopPropagation()}
				onSubmit={submit}
			>
				<header className={styles.modalHeader}>
					<h3 className={styles.modalTitle}>新建积分规则</h3>
					<button
						type="button"
						className={styles.modalCloseBtn}
						onClick={onClose}
						aria-label="关闭"
					>
						<X />
					</button>
				</header>

				<div className={styles.modalField}>
					<label className={styles.modalLabel} htmlFor="rule-code-select">
						业务动作（必填）
					</label>
					<select
						id="rule-code-select"
						className={styles.modalInput}
						value={codeChoice}
						onChange={(e) => handleCodeChoice(e.target.value)}
					>
						<option value="" disabled>
							请选择业务动作
						</option>
						{PRESET_RULE_CODES.map((p) => {
							const exists = existingCodes.has(p.code);
							const hidden = HIDDEN_RULE_CODES.has(p.code);
							return (
								<option key={p.code} value={p.code} disabled={exists}>
									{p.label}
									{hidden && exists
										? '（已隐藏）'
										: exists
											? '（已存在，请在列表中启用）'
											: ''}
								</option>
							);
						})}
						<option value="__custom__">自定义…（仅供与开发约定的扩展场景）</option>
					</select>
					<span className={styles.modalHint}>
						按业务动作选择即可，无需关心背后的代码；已存在的规则请直接在列表中启用/调整
					</span>
				</div>

				{codeChoice === '__custom__' && (
					<div className={styles.modalField}>
						<label className={styles.modalLabel} htmlFor="rule-code-custom">
							自定义代码（必填）
						</label>
						<input
							id="rule-code-custom"
							className={`${styles.modalInput} ${styles.modalInputMono}`}
							value={customCode}
							onChange={(e) => setCustomCode(e.target.value)}
							placeholder="如：export.pdf"
							maxLength={64}
							autoFocus
						/>
						{customCode && !codeValid ? (
							<span className={styles.modalErrorText}>
								仅支持小写字母、数字、点、下划线、连字符
							</span>
						) : (
							<span className={styles.modalHint}>不可与现有规则重复</span>
						)}
					</div>
				)}

				<div className={styles.modalField}>
					<label className={styles.modalLabel} htmlFor="rule-name">
						规则名称（必填）
					</label>
					<input
						id="rule-name"
						className={styles.modalInput}
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="如：剧本分析"
						maxLength={128}
					/>
				</div>

				<div className={styles.modalField}>
					<label className={styles.modalLabel} htmlFor="rule-description">
						用途说明（选填）
					</label>
					<textarea
						id="rule-description"
						className={styles.modalTextarea}
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						placeholder="如：用户上传剧本后做完整分析时扣费"
						maxLength={500}
						rows={2}
					/>
					<span className={styles.modalHint}>
						展示在规则卡片上，帮助运营理解该规则对应什么动作；不填则显示系统默认文案
					</span>
				</div>

				<div className={styles.modalField}>
					<label className={styles.modalLabel} htmlFor="rule-credits">
						扣费额度（积分 / 次）
					</label>
					<input
						id="rule-credits"
						className={styles.modalInput}
						type="number"
						min={0}
						step={1}
						max={1000000}
						value={credits}
						onChange={(e) => setCredits(e.target.value)}
					/>
					<span className={styles.modalHint}>0 – 1,000,000 的整数，创建后可随时修改</span>
				</div>

				{mutationError && (
					<div className={styles.errorBox}>
						<AlertCircle className={styles.errorIcon} />
						<span>创建失败：{mutationError.message}</span>
					</div>
				)}

				<div className={styles.modalActions}>
					<button
						type="button"
						className={styles.modalCancelBtn}
						onClick={onClose}
						disabled={createMutation.isPending}
					>
						取消
					</button>
					<button type="submit" className={styles.modalSubmitBtn} disabled={!canSubmit}>
						{createMutation.isPending ? (
							<>
								<Loader2 className={styles.spinner} />
								<span>创建中…</span>
							</>
						) : (
							<>
								<Plus />
								<span>创建规则</span>
							</>
						)}
					</button>
				</div>
			</motion.form>
		</motion.div>
	);
}
