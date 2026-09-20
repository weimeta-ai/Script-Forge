// Prompt 话术配置页（admin only）
// -----------------------------------------------------------------------------
// 用途：管理员编辑「报告系统 prompt」和「封面图片话术」，查看版本历史 + 回滚
// 结构：Sidebar（AppShell）→ Toolbar → Hero → Tab → 当前编辑区 → 历史版本列表
// 复用：与 ImageConfig 同风格，import ImageConfig.module.css（避免重复样式）
// =============================================================================

import {
	AlertCircle,
	ArrowLeft,
	CheckCircle2,
	Eye,
	History,
	Loader2,
	RotateCcw,
	Save,
	ScrollText,
	Sparkles,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
	usePromptDetail,
	usePromptVersion,
	useRollbackPrompt,
	useSavePrompt,
} from '../../api/prompt-config';
import { AppShell, type BarItem } from '../../components/shell';
import { slideUp, staggerContainer } from '../../lib/animations';
import { validatePromptContent } from '../../lib/prompt-validation';
import { RequestError } from '../../lib/request';
import type { PromptType } from '../../types/prompt-config';
import styles from './ImageConfig.module.css';
import './PromptConfigExtra.css';

// Tab 元数据
const TAB_META: Record<
	PromptType,
	{ label: string; desc: string; placeholder: string }
> = {
	report_system: {
		label: '报告系统',
		desc: '8 节点分析共用的 system prompt（定义评估口径与角色定位）',
		placeholder: '请输入报告 system prompt（纯 markdown）…',
	},
	cover_template: {
		label: '封面话术',
		desc: '封面图片生成模板，支持 {{title}} / {{genre}} / {{excerpt}} / {{excerpt_block}} 占位符',
		placeholder:
			'短剧海报封面，标题《{{title}}》，题材：{{genre}}。{{excerpt_block}}…',
	},
};

export default function PromptConfig() {
	const navigate = useNavigate();
	const [activeType, setActiveType] = useState<PromptType>('report_system');

	const topItems: BarItem[] = [
		{ icon: ScrollText, label: '管理', value: '话术配置' },
	];

	return (
		<AppShell
		>
			{/* 页内工具条 */}
			<div className={styles.toolbar}>
				<div className={styles.toolbarLeft}>
					<button
						type="button"
						className={styles.backBtn}
						onClick={() => navigate('/workspace')}
					>
						<ArrowLeft strokeWidth={2} />
						<span>返回项目库</span>
					</button>
					<div className={styles.divider} />
					<span className={styles.breadcrumb}>Prompt 话术配置</span>
				</div>
				<span className={styles.adminTag}>管理 · 话术</span>
			</div>

			{/* Hero */}
			<motion.div
				variants={staggerContainer}
				initial="hidden"
				animate="show"
				className={styles.hero}
			>
				<motion.div variants={slideUp} className={styles.heroHeader}>
					<span className={styles.heroTag}>// 运行时 · Prompt</span>
					<h1 className={styles.heroTitle}>
						<span className={styles.heroGradient}>话术配置</span>
					</h1>
					<p className={styles.heroSubtitle}>
						集中管理报告 system prompt 和封面图片话术。每次保存产生新版本，
						支持回滚到任意历史版本。Worker 进程内 60 秒 TTL 缓存，新任务自动读到最新版。
					</p>
				</motion.div>
			</motion.div>

			{/* Tab 切换 */}
			<div className="prompt-tab-bar">
				{(Object.keys(TAB_META) as PromptType[]).map((t) => {
					const meta = TAB_META[t];
					const active = activeType === t;
					return (
						<button
							key={t}
							type="button"
							className={`prompt-tab ${active ? 'prompt-tab-active' : ''}`}
							onClick={() => setActiveType(t)}
						>
							<span className="prompt-tab-label">{meta.label}</span>
						</button>
					);
				})}
			</div>

			{/* 当前 Tab 的编辑区 + 历史列表（含版本查看/回滚）*/}
			<PromptConfigPanel key={activeType} type={activeType} />
		</AppShell>
	);
}

/* ========== 编辑区 + 历史列表 ========== */
function PromptConfigPanel({ type }: { type: PromptType }) {
	const meta = TAB_META[type];
	const { data, isLoading } = usePromptDetail(type);
	const saveMutation = useSavePrompt(type);
	const rollbackMutation = useRollbackPrompt(type);

	if (isLoading || !data) {
		return (
			<section className={styles.configSection}>
				<div className={styles.loadingRow}>
					<Loader2 className={styles.spinner} />
					<span>加载配置中…</span>
				</div>
			</section>
		);
	}

	const isNew = data.current === null;

	return (
		<>
			<EditCurrentForm
				key={data.current?.id ?? 'new'}
				type={type}
				meta={meta}
				current={data.current}
				saveMutation={saveMutation}
			/>

			{!isNew && (
				<HistoryList
					type={type}
					history={data.history}
					rollbackMutation={rollbackMutation}
				/>
			)}
		</>
	);
}

/* ========== 当前版本编辑表单 ========== */
// current = null 时表示该 type 尚未初始化，渲染"创建第一版"模式（同样的表单，文案不同）
function EditCurrentForm({
	type,
	meta,
	current,
	saveMutation,
}: {
	type: PromptType;
	meta: (typeof TAB_META)[PromptType];
	current: {
		id: number;
		version: number;
		content: string;
		note: string | null;
		createdBy: string;
		createdAt: string;
	} | null;
	saveMutation: ReturnType<typeof useSavePrompt>;
}) {
	const isNew = current === null;
	const [content, setContent] = useState(current?.content ?? '');
	const [note, setNote] = useState('');
	const [localError, setLocalError] = useState<string | null>(null);

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setLocalError(null);

		// 客户端预校验（与服务端 validatePromptContent 同口径）
		const error = validatePromptContent(type, content);
		if (error) {
			setLocalError(error);
			return;
		}

		saveMutation.mutate({ content, note: note || undefined });
		setNote('');
	}

	const isSaving = saveMutation.isPending;
	const saveError = saveMutation.error;
	const savedVersion = saveMutation.data?.version ?? null;
	const saveSuccess = saveMutation.isSuccess && !saveError && savedVersion !== null;

	return (
		<motion.section
			variants={slideUp}
			initial="hidden"
			animate="show"
			className={styles.configSection}
		>
			<div className={styles.sectionHeader}>
				<div className={styles.sectionIcon}>
					<Sparkles strokeWidth={2} />
				</div>
				<div>
					<h2 className={styles.sectionTitle}>
						{current === null
							? '尚未初始化 · 创建第一版'
							: `当前版本 · v${current.version}`}
					</h2>
					<p className={styles.sectionHint}>
						{current === null ? (
							`${meta.desc}。当前尚未配置，请填写内容后创建第一版。`
						) : (
							<>
								{meta.desc}。当前由{' '}
								<code className={styles.codeInline}>{current.createdBy}</code> 于{' '}
								{new Date(current.createdAt).toLocaleString('zh-CN')} 更新。
							</>
						)}
					</p>
				</div>
			</div>

			<form className={styles.form} onSubmit={handleSubmit}>
				<label className={styles.field}>
					<span className={styles.fieldLabel}>Prompt 内容</span>
					<textarea
						className="prompt-textarea"
						value={content}
						onChange={(e) => setContent(e.target.value)}
						placeholder={meta.placeholder}
						rows={18}
						spellCheck={false}
						required
					/>
					<span className={styles.fieldHint}>
						字符数：{content.length.toLocaleString()}
					</span>
				</label>

				<label className={styles.field}>
					<span className={styles.fieldLabel}>保存备注（可选）</span>
					<input
						className={styles.input}
						value={note}
						onChange={(e) => setNote(e.target.value)}
						placeholder="如：增加爆款案例校准"
						maxLength={200}
					/>
				</label>

				{localError && (
					<div className={styles.alertError}>
						<AlertCircle strokeWidth={2} />
						<span>{localError}</span>
					</div>
				)}

				{saveError && (
					<div className={styles.alertError}>
						<AlertCircle strokeWidth={2} />
						<span>{(saveError as RequestError).message}</span>
					</div>
				)}

				{saveSuccess && savedVersion !== null && (
					<div className={styles.alertSuccess}>
						<CheckCircle2 strokeWidth={2} />
						<span>
							{isNew
								? `第一版已创建（v${savedVersion}）`
								: `新版本已保存（v${savedVersion}）`}
						</span>
					</div>
				)}

				<div className={styles.actions}>
					<button type="submit" className={styles.saveBtn} disabled={isSaving}>
						{isSaving ? (
							<Loader2 className={styles.spinner} />
						) : (
							<Save strokeWidth={2} />
						)}
						{isSaving ? '保存中…' : isNew ? '创建第一版' : '保存新版本'}
					</button>
				</div>
			</form>
		</motion.section>
	);
}

/* ========== 历史版本列表 ========== */
function HistoryList({
	type,
	history,
	rollbackMutation,
}: {
	type: PromptType;
	history: Array<{
		id: number;
		version: number;
		note: string | null;
		createdBy: string;
		createdAt: string;
		isCurrent: boolean;
	}>;
	rollbackMutation: ReturnType<typeof useRollbackPrompt>;
}) {
	const [confirmingId, setConfirmingId] = useState<number | null>(null);
	const [viewingId, setViewingId] = useState<number | null>(null);

	function handleRollback(versionId: number) {
		if (confirmingId !== versionId) {
			setConfirmingId(versionId);
			return;
		}
		rollbackMutation.mutate(versionId);
		setConfirmingId(null);
	}

	if (history.length === 0) {
		return null;
	}

	return (
		<motion.section
			variants={slideUp}
			initial="hidden"
			animate="show"
			className={styles.configSection}
			style={{ marginTop: 24 }}
		>
			<div className={styles.sectionHeader}>
				<div className={`${styles.sectionIcon} ${styles.envIcon}`}>
					<History strokeWidth={2} />
				</div>
				<div>
					<h2 className={styles.sectionTitle}>历史版本</h2>
					<p className={styles.sectionHint}>
						共 {history.length} 个版本。回滚会创建一个新版本（内容为所选版本），不删除任何历史记录。
					</p>
				</div>
			</div>

			<div className="prompt-history-list">
				{history.map((v) => {
					const isConfirming = confirmingId === v.id;
					const isRolling = rollbackMutation.isPending && confirmingId === v.id;
					return (
						<div key={v.id} className="prompt-history-row">
							<div className="prompt-history-meta">
								<span className={`prompt-version-tag ${v.isCurrent ? 'prompt-version-current' : ''}`}>
									v{v.version}
									{v.isCurrent && ' · 当前'}
								</span>
								<span className="prompt-history-note">
									{v.note ?? '（无备注）'}
								</span>
								<span className="prompt-history-by">
									{v.createdBy} · {new Date(v.createdAt).toLocaleString('zh-CN')}
								</span>
							</div>
							<div className="prompt-history-actions">
								<button
									type="button"
									className="prompt-action-btn prompt-action-view"
									onClick={() => setViewingId(v.id)}
								>
									<Eye strokeWidth={2} />
									<span>查看</span>
								</button>
								{!v.isCurrent && (
									<button
										type="button"
										className={`prompt-action-btn ${isConfirming ? 'prompt-action-confirm' : 'prompt-action-rollback'
											}`}
										onClick={() => handleRollback(v.id)}
										disabled={isRolling || rollbackMutation.isPending}
									>
										{isRolling ? (
											<Loader2 className={styles.spinner} />
										) : (
											<RotateCcw strokeWidth={2} />
										)}
										<span>{isConfirming ? '确认回滚?' : '回滚到此版'}</span>
									</button>
								)}
							</div>
						</div>
					);
				})}
			</div>

			{viewingId !== null && (
				<VersionViewer
					type={type}
					versionId={viewingId}
					onClose={() => setViewingId(null)}
				/>
			)}
		</motion.section>
	);
}

/* ========== 历史版本查看弹窗 ========== */
function VersionViewer({
	type,
	versionId,
	onClose,
}: {
	type: PromptType;
	versionId: number;
	onClose: () => void;
}) {
	const { data, isLoading } = usePromptVersion(type, versionId);

	return (
		<div className="prompt-viewer-overlay" onClick={onClose}>
			<div
				className="prompt-viewer-modal"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="prompt-viewer-header">
					<h3>
						{isLoading
							? '加载中…'
							: data
								? `v${data.version} 完整内容`
								: '版本不存在'}
					</h3>
					<button
						type="button"
						className="prompt-viewer-close"
						onClick={onClose}
					>
						✕
					</button>
				</div>
				<div className="prompt-viewer-body">
					{isLoading ? (
						<div className={styles.loadingRow}>
							<Loader2 className={styles.spinner} />
							<span>加载版本内容…</span>
						</div>
					) : data ? (
						<>
							<div className="prompt-viewer-meta">
								{data.note && <span>备注：{data.note}</span>}
								<span>
									{data.createdBy} · {new Date(data.createdAt).toLocaleString('zh-CN')}
								</span>
							</div>
							<textarea
								className="prompt-textarea prompt-textarea-readonly"
								value={data.content}
								readOnly
								rows={22}
								spellCheck={false}
							/>
						</>
					) : (
						<p>该版本不存在或已被删除</p>
					)}
				</div>
			</div>
		</div>
	);
}
