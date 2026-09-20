// 用户级 Prompt 话术配置区（admin 用户详情页内嵌）
// -----------------------------------------------------------------------------
// 用途：为单个用户配置独立的「报告 system prompt」和「封面话术」
// 语义：该用户未配置时，其任务自动 fallback 到全局话术；
//       配置后仅该用户的报告/封面走此话术，其他用户不受影响
// 结构：Tab（report_system / cover_template）→ 编辑表单（或复制全局引导）→ 历史版本列表
// 复用：UserDetail.module.css 的 section 系样式 + PromptConfigExtra.css 的 tab/textarea/history 样式
// =============================================================================

import {
	AlertCircle,
	CheckCircle2,
	Copy,
	Eye,
	History,
	Loader2,
	RotateCcw,
	Save,
	Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import {
	useCopyUserPromptTemplate,
	useRollbackUserPrompt,
	useSaveUserPrompt,
	useUserPromptDetail,
	useUserPromptVersion,
} from '../../api/user-prompt-config';
import { validatePromptContent } from '../../lib/prompt-validation';
import { RequestError } from '../../lib/request';
import type { PromptType } from '../../types/prompt-config';
import './PromptConfigExtra.css';
import styles from './UserDetail.module.css';

// Tab 元数据（与全局 PromptConfig.tsx 保持一致的文案口径）
const TAB_META: Record<
	PromptType,
	{ label: string; desc: string; placeholder: string }
> = {
	report_system: {
		label: '报告系统',
		desc: '该用户报告分析专用的 system prompt',
		placeholder: '建议先「从全局复制」再修改…',
	},
	cover_template: {
		label: '封面话术',
		desc: '该用户封面图片专用模板，支持 {{title}} / {{genre}} 占位符',
		placeholder: '短剧海报封面，标题《{{title}}》，题材：{{genre}}…',
	},
};

export function UserPromptConfigSection({ userId }: { userId: string }) {
	const [activeType, setActiveType] = useState<PromptType>('report_system');

	return (
		<section className={styles.section}>
			<div className={styles.sectionHeader}>
				<div className={styles.sectionIcon}>
					<Sparkles strokeWidth={2} />
				</div>
				<div>
					<h2 className={styles.sectionTitle}>话术配置（按用户）</h2>
					<p className={styles.sectionHint}>
						为该用户单独配置报告/封面话术。未配置时自动使用全局话术；
						配置后仅该用户的任务走此话术。Worker 60 秒 TTL 缓存，改后新任务自动生效。
					</p>
				</div>
			</div>

			{/* Tab 切换（复用全局话术页的 tab 样式） */}
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

			<TypePanel key={activeType} userId={userId} type={activeType} />
		</section>
	);
}

/* ========== 单 type 编辑 + 历史 ========== */
function TypePanel({ userId, type }: { userId: string; type: PromptType }) {
	const meta = TAB_META[type];
	const { data, isLoading } = useUserPromptDetail(userId, type);
	const saveMutation = useSaveUserPrompt(userId, type);
	const rollbackMutation = useRollbackUserPrompt(userId, type);
	const copyMutation = useCopyUserPromptTemplate(userId);

	if (isLoading || !data) {
		return (
			<div className={styles.loadingRow}>
				<Loader2 className={styles.spinner} />
				<span>加载该用户话术配置…</span>
			</div>
		);
	}

	const isUnconfigured = data.current === null;

	return (
		<>
			{isUnconfigured ? (
				<CopyTemplateGuide
					userId={userId}
					type={type}
					meta={meta}
					copyMutation={copyMutation}
				/>
			) : (
				<EditForm
					userId={userId}
					type={type}
					meta={meta}
					current={data.current}
					saveMutation={saveMutation}
				/>
			)}

			{!isUnconfigured && (
				<UserHistoryList
					userId={userId}
					type={type}
					history={data.history}
					rollbackMutation={rollbackMutation}
				/>
			)}
		</>
	);
}

/* ========== 未配置引导：一键从全局复制 ========== */
function CopyTemplateGuide({
	userId,
	type,
	meta,
	copyMutation,
}: {
	userId: string;
	type: PromptType;
	meta: (typeof TAB_META)[PromptType];
	copyMutation: ReturnType<typeof useCopyUserPromptTemplate>;
}) {
	return (
		<div className={styles.form}>
			<p className={styles.sectionHint} style={{ marginBottom: 12 }}>
				该用户暂未配置「{meta.label}」，当前任务使用全局话术。
				可一键复制全局当前版本作为起点，再按需修改。
			</p>
			{copyMutation.error && (
				<div className={styles.errorBox}>
					<AlertCircle className={styles.errorIcon} />
					<span>复制失败：{(copyMutation.error as RequestError).message}</span>
				</div>
			)}
			{copyMutation.isSuccess && (
				<div className={styles.successBox}>
					✓ 已从全局模板复制为该用户的 v1，可继续编辑
				</div>
			)}
			<div className={styles.formActions}>
				<button
					type="button"
					className={styles.primaryBtn}
					onClick={() => copyMutation.mutate(type)}
					disabled={copyMutation.isPending}
				>
					{copyMutation.isPending ? (
						<Loader2 className={styles.spinner} />
					) : (
						<Copy />
					)}
					<span>从全局模板复制</span>
				</button>
			</div>
		</div>
	);
}

/* ========== 当前版本编辑表单 ========== */
function EditForm({
	userId,
	type,
	meta,
	current,
	saveMutation,
}: {
	userId: string;
	type: PromptType;
	meta: (typeof TAB_META)[PromptType];
	current: {
		id: number;
		version: number;
		content: string;
		note: string | null;
		createdBy: string;
		createdAt: string;
	};
	saveMutation: ReturnType<typeof useSaveUserPrompt>;
}) {
	const [content, setContent] = useState(current.content);
	const [note, setNote] = useState('');
	const [localError, setLocalError] = useState<string | null>(null);

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setLocalError(null);
		// 客户端预校验（与服务端 validatePromptContent 口径一致）
		const error = validatePromptContent(type, content);
		if (error) {
			setLocalError(error);
			return;
		}
		saveMutation.mutate({ content, note: note || undefined });
		setNote('');
	}

	return (
		<form className={styles.form} onSubmit={handleSubmit}>
			<p className={styles.sectionHint} style={{ marginBottom: 12 }}>
				{meta.desc}。当前 v{current.version}，由{' '}
				<code className={styles.codeInline}>{current.createdBy}</code> 于{' '}
				{new Date(current.createdAt).toLocaleString('zh-CN')} 更新。
			</p>

			<label className={styles.field}>
				<span className={styles.label}>Prompt 内容</span>
				<textarea
					className="prompt-textarea"
					value={content}
					onChange={(e) => setContent(e.target.value)}
					placeholder={meta.placeholder}
					rows={14}
					spellCheck={false}
					required
				/>
				<span className={styles.sectionHint}>
					字符数：{content.length.toLocaleString()}
				</span>
			</label>

			<label className={styles.field}>
				<span className={styles.label}>保存备注（可选）</span>
				<input
					className={styles.input}
					value={note}
					onChange={(e) => setNote(e.target.value)}
					placeholder="如：为该用户定制评分口径"
					maxLength={200}
				/>
			</label>

			{localError && (
				<div className={styles.errorBox}>
					<AlertCircle className={styles.errorIcon} />
					<span>{localError}</span>
				</div>
			)}
			{saveMutation.error && (
				<div className={styles.errorBox}>
					<AlertCircle className={styles.errorIcon} />
					<span>保存失败：{(saveMutation.error as RequestError).message}</span>
				</div>
			)}
			{saveMutation.isSuccess && saveMutation.data && (
				<div className={styles.successBox}>
					✓ 新版本已保存（v{saveMutation.data.version}），60 秒内对该用户生效
				</div>
			)}

			<div className={styles.formActions}>
				<button
					type="submit"
					className={styles.primaryBtn}
					disabled={saveMutation.isPending}
				>
					{saveMutation.isPending ? (
						<Loader2 className={styles.spinner} />
					) : (
						<Save />
					)}
					<span>保存新版本</span>
				</button>
			</div>
		</form>
	);
}

/* ========== 历史版本列表 + 回滚 ========== */
function UserHistoryList({
	userId,
	type,
	history,
	rollbackMutation,
}: {
	userId: string;
	type: PromptType;
	history: Array<{
		id: number;
		version: number;
		note: string | null;
		createdBy: string;
		createdAt: string;
		isCurrent: boolean;
	}>;
	rollbackMutation: ReturnType<typeof useRollbackUserPrompt>;
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

	if (history.length === 0) return null;

	return (
		<div style={{ marginTop: 24 }}>
			<div className={styles.sectionHeader}>
				<div className={styles.sectionIcon}>
					<History strokeWidth={2} />
				</div>
				<div>
					<h2 className={styles.sectionTitle}>历史版本</h2>
					<p className={styles.sectionHint}>
						共 {history.length} 个版本。回滚会创建一个新版本（内容为所选版本），不删除历史记录。
					</p>
				</div>
			</div>

			{rollbackMutation.error && (
				<div className={styles.errorBox}>
					<AlertCircle className={styles.errorIcon} />
					<span>回滚失败：{(rollbackMutation.error as RequestError).message}</span>
				</div>
			)}

			<div className="prompt-history-list">
				{history.map((v) => {
					const isConfirming = confirmingId === v.id;
					const isRolling = rollbackMutation.isPending && confirmingId === v.id;
					return (
						<div key={v.id} className="prompt-history-row">
							<div className="prompt-history-meta">
								<span
									className={`prompt-version-tag ${v.isCurrent ? 'prompt-version-current' : ''}`}
								>
									v{v.version}
									{v.isCurrent && ' · 当前'}
								</span>
								<span className="prompt-history-note">{v.note ?? '（无备注）'}</span>
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
										className={`prompt-action-btn ${isConfirming ? 'prompt-action-confirm' : 'prompt-action-rollback'}`}
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
				<UserVersionViewer
					userId={userId}
					type={type}
					versionId={viewingId}
					onClose={() => setViewingId(null)}
				/>
			)}
		</div>
	);
}

/* ========== 历史版本查看弹窗 ========== */
function UserVersionViewer({
	userId,
	type,
	versionId,
	onClose,
}: {
	userId: string;
	type: PromptType;
	versionId: number;
	onClose: () => void;
}) {
	const { data, isLoading } = useUserPromptVersion(userId, type, versionId);

	return (
		<div className="prompt-viewer-overlay" onClick={onClose}>
			<div className="prompt-viewer-modal" onClick={(e) => e.stopPropagation()}>
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
									{data.createdBy} ·{' '}
									{new Date(data.createdAt).toLocaleString('zh-CN')}
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

export default UserPromptConfigSection;
