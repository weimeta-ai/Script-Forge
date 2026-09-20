// 知识库导入页（5c 阶段，admin only）
// -----------------------------------------------------------------------------
// 结构（由 AppShell 提供 Sidebar + HUD）：
//   页内工具条 → Hero → JSON 导入区（textarea + 校验 + 提交） → 已导入列表（过滤 + 分页 + 删除）
// 设计原则：
//   - 前端先做 JSON.parse + 粗校验，避免无效请求
//   - summary ≥120 字硬约束（后端会再校验）
//   - 单批 ≤500 条
// -----------------------------------------------------------------------------

import { useState } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import {
	ArrowLeft,
	Database,
	Upload,
	Trash2,
	Code2,
	Loader2,
	AlertCircle,
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
} from 'lucide-react';
import { slideUp, staggerContainer } from '../../lib/animations';
import { RequestError } from '../../lib/request';
import {
	useKnowledgeSamples,
	useBatchImport,
	useDeleteKnowledgeSample,
} from '../../api/knowledge';
import type { KnowledgeGrade } from '../../types/knowledge';
import { AppShell, type BarItem } from '../../components/shell';
import styles from './KnowledgeImport.module.css';

const GENRES = ['都市', '穿越', '重生', '复仇', '甜宠', '悬疑', '玄幻', '古装', '家庭', '其他'];
const GRADES: KnowledgeGrade[] = ['A', 'B', 'C', 'D'];
const PAGE_SIZE = 10;

// 默认示例（用户首次进入时看到）
const SAMPLE_JSON = `{
  "samples": [
    {
      "title": "示例：霸总的替身新娘",
      "genre": "都市",
      "grade": "A",
      "overallScore": 88.5,
      "summary": "前 30 秒强冲突开场：女主在婚礼上被新郎当众退婚，转身嫁给他小叔。开局钩子强度 90+，符合评估口径第 4 条降分锚点反向要求。中段复仇线 + 甜宠线交织，节奏紧凑，每 3 分钟一个小爽点、每 10 分钟一个大反转。",
      "highlights": ["开场 30 秒强冲突", "复仇+甜宠双线", "每 3 分钟小爽点"],
      "sixDimensions": { "rhythm": 86, "emotion": 88, "conflict": 90, "character": 82, "dialogue": 80, "genre": 88 }
    }
  ]
}`;

export default function KnowledgeImport() {
	const navigate = useNavigate();

	const topItems: BarItem[] = [
		{ icon: Database, label: '管理', value: '知识库' },
	];

	// JSON 导入状态
	const [jsonText, setJsonText] = useState('');
	const [showSample, setShowSample] = useState(false);
	const [localError, setLocalError] = useState<string | null>(null);
	const [successMsg, setSuccessMsg] = useState<string | null>(null);

	// 列表过滤状态
	const [filterGenre, setFilterGenre] = useState<string>('');
	const [filterGrade, setFilterGrade] = useState<string>('');
	const [page, setPage] = useState(1);

	const batchMutation = useBatchImport();
	const deleteMutation = useDeleteKnowledgeSample();
	const { data: listData, isLoading } = useKnowledgeSamples({
		genre: filterGenre || undefined,
		grade: (filterGrade || undefined) as KnowledgeGrade | undefined,
		page,
		pageSize: PAGE_SIZE,
	});

	// 前端 JSON 解析 + 粗校验（summary 长度、grade 枚举）
	function handleValidate(raw: string): { ok: true; data: unknown } | { ok: false; error: string } {
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (e) {
			return { ok: false, error: `JSON 解析失败：${(e as Error).message}` };
		}

		const obj = parsed as { samples?: unknown };
		if (!Array.isArray(obj.samples)) {
			return { ok: false, error: 'JSON 必须包含 samples 数组字段' };
		}
		if (obj.samples.length === 0) {
			return { ok: false, error: 'samples 至少 1 条' };
		}
		if (obj.samples.length > 500) {
			return { ok: false, error: 'samples 单批最多 500 条' };
		}

		for (let i = 0; i < obj.samples.length; i++) {
			const s = obj.samples[i] as Record<string, unknown>;
			if (typeof s.title !== 'string' || !s.title) {
				return { ok: false, error: `第 ${i + 1} 条：title 必填` };
			}
			if (typeof s.genre !== 'string' || !s.genre) {
				return { ok: false, error: `第 ${i + 1} 条：genre 必填` };
			}
			if (!['A', 'B', 'C', 'D'].includes(s.grade as string)) {
				return { ok: false, error: `第 ${i + 1} 条：grade 必须是 A/B/C/D` };
			}
			if (typeof s.summary !== 'string' || s.summary.length < 120) {
				return { ok: false, error: `第 ${i + 1} 条：summary 至少 120 字（当前 ${typeof s.summary === 'string' ? s.summary.length : 0} 字）` };
			}
		}

		return { ok: true, data: parsed };
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setLocalError(null);

		const result = handleValidate(jsonText);
		if (!result.ok) {
			setLocalError(result.error);
			return;
		}

		try {
			const inserted = await batchMutation.mutateAsync(result.data as never);
			setJsonText('');
			setSuccessMsg(`成功导入 ${inserted.inserted} 条样本`);
			setTimeout(() => setSuccessMsg(null), 3000);
		} catch (err) {
			const msg =
				err instanceof RequestError
					? err.message
					: err instanceof Error
						? err.message
						: '导入失败';
			setLocalError(msg);
		}
	}

	async function handleDelete(id: string, title: string) {
		if (!window.confirm(`确定删除样本「${title}」吗？\n软删后列表不再显示，但数据库保留。`)) {
			return;
		}
		try {
			await deleteMutation.mutateAsync(id);
		} catch {
			// 错误已塞到 mutation.error，下方 UI 渲染
		}
	}

	const mutationError =
		localError ||
		(batchMutation.error instanceof RequestError ? batchMutation.error.message : null) ||
		(deleteMutation.error instanceof RequestError ? deleteMutation.error.message : null);

	const items = listData?.items ?? [];
	const total = listData?.total ?? 0;
	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	return (
		<AppShell
			decorLevel="L2"
			topItems={topItems}
			topRight={[{ icon: Database, label: '知识库' }]}
			bottomItems={[{ label: '样本数', value: `${total}` }]}
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
					<span className={styles.breadcrumb}>知识库管理</span>
				</div>
				<span className={styles.adminTag}>管理 · 知识库</span>
			</div>

			{/* Hero */}
			<motion.div
				variants={staggerContainer}
				initial="hidden"
				animate="show"
				className={styles.hero}
			>
				<motion.div variants={slideUp} className={styles.heroHeader}>
					<span className={styles.heroTag}>// 样本知识库</span>
					<h1 className={styles.heroTitle}>
						<span className={styles.heroGradient}>知识库管理</span>
					</h1>
					<p className={styles.heroSubtitle}>
						管理员批量导入高分样本，5e 评分引擎会按题材 + 评级召回作为 few-shot 锚点。
						字段约束：summary ≥120 字、grade 仅 A/B/C/D、单批 ≤500 条。
					</p>
				</motion.div>
			</motion.div>

			{/* JSON 导入区 */}
			<motion.section
				variants={slideUp}
				initial="hidden"
				animate="show"
				className={styles.importSection}
			>
				<div className={styles.sectionHeader}>
					<div className={styles.sectionIcon}>
						<Upload strokeWidth={2} />
					</div>
					<div>
						<h2 className={styles.sectionTitle}>批量 JSON 导入</h2>
						<p className={styles.sectionHint}>
							把样本数组塞到 samples 字段，前端先做粗校验，后端 Zod 完整校验。
						</p>
					</div>
					<button
						type="button"
						onClick={() => setShowSample((v) => !v)}
						className={styles.sampleToggle}
					>
						<Code2 strokeWidth={2} />
						{showSample ? '隐藏示例' : '查看示例'}
					</button>
				</div>

				{showSample && (
					<pre className={styles.sampleCode}>{SAMPLE_JSON}</pre>
				)}

				<form onSubmit={handleSubmit} className={styles.form}>
					<textarea
						value={jsonText}
						onChange={(e) => {
							setJsonText(e.target.value);
							setLocalError(null);
							setSuccessMsg(null);
						}}
						className={styles.textarea}
						placeholder='{ "samples": [ { "title": "...", "genre": "都市", "grade": "A", "summary": "（至少 120 字的剧情摘要）" } ] }'
						spellCheck={false}
						rows={14}
					/>

					{mutationError && (
						<div className={styles.errorBox}>
							<AlertCircle className={styles.errorIcon} strokeWidth={2} />
							<span>{mutationError}</span>
						</div>
					)}

					{successMsg && (
						<div className={styles.successBox}>
							<CheckCircle2 className={styles.successIcon} strokeWidth={2} />
							<span>{successMsg}</span>
						</div>
					)}

					<div className={styles.formActions}>
						<button
							type="submit"
							disabled={batchMutation.isPending || !jsonText.trim()}
							className={styles.submitBtn}
						>
							{batchMutation.isPending ? (
								<>
									<Loader2 strokeWidth={2} />
									<span>导入中...</span>
								</>
							) : (
								<>
									<Upload strokeWidth={2} />
									<span>批量导入</span>
								</>
							)}
						</button>
					</div>
				</form>
			</motion.section>

			{/* 已导入列表 */}
			<motion.section
				variants={slideUp}
				initial="hidden"
				animate="show"
				className={styles.listSection}
			>
				<div className={styles.sectionHeader}>
					<div className={styles.sectionIcon}>
						<Database strokeWidth={2} />
					</div>
					<div>
						<h2 className={styles.sectionTitle}>已导入样本</h2>
						<p className={styles.sectionHint}>共 {total} 条 · 按 createdAt desc 排序</p>
					</div>

					<div className={styles.filters}>
						<select
							value={filterGenre}
							onChange={(e) => {
								setFilterGenre(e.target.value);
								setPage(1);
							}}
							className={styles.filterSelect}
						>
							<option value="">全部题材</option>
							{GENRES.map((g) => (
								<option key={g} value={g}>
									{g}
								</option>
							))}
						</select>
						<select
							value={filterGrade}
							onChange={(e) => {
								setFilterGrade(e.target.value);
								setPage(1);
							}}
							className={styles.filterSelect}
						>
							<option value="">全部评级</option>
							{GRADES.map((g) => (
								<option key={g} value={g}>
									{g}
								</option>
							))}
						</select>
					</div>
				</div>

				{isLoading ? (
					<div className={styles.loading}>
						<Loader2 strokeWidth={2} />
						<span>加载中...</span>
					</div>
				) : items.length === 0 ? (
					<div className={styles.empty}>
						<Database strokeWidth={2} />
						<p>暂无样本，先从上方导入吧。</p>
					</div>
				) : (
					<>
						<div className={styles.tableWrap}>
							<table className={styles.table}>
								<thead>
									<tr>
										<th>题材</th>
										<th>标题</th>
										<th>评级</th>
										<th>综合分</th>
										<th>摘要（前 80 字）</th>
										<th>操作</th>
									</tr>
								</thead>
								<tbody>
									{items.map((s) => (
										<tr key={s.id}>
											<td>
												<span className={styles.cellGenre}>{s.genre}</span>
											</td>
											<td className={styles.cellTitle}>{s.title}</td>
											<td>
												<span className={`${styles.cellGrade} ${styles[`grade_${s.grade}`]}`}>
													{s.grade}
												</span>
											</td>
											<td className={styles.cellScore}>
												{s.overallScore ? Number(s.overallScore).toFixed(1) : '—'}
											</td>
											<td className={styles.cellSummary}>{s.summary.slice(0, 80)}...</td>
											<td>
												<button
													type="button"
													aria-label="删除"
													onClick={() => handleDelete(s.id, s.title)}
													disabled={deleteMutation.isPending}
													className={styles.deleteBtn}
												>
													<Trash2 strokeWidth={2} />
												</button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>

						<div className={styles.pagination}>
							<button
								type="button"
								onClick={() => setPage((p) => Math.max(1, p - 1))}
								disabled={page <= 1}
								className={styles.pageBtn}
							>
								<ChevronLeft strokeWidth={2} />
								<span>上一页</span>
							</button>
							<span className={styles.pageInfo}>
								第 {page} / {totalPages} 页
							</span>
							<button
								type="button"
								onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
								disabled={page >= totalPages}
								className={styles.pageBtn}
							>
								<span>下一页</span>
								<ChevronRight strokeWidth={2} />
							</button>
						</div>
					</>
				)}
			</motion.section>
		</AppShell>
	);
}
