// 报告页（p00 同款：完整 markdown 报告 + Hero 大分数卡 + 右侧 TOC 侧栏 + PDF 下载）
// -----------------------------------------------------------------------------
// 路由：/report/:id  （id 是 scriptId）
// 数据：useReport(id) → GET /scripts/:id/report
// 渲染：marked + DOMPurify + addAnchors（在 MarkdownReport 内）
// TOC：本页面实现（h1-h3 抽取 + 滚动联动 + activeId 高亮）
// =============================================================================

import DOMPurify from 'dompurify';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useActiveTask, useReport } from '../api/scripts';
import { CoverGenerator } from '../components/CoverGenerator';
import { PipelineStatusBar } from '../components/PipelineStatusBar';
import { PageBackground } from '../components/shell';
import { configureMarked, marked } from '../lib/marked-config';
import {
	addAnchors,
	gradeColor,
	normalizeReportMarkdown,
	stripDisclaimerHtml,
	type TocItem,
} from '../lib/report-md';
import { useAuthStore } from '../store/auth';
import { toast } from '../store/toast';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export default function ReportPage() {
	const { id } = useParams<{ id: string }>();
	const { data, isLoading, error } = useReport(id);
	// 封面任务状态（弹框关闭后任务仍在后台跑，卡片上持续可见"生成中"）
	const { data: activeTaskData } = useActiveTask(id);

	const [activeId, setActiveId] = useState<string>('');
	const [coverOpen, setCoverOpen] = useState(false);
	const [pdfLoading, setPdfLoading] = useState(false);

	// 渲染 markdown → sanitize → 注入 anchor + 抽取 TOC（单次计算）
	const { cleanHtml, toc } = useMemo(() => {
		if (!data?.report?.trim()) return { cleanHtml: '', toc: [] };
		configureMarked();
		const normalized = normalizeReportMarkdown(data.report);
		const rendered = marked.parse(normalized, { async: false }) as string;
		const noDisclaimer = stripDisclaimerHtml(rendered);
		const sanitized = DOMPurify.sanitize(noDisclaimer, {
			ADD_ATTR: ['target', 'id'],
		});
		const { html, toc } = addAnchors(sanitized);
		return { cleanHtml: html, toc };
	}, [data?.report]);

	// 初始化 activeId
	useEffect(() => {
		if (toc.length > 0) setActiveId(toc[0].id);
	}, [toc]);

	// 滚动联动 - 基于 scrollY 找当前最近标题
	useEffect(() => {
		if (!toc.length) return;
		let raf = 0;
		function update() {
			raf = 0;
			const sections = toc
				.map((item) => document.getElementById(item.id))
				.filter((el): el is HTMLElement => !!el);
			if (!sections.length) return;
			const offset = 140;
			const scrollY = window.scrollY + offset;
			let currentId = sections[0].id;
			for (const s of sections) {
				if (s.offsetTop <= scrollY) {
					currentId = s.id;
				} else {
					break;
				}
			}
			setActiveId(currentId);
		}
		function onScroll() {
			if (raf) return;
			raf = window.requestAnimationFrame(update);
		}
		update();
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onScroll);
		return () => {
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onScroll);
			if (raf) cancelAnimationFrame(raf);
		};
	}, [toc]);

	async function handleDownloadPdf() {
		if (!id || pdfLoading) return;
		setPdfLoading(true);
		toast.info('正在生成 PDF，请稍候…');
		try {
			const token = useAuthStore.getState().token;
			const res = await fetch(
				`${API_BASE_URL}/scripts/${id}/report/pdf`,
				{
					headers: token ? { Authorization: `Bearer ${token}` } : {},
				},
			);
			if (!res.ok) {
				throw new Error(`导出失败: ${res.status}`);
			}
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${displayTitle || 'report'}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
			toast.success('已导出 PDF');
		} catch (e) {
			console.error('[Report] PDF export failed:', e);
			toast.error(e, '导出 PDF 失败');
		} finally {
			setPdfLoading(false);
		}
	}

	if (isLoading) {
		return (
			<div
				className="p-10 text-center font-sans"
				style={{ color: '#66594C' }}
			>
				正在加载报告…
			</div>
		);
	}

	if (error || !data) {
		return (
			<div
				className="p-10 text-center font-sans"
				style={{ color: '#B8443C' }}
			>
				{error instanceof Error ? error.message : '报告加载失败'}
				<div className="mt-4">
					<Link
						to="/history"
						className="font-sans text-sm underline"
						style={{ color: '#98352F' }}
					>
						返回历史列表
					</Link>
				</div>
			</div>
		);
	}

	const { script, version } = data;
	const scoreDetails = version.scoreDetails ?? null;
	const dateText = new Date(script.createdAt).toLocaleString('zh-CN', {
		hour12: false,
	});
	const durationSec = scoreDetails?.durationMs
		? (scoreDetails.durationMs / 1000).toFixed(1)
		: '—';
	const displayTitle = script.title || '未命名剧本';
	const fileName = script.fileName ?? `${script.title}.txt`;
	const score = scoreDetails?.score;
	const grade = scoreDetails?.grade;
	const hasScore = typeof score === 'number' && score > 0;
	const color = gradeColor(grade);

	// 封面三态：已选定 coverUrl > 候选待选定（coverUrlCandidates 非空）> 完全未生成
	// 叠加"生成中"态：coverTask running/pending 时卡片显示进度徽章，完成后自动切换待选定
	const coverCandidates = script.coverUrlCandidates ?? [];
	const hasCover = Boolean(script.coverUrl);
	const hasPendingCandidates = !hasCover && coverCandidates.length > 0;
	const coverTaskStatus = activeTaskData?.coverTask?.status;
	const isCoverGenerating =
		coverTaskStatus === 'running' || coverTaskStatus === 'pending';
	// 报告页预览图：已选定用选定值，否则用第一张候选（让用户立刻看到生成结果）
	const previewCoverUrl = script.coverUrl ?? coverCandidates[0];

	function handleTocClick(e: React.MouseEvent, item: TocItem) {
		e.preventDefault();
		const el = document.getElementById(item.id);
		if (el) {
			el.scrollIntoView({ behavior: 'smooth', block: 'start' });
			setActiveId(item.id);
		}
	}

	return (
		<div
			style={{
				padding: '24px 24px 32px',
				position: 'relative',
				zIndex: 1,
			}}
		>
			<PageBackground decorLevel="L2" />
			<div
				className="mx-auto w-full max-w-[1480px]"
				style={{
					display: 'flex',
					flexDirection: 'column',
					gap: '20px',
					position: 'relative',
					zIndex: 1,
				}}
			>
				{/* ========== 流程状态引导条（sticky 顶部）========== */}
				<PipelineStatusBar
					variant="full"
					scriptId={id!}
					onExportClick={handleDownloadPdf}
					onCoverClick={() => setCoverOpen((v) => !v)}
					coverOpen={coverOpen}
					exportLoading={pdfLoading}
				/>

				{/* ========== 封面生成区块（点击 Hero「生成封面」按钮展开）========== */}
				<CoverGenerator
					scriptId={id!}
					title={displayTitle}
					initialCoverUrl={script.coverUrl}
					initialCandidates={script.coverUrlCandidates}
					open={coverOpen}
					onClose={() => setCoverOpen(false)}
				/>

				{/* ========== Hero panel（始终显示）========== */}
				<section
					className="panel-paper"
					style={{ padding: '36px 40px' }}
				>
					<div
						style={{
							paddingBottom: 28,
							marginBottom: 28,
							borderBottom: '1px solid rgba(102,89,76,0.10)',
						}}
					>
						<div className="eyebrow mb-4">报告输出</div>
						<div
							className="mb-6 grid items-start"
							style={{
								gridTemplateColumns: '240px minmax(0, 1fr)',
								gap: '32px',
							}}
						>
							{/* 剧本封面卡（点击调出 CoverGenerator 选/换封面） */}
							<button
								type="button"
								onClick={() => setCoverOpen(true)}
								aria-label={
									isCoverGenerating
										? '封面生成中'
										: hasCover
											? '更换封面'
											: hasPendingCandidates
												? `查看已生成的 ${coverCandidates.length} 张候选封面`
												: '生成封面'
								}
								title={
									isCoverGenerating
										? '封面生成中，完成后可在此挑选'
										: hasCover
											? '点击更换封面'
											: hasPendingCandidates
												? '点击查看并选定封面'
												: '点击生成封面'
								}
								style={{
									flex: '0 0 auto',
									width: 240,
									padding: 0,
									border: '1px solid rgba(102,89,76,0.16)',
									borderRadius: 14,
									overflow: 'hidden',
									background: 'transparent',
									cursor: 'pointer',
									transition: 'all 240ms cubic-bezier(0.22,1,0.36,1)',
									boxShadow: '0 6px 18px rgba(102,89,76,0.08)',
								}}
								onMouseEnter={(e) => {
									e.currentTarget.style.transform = 'translateY(-2px)';
									e.currentTarget.style.boxShadow =
										'0 10px 26px rgba(184,68,60,0.16)';
								}}
								onMouseLeave={(e) => {
									e.currentTarget.style.transform = 'translateY(0)';
									e.currentTarget.style.boxShadow =
										'0 6px 18px rgba(102,89,76,0.08)';
								}}
							>
								<div
									style={{
										position: 'relative',
										aspectRatio: '3 / 4',
										background: previewCoverUrl
											? '#1C1815'
											: 'linear-gradient(135deg, rgba(102,89,76,0.08) 0%, rgba(184,68,60,0.05) 100%)',
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'center',
									}}
								>
									{previewCoverUrl ? (
										<img
											src={previewCoverUrl}
											alt={displayTitle}
											onError={(e) => {
												const img = e.currentTarget;
												const fallback = '/drama-cover-default.svg';
												if (img.src.endsWith(fallback)) return;
												img.src = fallback;
											}}
											style={{
												width: '100%',
												height: '100%',
												objectFit: 'cover',
											}}
										/>
									) : (
										<div
											style={{
												display: 'flex',
												flexDirection: 'column',
												alignItems: 'center',
												gap: 6,
												color: '#A89A8A',
											}}
										>
											{isCoverGenerating ? (
												<>
													<span
														aria-hidden
														style={{
															width: 22,
															height: 22,
															borderRadius: '50%',
															border: '2px solid rgba(184,68,60,0.25)',
															borderTopColor: '#B8443C',
															animation: 'spin 0.8s linear infinite',
														}}
													/>
													<span
														className="font-sans animate-pulse"
														style={{ fontSize: 11 }}
													>
														封面生成中…
													</span>
												</>
											) : (
												<>
													<span style={{ fontSize: 24, lineHeight: 1 }}>+</span>
													<span className="font-sans" style={{ fontSize: 11 }}>
														生成封面
													</span>
												</>
											)}
										</div>
									)}
									{/* 生成中徽章：coverTask 后台运行时持续提示，完成后被待选定徽章接管 */}
									{isCoverGenerating && (
										<div
											className="font-sans animate-pulse"
											style={{
												position: 'absolute',
												top: 10,
												left: 10,
												display: 'inline-flex',
												alignItems: 'center',
												gap: 5,
												padding: '4px 9px',
												borderRadius: 999,
												background: 'rgba(184,68,60,0.92)',
												color: '#FFFBF5',
												fontSize: 10,
												fontWeight: 600,
												letterSpacing: '0.04em',
												boxShadow: '0 4px 12px rgba(184,68,60,0.32)',
												backdropFilter: 'blur(4px)',
											}}
										>
											<span
												aria-hidden
												style={{
													width: 6,
													height: 6,
													borderRadius: '50%',
													background: '#FFFBF5',
													boxShadow: '0 0 0 3px rgba(255,251,245,0.24)',
												}}
											/>
											封面生成中…
										</div>
									)}
									{/* 候选待选定徽章：coverUrl 为空但已生成候选时提示用户 */}
									{hasPendingCandidates && (
										<div
											className="font-sans"
											style={{
												position: 'absolute',
												top: 10,
												left: 10,
												display: 'inline-flex',
												alignItems: 'center',
												gap: 5,
												padding: '4px 9px',
												borderRadius: 999,
												background: 'rgba(184,68,60,0.92)',
												color: '#FFFBF5',
												fontSize: 10,
												fontWeight: 600,
												letterSpacing: '0.04em',
												boxShadow: '0 4px 12px rgba(184,68,60,0.32)',
												backdropFilter: 'blur(4px)',
											}}
										>
											<span
												aria-hidden
												style={{
													width: 6,
													height: 6,
													borderRadius: '50%',
													background: '#FFFBF5',
													boxShadow: '0 0 0 3px rgba(255,251,245,0.24)',
												}}
											/>
											已生成 {coverCandidates.length} 张 · 待选定
										</div>
									)}
									{/* 底部 hover 提示条 */}
									<div
										style={{
											position: 'absolute',
											left: 0,
											right: 0,
											bottom: 0,
											padding: '14px 8px 6px',
											background:
												'linear-gradient(180deg, rgba(28,24,21,0) 0%, rgba(28,24,21,0.6) 100%)',
											color: '#FFFBF5',
											fontSize: 10,
											textAlign: 'center',
											letterSpacing: '0.04em',
											opacity: 0.85,
										}}
										className="font-sans"
									>
										{hasCover
											? '点击更换'
											: hasPendingCandidates
												? '点击查看并选定'
												: '点击生成'}
									</div>
								</div>
							</button>

							<div
								style={{
									display: 'flex',
									flexDirection: 'column',
									gap: 24,
									minWidth: 0,
								}}
							>
								<div>
									<h1
										className="font-serif font-bold"
										style={{
											fontSize: 'clamp(34px, 4.8vw, 58px)',
											lineHeight: 1.05,
											color: '#1C1815',
											marginBottom: '10px',
											letterSpacing: '-0.02em',
										}}
									>
										{displayTitle}
									</h1>
									<div
										className="mb-4 font-serif text-xl"
										style={{ color: '#B8443C' }}
									>
										短剧商业潜力评估报告
									</div>
									<div
										className="font-sans text-sm"
										style={{ color: '#66594C', lineHeight: 1.8 }}
									>
										由高阶算法生成，包含总体评分、结构判断、市场定位与可执行优化建议。
									</div>
								</div>

								{hasScore && (
									<div
										style={{
											position: 'relative',
											width: '100%',
											padding: '24px 28px',
											borderRadius: '22px',
											background:
												'linear-gradient(160deg, rgba(255,255,255,0.94) 0%, rgba(255,250,246,0.78) 100%)',
											border: `1px solid ${color}22`,
											boxShadow: `0 12px 32px rgba(102,89,76,0.08), 0 1px 0 rgba(255,255,255,0.6) inset`,
											overflow: 'hidden',
											isolation: 'isolate',
											display: 'flex',
											alignItems: 'center',
											justifyContent: 'space-between',
											gap: 24,
										}}
									>
										{/* 顶部色带 */}
										<span
											aria-hidden
											style={{
												position: 'absolute',
												top: 0,
												left: 0,
												right: 0,
												height: 3,
												background: `linear-gradient(90deg, ${color} 0%, ${color}88 60%, transparent 100%)`,
											}}
										/>
										{/* 装饰性大字水印（grade 首字） */}
										<span
											aria-hidden
											style={{
												position: 'absolute',
												right: -18,
												bottom: -34,
												fontFamily:
													'var(--font-serif, Georgia, serif)',
												fontSize: '160px',
												fontWeight: 800,
												lineHeight: 1,
												color: `${color}0D`,
												letterSpacing: '-0.08em',
												pointerEvents: 'none',
												userSelect: 'none',
												zIndex: 0,
											}}
										>
											{String(grade ?? '').charAt(0)}
										</span>

										{/* 左：综合评分 + 大分数 */}
										<div style={{ position: 'relative', zIndex: 1 }}>
											<div
												className="font-sans text-[11px] uppercase"
												style={{
													color: '#8B7B6A',
													marginBottom: '8px',
													letterSpacing: '0.18em',
													fontWeight: 600,
												}}
											>
												综合评分
											</div>
											<div
												style={{
													display: 'flex',
													alignItems: 'flex-end',
													gap: 6,
												}}
											>
												<div
													className="font-mono font-bold leading-none"
													style={{
														fontSize: 'clamp(56px, 8vw, 80px)',
														color: color,
														letterSpacing: '-0.06em',
														fontVariantNumeric: 'tabular-nums',
														textShadow: `0 2px 0 ${color}10`,
													}}
												>
													{score}
												</div>
												<div
													className="pb-3 font-sans"
													style={{
														color: '#A89A8A',
														fontSize: 15,
														fontWeight: 500,
														letterSpacing: '0.02em',
													}}
												>
													/ 100
												</div>
											</div>
										</div>

										{/* 右：grade 徽章 + 等级说明 */}
										<div
											style={{
												position: 'relative',
												zIndex: 1,
												display: 'flex',
												flexDirection: 'column',
												alignItems: 'flex-end',
												gap: 8,
											}}
										>
											<div
												style={{
													display: 'inline-flex',
													alignItems: 'center',
													gap: 8,
													padding: '8px 16px 8px 12px',
													borderRadius: '999px',
													color,
													border: `1px solid ${color}40`,
													background: `${color}12`,
													boxShadow: `0 1px 0 ${color}10 inset`,
												}}
											>
												<span
													aria-hidden
													style={{
														width: 8,
														height: 8,
														borderRadius: '50%',
														background: color,
														boxShadow: `0 0 0 3px ${color}25`,
													}}
												/>
												<span
													className="font-serif"
													style={{
														fontSize: 22,
														fontWeight: 700,
														letterSpacing: '0.02em',
													}}
												>
													{grade}
												</span>
											</div>
											<div
												className="font-sans text-[11px]"
												style={{
													color: '#8B7B6A',
													letterSpacing: '0.04em',
												}}
											>
												商业潜力等级
											</div>
										</div>
									</div>
								)}
							</div>
						</div>

						<div className="grid gap-3 md:grid-cols-4">
							<MetaCard label="剧本名称" value={displayTitle} />
							<MetaCard label="分析耗时" value={`${durationSec}s`} />
							<MetaCard
								label="结果等级"
								value={grade ?? '未评级'}
							/>
							<MetaCard label="报告 ID" value={version.id} />
						</div>
					</div>
				</section>

				{/* ========== 主体（报告 + 右侧 TOC）========== */}
				<div
					className="grid gap-6 grid-cols-1 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,320px)]"
				>
					<section className="panel" style={{ padding: '28px' }}>
						<article
							className="report-body"
							dangerouslySetInnerHTML={{ __html: cleanHtml }}
						/>

						<div
							className="mt-16 rounded-[16px] px-5 py-4 text-center"
							style={{
								border: '1px solid rgba(184,68,60,0.14)',
								background: 'rgba(184,68,60,0.04)',
							}}
						>
							<p
								className="font-serif italic"
								style={{ color: '#B8443C', fontSize: '15px' }}
							>
								本报告由 AI 生成，仅供创作参考。结论可能存在偏差，请结合专业判断使用。
							</p>
						</div>
					</section>

					{/* 右侧 TOC + 分析信息 */}
					<aside
						className="grid gap-4 self-start"
						style={{
							position: 'sticky',
							top: '24px',
							alignContent: 'start',
						}}
					>
						<div className="panel" style={{ padding: '22px' }}>
							<div className="eyebrow mb-2">报告摘要</div>
							<div
								className="font-serif text-2xl font-bold"
								style={{ color: '#1C1815' }}
							>
								报告导航
							</div>
							<nav className="mt-4 flex flex-col">
								{toc.length === 0 ? (
									<div
										className="font-sans text-xs"
										style={{ color: '#8B7B6A' }}
									>
										报告无可用标题
									</div>
								) : (
									toc.map((item, index) => (
										<a
											key={item.id}
											href={`#${item.id}`}
											onClick={(e) => handleTocClick(e, item)}
											style={{
												display: 'flex',
												alignItems: 'baseline',
												gap: 8,
												padding: '8px 2px',
												color:
													activeId === item.id
														? '#B8443C'
														: '#66594C',
												fontSize: '13px',
												lineHeight: 1.6,
											}}
										>
											<span
												style={{
													flex: '0 0 auto',
													minWidth: 20,
													textAlign: 'right',
													color:
														activeId === item.id
															? '#B8443C'
															: '#A89A8A',
													fontVariantNumeric:
														'tabular-nums',
												}}
											>
												{index + 1}.
											</span>
											<span style={{ flex: 1 }}>
												{item.text}
											</span>
										</a>
									))
								)}
							</nav>
						</div>

						<div className="panel" style={{ padding: '22px' }}>
							<div className="eyebrow mb-2">知识库信息</div>
							<div
								className="font-serif text-2xl font-bold"
								style={{ color: '#1C1815' }}
							>
								分析信息
							</div>
							<div className="mt-5 grid gap-3">
								<MetaCard label="脚本文件" value={fileName} />
								<MetaCard label="剧本名称" value={displayTitle} />
								<MetaCard
									label="结果等级"
									value={grade ?? '未评级'}
								/>
							</div>
						</div>
					</aside>
				</div>
			</div>
		</div>
	);
}

function MetaCard({ label, value }: { label: string; value: string }) {
	return (
		<div
			style={{
				padding: '14px 16px',
				borderRadius: '14px',
				background: 'rgba(255,255,255,0.72)',
				border: '1px solid rgba(102,89,76,0.08)',
			}}
		>
			<div
				className="font-sans text-[11px]"
				style={{ color: '#8B7B6A', marginBottom: '8px' }}
			>
				{label}
			</div>
			<div
				className="font-sans text-sm"
				style={{
					color: '#1C1815',
					lineHeight: 1.6,
					wordBreak: 'break-word',
				}}
			>
				{value}
			</div>
		</div>
	);
}
