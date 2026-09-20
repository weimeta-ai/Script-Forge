// 登录页轮播图管理（admin only）
// -----------------------------------------------------------------------------
// 结构：Sidebar → Hero → 上传卡片 → 列表（缩略图 / 标题 / 排序 / 启用 / 删除）
// 批量能力：复选框多选 + 顶部工具栏（全选/反选 + 批量启用/禁用/删除 + 保存全部改动）
// 复用：ImageConfig.module.css 样式（与 OssConfig / ImageConfig 一致）
// =============================================================================

import {
	AlertCircle,
	ArrowLeft,
	CheckCircle2,
	GalleryVerticalEnd,
	Loader2,
	Save,
	Trash2,
	Upload,
	X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
	deleteBanner as deleteBannerRaw,
	updateBanner as updateBannerRaw,
	useAdminBanners,
	useDeleteBanner,
	useUpdateBanner,
	useUploadBanner,
} from '../../api/login-banner';
import { loginBannerKeys } from '../../api/login-banner';
import { AppShell, type BarItem } from '../../components/shell';
import { slideUp, staggerContainer } from '../../lib/animations';
import { RequestError } from '../../lib/request';
import type { AdminLoginBanner } from '../../types/login-banner';
import { useQueryClient } from '@tanstack/react-query';
import styles from './ImageConfig.module.css';

// 单条编辑缓冲（用于 diff 检测 + 批量保存）
interface EditState {
	title: string;
	sortOrder: number;
}

// 批量操作结果（顶部提示用）
interface BatchResult {
	kind: 'success' | 'error';
	message: string;
}

export default function LoginBanners() {
	const navigate = useNavigate();
	const { data, isLoading } = useAdminBanners();
	const queryClient = useQueryClient();

	// === 批量状态 ===
	// 选中行（基于 id 的 Set）
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	// 编辑缓冲：仅存"被编辑过"的行（lazy 初始化，未编辑的行访问时用 banner 原值兜底）
	const [edits, setEdits] = useState<Record<string, EditState>>({});
	// 批量操作结果（顶部 alertBlock）
	const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
	// 批量动作进行中（避免并发触发）
	const [batchPending, setBatchPending] = useState(false);

	// 行级 mutation（保留单行操作能力）
	const updateMutation = useUpdateBanner();
	const deleteMutation = useDeleteBanner();

	// === 衍生值 ===
	const banners = data ?? [];
	const total = banners.length;
	const selectedCount = useMemo(
		() => banners.filter((b) => selectedIds.has(b.id)).length,
		[banners, selectedIds],
	);
	const allSelected = total > 0 && selectedCount === total;
	// 有改动的行（diff 比较，用于"保存全部"按钮的可用性与目标集合）
	const dirtyBanners = useMemo(
		() =>
			banners.filter((b) => {
				const e = edits[b.id];
				if (!e) return false;
				return e.title !== (b.title ?? '') || e.sortOrder !== b.sortOrder;
			}),
		[banners, edits],
	);

	// === 选择 ===
	function toggleSelect(id: string) {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}
	function toggleSelectAll() {
		if (allSelected) {
			setSelectedIds(new Set());
		} else {
			setSelectedIds(new Set(banners.map((b) => b.id)));
		}
	}

	// === 编辑（受控） ===
	function updateEdit(
		id: string,
		patch: Partial<EditState>,
		banner: AdminLoginBanner,
	) {
		setEdits((prev) => {
			const base: EditState =
				prev[id] ?? { title: banner.title ?? '', sortOrder: banner.sortOrder };
			return { ...prev, [id]: { ...base, ...patch } };
		});
	}

	// === 批量操作（统一封装部分失败处理 + invalidate 缓存） ===
	async function runBatch<T>(
		ids: string[],
		action: (id: string) => Promise<T>,
		actionName: string,
		options?: { clearSelection?: boolean; clearEdits?: boolean },
	) {
		if (ids.length === 0 || batchPending) return;
		setBatchPending(true);
		setBatchResult(null);
		const results = await Promise.allSettled(ids.map(action));
		const failed = results.filter((r) => r.status === 'rejected');
		if (failed.length === 0) {
			setBatchResult({
				kind: 'success',
				message: `批量${actionName}完成，共 ${ids.length} 项`,
			});
		} else {
			const firstReason = (failed[0] as PromiseRejectedResult).reason;
			const errMsg =
				firstReason instanceof RequestError
					? firstReason.message
					: firstReason instanceof Error
						? firstReason.message
						: '未知错误';
			setBatchResult({
				kind: 'error',
				message: `批量${actionName}失败 ${failed.length}/${ids.length}：${errMsg}`,
			});
		}
		// 统一刷新缓存（无论成功失败，让 UI 反映真实状态）
		await queryClient.invalidateQueries({ queryKey: loginBannerKeys.all });
		if (options?.clearSelection) setSelectedIds(new Set());
		if (options?.clearEdits) {
			const succeededIds = new Set(
				results
					.map((r, i) => (r.status === 'fulfilled' ? ids[i] : null))
					.filter((x): x is string => x !== null),
			);
			// 只清空成功的 edits（失败的保留以便重试）
			setEdits((prev) => {
				const next: Record<string, EditState> = {};
				for (const [id, e] of Object.entries(prev)) {
					if (!succeededIds.has(id)) next[id] = e;
				}
				return next;
			});
		}
		setBatchPending(false);
	}

	// 批量启用 / 禁用（针对选中行）
	function batchSetActive(active: boolean) {
		const ids = banners.filter((b) => selectedIds.has(b.id)).map((b) => b.id);
		void runBatch(
			ids,
			(id) => updateBannerRaw(id, { isActive: active }),
			active ? '启用' : '禁用',
			{ clearSelection: true },
		);
	}

	// 批量删除（针对选中行，需二次确认）
	async function batchDelete() {
		const ids = banners.filter((b) => selectedIds.has(b.id)).map((b) => b.id);
		if (ids.length === 0 || batchPending) return;
		if (
			!window.confirm(
				`确认删除选中的 ${ids.length} 张轮播图？\n此操作会同步删除 OSS 对象，不可恢复。`,
			)
		)
			return;
		await runBatch(
			ids,
			(id) => deleteBannerRaw(id),
			'删除',
			{ clearSelection: true },
		);
	}

	// 保存全部改动（针对所有 dirty 行，不限于选中）
	function saveAll() {
		const ids = dirtyBanners.map((b) => b.id);
		void runBatch(
			ids,
			(id) => {
				const e = edits[id]!;
				return updateBannerRaw(id, {
					title: e.title.trim() || null,
					sortOrder: e.sortOrder,
				});
			},
			'保存',
			{ clearEdits: true },
		);
	}

	const topItems: BarItem[] = [
		{ icon: GalleryVerticalEnd, label: '管理', value: '登录轮播' },
	];

	return (
		<AppShell>
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
					<span className={styles.breadcrumb}>登录轮播图管理</span>
				</div>
				<span className={styles.adminTag}>管理 · 登录轮播</span>
			</div>

			<motion.div
				variants={staggerContainer}
				initial="hidden"
				animate="show"
				className={styles.hero}
			>
				<motion.div variants={slideUp} className={styles.heroHeader}>
					<span className={styles.heroTag}>// 运行时 · 展示位</span>
					<h1 className={styles.heroTitle}>
						<span className={styles.heroGradient}>登录页轮播图</span>
					</h1>
					<p className={styles.heroSubtitle}>
						上传图片到 OSS 图床后会立即在登录页轮播展示。支持启用/禁用、调整排序、删除。
						排序按数字升序（数字越小越靠前），同序按上传时间升序。
					</p>
				</motion.div>
			</motion.div>

			<UploadCard />

			<motion.section
				variants={slideUp}
				initial="hidden"
				animate="show"
				className={styles.configSection}
			>
				<div className={styles.sectionHeader}>
					<div className={styles.sectionIcon}>
						<GalleryVerticalEnd strokeWidth={2} />
					</div>
					<div>
						<h2 className={styles.sectionTitle}>轮播列表</h2>
						<p className={styles.sectionHint}>
							共 {total} 张图片（含禁用项）
						</p>
					</div>
				</div>

				{/* 批量工具栏 + 结果提示（仅有数据时展示） */}
				{total > 0 && (
					<BatchToolbar
						total={total}
						selectedCount={selectedCount}
						allSelected={allSelected}
						dirtyCount={dirtyBanners.length}
						batchPending={batchPending}
						onToggleSelectAll={toggleSelectAll}
						onBatchActive={batchSetActive}
						onBatchDelete={batchDelete}
						onSaveAll={saveAll}
						result={batchResult}
						onDismissResult={() => setBatchResult(null)}
					/>
				)}

				{isLoading ? (
					<div className={styles.loadingRow}>
						<Loader2 className={styles.spinner} />
						<span>加载中…</span>
					</div>
				) : total === 0 ? (
					<p
						className={styles.sectionHint}
						style={{ padding: '24px 0', textAlign: 'center' }}
					>
						暂无轮播图，请上传第一张
					</p>
				) : (
					<div style={{ display: 'grid', gap: 12 }}>
						{banners.map((banner) => (
							<BannerRow
								key={banner.id}
								banner={banner}
								edit={
									edits[banner.id] ?? {
										title: banner.title ?? '',
										sortOrder: banner.sortOrder,
									}
								}
								onEditChange={(patch) => updateEdit(banner.id, patch, banner)}
								selected={selectedIds.has(banner.id)}
								onToggleSelect={() => toggleSelect(banner.id)}
								updatePending={updateMutation.isPending}
								deletePending={deleteMutation.isPending}
							/>
						))}
					</div>
				)}
			</motion.section>
		</AppShell>
	);
}

/* ========== 批量工具栏 ========== */
interface BatchToolbarProps {
	total: number;
	selectedCount: number;
	allSelected: boolean;
	dirtyCount: number;
	batchPending: boolean;
	onToggleSelectAll: () => void;
	onBatchActive: (active: boolean) => void;
	onBatchDelete: () => void;
	onSaveAll: () => void;
	result: BatchResult | null;
	onDismissResult: () => void;
}

function BatchToolbar({
	total,
	selectedCount,
	allSelected,
	dirtyCount,
	batchPending,
	onToggleSelectAll,
	onBatchActive,
	onBatchDelete,
	onSaveAll,
	result,
	onDismissResult,
}: BatchToolbarProps) {
	// indeterminate：部分选中时 checkbox 显示半选状态
	const selectAllRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (selectAllRef.current) {
			selectAllRef.current.indeterminate =
				selectedCount > 0 && !allSelected;
		}
	}, [selectedCount, allSelected]);

	const noSelection = selectedCount === 0;
	const noDirty = dirtyCount === 0;

	return (
		<div
			style={{
				display: 'grid',
				gap: 10,
				padding: '12px 14px',
				marginBottom: 12,
				borderRadius: 12,
				background: 'rgba(255,255,255,0.72)',
				border: '1px solid rgba(102,89,76,0.12)',
			}}
		>
			{/* 行 1：选择 + 主操作 */}
			<div
				style={{
					display: 'flex',
					flexWrap: 'wrap',
					alignItems: 'center',
					gap: 10,
				}}
			>
				<label
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 6,
						cursor: 'pointer',
						fontSize: 13,
						color: '#1C1815',
					}}
				>
					<input
						ref={selectAllRef}
						type="checkbox"
						checked={allSelected}
						onChange={onToggleSelectAll}
						style={{ cursor: 'pointer', width: 16, height: 16 }}
						disabled={batchPending}
					/>
					<span>全选</span>
				</label>
				<span style={{ fontSize: 12, color: '#8B7B6A' }}>
					已选 {selectedCount} / 共 {total} 项
				</span>

				<div style={{ flex: 1 }} />

				<button
					type="button"
					className={styles.testBtn}
					onClick={() => onBatchActive(true)}
					disabled={noSelection || batchPending}
					title="批量启用选中项"
				>
					{batchPending ? <Loader2 className={styles.spinner} /> : null}
					批量启用
				</button>
				<button
					type="button"
					className={styles.testBtn}
					onClick={() => onBatchActive(false)}
					disabled={noSelection || batchPending}
					title="批量禁用选中项"
				>
					批量禁用
				</button>
				<button
					type="button"
					className={styles.testBtn}
					onClick={onBatchDelete}
					disabled={noSelection || batchPending}
					title="批量删除选中项"
					style={{ color: '#B8443C' }}
				>
					<Trash2 strokeWidth={2} size={14} />
					批量删除
				</button>

				{/* 分隔线：选择相关 vs 编辑保存相关 */}
				<div
					style={{
						width: 1,
						alignSelf: 'stretch',
						background: 'rgba(102,89,76,0.16)',
					}}
				/>

				<button
					type="button"
					className={styles.saveBtn}
					onClick={onSaveAll}
					disabled={noDirty || batchPending}
					title="保存全部标题/排序改动（不限于选中行）"
				>
					{batchPending ? (
						<Loader2 className={styles.spinner} />
					) : (
						<Save strokeWidth={2} size={14} />
					)}
					保存全部改动{dirtyCount > 0 ? ` (${dirtyCount})` : ''}
				</button>
			</div>

			{/* 行 2：批量操作结果提示 */}
			{result && (
				<div
					className={`${styles.alertBlock} ${
						result.kind === 'success' ? styles.alertSuccess : styles.alertError
					}`}
					style={{ display: 'flex', alignItems: 'center', gap: 8 }}
				>
					{result.kind === 'success' ? (
						<CheckCircle2 strokeWidth={2} size={14} />
					) : (
						<AlertCircle strokeWidth={2} size={14} />
					)}
					<span style={{ flex: 1, fontSize: 12 }}>{result.message}</span>
					<button
						type="button"
						onClick={onDismissResult}
						aria-label="关闭提示"
						style={{
							border: 'none',
							background: 'transparent',
							cursor: 'pointer',
							color: 'inherit',
							display: 'flex',
							padding: 2,
						}}
					>
						<X size={14} strokeWidth={2} />
					</button>
				</div>
			)}
		</div>
	);
}

/* ========== 上传卡片（支持批量） ========== */
function UploadCard() {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const uploadMutation = useUploadBanner();

	// 已选文件队列（支持多次追加）
	const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
	// 上传进度：{ done, total, failures: [{ name, reason }] }
	const [progress, setProgress] = useState<{
		done: number;
		total: number;
		failures: { name: string; reason: string }[];
	} | null>(null);
	const [isUploading, setIsUploading] = useState(false);

	function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
		const list = e.target.files;
		if (!list || list.length === 0) return;
		const picked = Array.from(list);
		setSelectedFiles((prev) => [...prev, ...picked]);
		// 清空 input.value 让用户能再次选择同名文件
		if (fileInputRef.current) fileInputRef.current.value = '';
	}

	function handleRemoveFile(idx: number) {
		setSelectedFiles((prev) => prev.filter((_, i) => i !== idx));
	}

	function handleClearAll() {
		setSelectedFiles([]);
	}

	async function handleUpload() {
		if (selectedFiles.length === 0 || isUploading) return;
		setIsUploading(true);
		setProgress({ done: 0, total: selectedFiles.length, failures: [] });
		const failures: { name: string; reason: string }[] = [];
		let done = 0;

		// 串行上传（避免并发冲爆 OSS / DB；单张已足够快）
		for (const file of selectedFiles) {
			try {
				await uploadMutation.mutateAsync(file);
			} catch (e) {
				failures.push({
					name: file.name,
					reason: (e as RequestError).message,
				});
			}
			done += 1;
			setProgress({ done, total: selectedFiles.length, failures });
		}

		setIsUploading(false);

		// 全部成功 → 清空已选；部分失败 → 仅保留失败的，方便重试
		if (failures.length === 0) {
			setSelectedFiles([]);
		} else {
			const failureNames = new Set(failures.map((f) => f.name));
			setSelectedFiles((prev) =>
				prev.filter((f) => failureNames.has(f.name)),
			);
		}
	}

	// 汇总提示（上传结束且不在上传中时显示）
	const summary =
		!isUploading && progress
			? progress.failures.length === 0
				? `上传完成：共 ${progress.total} 张`
				: `上传完成：成功 ${progress.total - progress.failures.length} 张，失败 ${progress.failures.length} 张`
			: null;

	const summaryIsSuccess = progress ? progress.failures.length === 0 : false;

	return (
		<motion.section
			variants={slideUp}
			initial="hidden"
			animate="show"
			className={styles.configSection}
		>
			<div className={styles.sectionHeader}>
				<div className={styles.sectionIcon}>
					<Upload strokeWidth={2} />
				</div>
				<div>
					<h2 className={styles.sectionTitle}>上传新图片</h2>
					<p className={styles.sectionHint}>
						支持 image/jpeg / png / webp，单张上限 5MB，可一次选择多张批量上传。
						上传后默认启用、排序 0。
					</p>
				</div>
			</div>

			<form
				className={styles.form}
				onSubmit={(e) => {
					e.preventDefault();
					handleUpload();
				}}
			>
				<label className={styles.field}>
					<span className={styles.fieldLabel}>选择图片（可多选）</span>
					<input
						ref={fileInputRef}
						type="file"
						accept="image/jpeg,image/png,image/webp"
						multiple
						className={styles.input}
						onChange={handleSelect}
						disabled={isUploading}
						style={{ padding: '8px' }}
					/>
					<span className={styles.fieldHint}>
						点击选择一个或多个本地图片文件（可多次追加）
					</span>
				</label>

				{/* 已选文件列表 */}
				{selectedFiles.length > 0 && (
					<div
						style={{
							display: 'grid',
							gap: 6,
							padding: '8px 10px',
							borderRadius: 10,
							background: 'rgba(255,255,255,0.6)',
							border: '1px solid rgba(102,89,76,0.08)',
						}}
					>
						{selectedFiles.map((file, idx) => (
							<div
								key={`${file.name}-${idx}`}
								style={{
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'space-between',
									gap: 8,
									fontSize: 13,
									color: '#1C1815',
								}}
							>
								<span
									style={{
										overflow: 'hidden',
										textOverflow: 'ellipsis',
										whiteSpace: 'nowrap',
									}}
									title={file.name}
								>
									{file.name}{' '}
									<span style={{ color: '#8B7B6A' }}>
										({(file.size / 1024).toFixed(1)} KB)
									</span>
								</span>
								<button
									type="button"
									onClick={() => handleRemoveFile(idx)}
									disabled={isUploading}
									aria-label="移除"
									style={{
										border: 'none',
										background: 'transparent',
										cursor: isUploading ? 'not-allowed' : 'pointer',
										color: '#8B7B6A',
										display: 'flex',
										padding: 2,
									}}
								>
									<X size={14} strokeWidth={2} />
								</button>
							</div>
						))}
						{!isUploading && (
							<button
								type="button"
								onClick={handleClearAll}
								style={{
									border: 'none',
									background: 'transparent',
									cursor: 'pointer',
									color: '#8B7B6A',
									fontSize: 12,
									padding: 0,
									textAlign: 'left',
								}}
								className={styles.fieldHint}
								role="button"
								tabIndex={0}
							>
								清空已选
							</button>
						)}
					</div>
				)}

				{/* 上传进度 */}
				{isUploading && progress && (
					<div
						className={`${styles.alertBlock} ${styles.alertSuccess}`}
						style={{
							flexDirection: 'column',
							alignItems: 'stretch',
							gap: 6,
						}}
					>
						<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
							<Loader2 className={styles.spinner} />
							<span>
								上传中… {progress.done} / {progress.total}
								{progress.failures.length > 0 &&
									`（已失败 ${progress.failures.length}）`}
							</span>
						</div>
						{/* 进度条 */}
						<div
							style={{
								height: 4,
								borderRadius: 2,
								background: 'rgba(102,89,76,0.12)',
								overflow: 'hidden',
							}}
						>
							<div
								style={{
									width: `${progress.total === 0 ? 0 : (progress.done / progress.total) * 100}%`,
									height: '100%',
									background: '#B8443C',
									transition: 'width 240ms ease',
								}}
							/>
						</div>
					</div>
				)}

				{/* 上传汇总（部分失败时展示失败详情） */}
				{summary && (
					<div
						className={`${styles.alertBlock} ${summaryIsSuccess ? styles.alertSuccess : styles.alertError}`}
						style={{
							flexDirection: 'column',
							alignItems: 'stretch',
							gap: 6,
						}}
					>
						<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
							{summaryIsSuccess ? (
								<CheckCircle2 strokeWidth={2} />
							) : (
								<AlertCircle strokeWidth={2} />
							)}
							<span>{summary}</span>
						</div>
						{!summaryIsSuccess && progress && progress.failures.length > 0 && (
							<ul
								style={{
									margin: 0,
									paddingLeft: 22,
									fontSize: 12,
									lineHeight: 1.6,
								}}
							>
								{progress.failures.map((f) => (
									<li key={f.name}>
										<strong>{f.name}</strong>：{f.reason}
									</li>
								))}
							</ul>
						)}
					</div>
				)}

				<div className={styles.actions}>
					<button
						type="submit"
						className={styles.saveBtn}
						disabled={isUploading || selectedFiles.length === 0}
					>
						{isUploading ? (
							<Loader2 className={styles.spinner} />
						) : (
							<Upload strokeWidth={2} />
						)}
						{isUploading
							? '上传中…'
							: `上传 ${selectedFiles.length > 0 ? `${selectedFiles.length} 张` : '到 OSS'}`}
					</button>
				</div>
			</form>
		</motion.section>
	);
}

/* ========== 列表行（受控组件） ========== */
interface BannerRowProps {
	banner: AdminLoginBanner;
	edit: EditState;
	onEditChange: (patch: Partial<EditState>) => void;
	selected: boolean;
	onToggleSelect: () => void;
	updatePending: boolean;
	deletePending: boolean;
}

function BannerRow({
	banner,
	edit,
	onEditChange,
	selected,
	onToggleSelect,
	updatePending,
	deletePending,
}: BannerRowProps) {
	const updateMutation = useUpdateBanner();
	const deleteMutation = useDeleteBanner();
	const [error, setError] = useState<string | null>(null);

	// 单行保存（保留原行为：仅保存本行 title+sortOrder）
	async function handleSaveTitleAndSort() {
		setError(null);
		try {
			await updateMutation.mutateAsync({
				id: banner.id,
				patch: {
					title: edit.title.trim() || null,
					sortOrder: edit.sortOrder,
				},
			});
		} catch (e) {
			setError((e as RequestError).message);
		}
	}

	async function handleToggleActive() {
		setError(null);
		try {
			await updateMutation.mutateAsync({
				id: banner.id,
				patch: { isActive: !banner.isActive },
			});
		} catch (e) {
			setError((e as RequestError).message);
		}
	}

	async function handleDelete() {
		if (!window.confirm(`确认删除这张轮播图？\n${banner.imageUrl}`)) return;
		setError(null);
		try {
			await deleteMutation.mutateAsync(banner.id);
		} catch (e) {
			setError((e as RequestError).message);
		}
	}

	const isSaving = updateMutation.isPending || updatePending;
	const isDeleting = deleteMutation.isPending || deletePending;

	return (
		<div
			className="grid items-center gap-[14px] grid-cols-[24px_80px_minmax(0,1fr)] sm:grid-cols-[24px_80px_minmax(0,1fr)_auto]"
			style={{
				padding: '12px 14px',
				borderRadius: 12,
				background: 'rgba(255,255,255,0.72)',
				border: selected
					? '1px solid rgba(184,68,60,0.42)'
					: '1px solid rgba(102,89,76,0.08)',
				opacity: banner.isActive ? 1 : 0.55,
				boxShadow: selected ? '0 0 0 3px rgba(184,68,60,0.06)' : 'none',
				transition: 'border-color 200ms ease, box-shadow 200ms ease',
			}}
		>
			{/* 复选框 */}
			<input
				type="checkbox"
				checked={selected}
				onChange={onToggleSelect}
				aria-label={`选择 ${banner.title ?? '此轮播图'}`}
				style={{ cursor: 'pointer', width: 16, height: 16 }}
			/>

			{/* 缩略图 */}
			<a
				href={banner.imageUrl}
				target="_blank"
				rel="noopener noreferrer"
				style={{ display: 'block' }}
				title="点击查看原图"
			>
				<img
					src={banner.imageUrl}
					alt={banner.title ?? '轮播图'}
					style={{
						width: 80,
						height: 56,
						objectFit: 'cover',
						borderRadius: 8,
						border: '1px solid rgba(102,89,76,0.12)',
					}}
				/>
			</a>

			{/* 中部：标题 + 排序 */}
			<div style={{ display: 'grid', gap: 6 }}>
				<input
					className={styles.input}
					value={edit.title}
					onChange={(e) => onEditChange({ title: e.target.value })}
					placeholder="标题（可选）"
				/>
				<div
					style={{
						display: 'flex',
						gap: 10,
						alignItems: 'center',
						fontSize: 12,
						color: '#8B7B6A',
					}}
				>
					<label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
						排序
						<input
							type="number"
							min={0}
							max={99999}
							value={edit.sortOrder}
							onChange={(e) =>
								onEditChange({ sortOrder: Number(e.target.value) || 0 })
							}
							className={styles.input}
							style={{ width: 70, padding: '4px 8px' }}
						/>
					</label>
					<span>· 上传者 {banner.uploadedBy}</span>
					<span>· {new Date(banner.createdAt).toLocaleString('zh-CN')}</span>
				</div>
				{error && (
					<div
						style={{
							display: 'flex',
							gap: 6,
							alignItems: 'center',
							color: '#B8443C',
							fontSize: 12,
						}}
					>
						<AlertCircle size={12} strokeWidth={2} />
						<span>{error}</span>
					</div>
				)}
			</div>

			{/* 操作 */}
			<div
				className="col-span-2 sm:col-span-1 flex items-center"
				style={{ gap: 6, justifyContent: 'flex-end' }}
			>
				<button
					type="button"
					className={styles.testBtn}
					onClick={handleSaveTitleAndSort}
					disabled={isSaving}
					title="保存本行标题与排序"
				>
					{isSaving ? <Loader2 className={styles.spinner} /> : <Save strokeWidth={2} />}
					保存
				</button>
				<button
					type="button"
					className={styles.testBtn}
					onClick={handleToggleActive}
					disabled={isSaving}
					title={banner.isActive ? '禁用' : '启用'}
				>
					{banner.isActive ? '已启用' : '已禁用'}
				</button>
				<button
					type="button"
					className={styles.testBtn}
					onClick={handleDelete}
					disabled={isDeleting}
					title="删除"
					style={{ color: '#B8443C' }}
				>
					{isDeleting ? (
						<Loader2 className={styles.spinner} />
					) : (
						<Trash2 strokeWidth={2} />
					)}
				</button>
			</div>
		</div>
	);
}
