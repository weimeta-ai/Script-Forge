// Debug 日志抽屉（admin only，全局组合键 Cmd/Ctrl+Shift+L 触发）
// -----------------------------------------------------------------------------
// 功能：
//   - 从后端 GET /debug/logs 拉取最近 200 条日志
//   - 按 category 过滤（system/score/llm/report）
//   - 按 level 过滤（debug/info/warn/error）
//   - 自动 3 秒轮询，新日志高亮
//   - Esc 关闭抽屉
// -----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Activity, Filter, Loader2, Search } from 'lucide-react';
import { useRuntimeLogs } from '../api/debug';
import type { LogCategory, LogLevel, RuntimeLogEntry } from '../types/debug';
import styles from './DebugLogsDrawer.module.css';

interface DebugLogsDrawerProps {
	open: boolean;
	onClose: () => void;
}

const CATEGORY_OPTIONS: Array<{ key: LogCategory | 'all'; label: string }> = [
	{ key: 'all', label: '全部' },
	{ key: 'system', label: '系统' },
	{ key: 'score', label: '评分' },
	{ key: 'llm', label: 'LLM 调用' },
	{ key: 'report', label: '报告' },
];

const LEVEL_OPTIONS: Array<{ key: LogLevel | 'all'; label: string }> = [
	{ key: 'all', label: '全部级别' },
	{ key: 'error', label: '错误' },
	{ key: 'warn', label: '警告' },
	{ key: 'info', label: '信息' },
	{ key: 'debug', label: '调试' },
];

function formatTime(ts: number): string {
	const d = new Date(ts);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(
		d.getMilliseconds(),
	).padStart(3, '0')}`;
}

function formatMeta(meta?: Record<string, unknown>): string {
	if (!meta) return '';
	const entries = Object.entries(meta).slice(0, 8); // 限制 8 条避免过长
	return entries
		.map(([k, v]) => {
			const val = typeof v === 'string' ? v : JSON.stringify(v);
			const truncated = val.length > 120 ? `${val.slice(0, 120)}…` : val;
			return `${k}=${truncated}`;
		})
		.join('  ');
}

export function DebugLogsDrawer({ open, onClose }: DebugLogsDrawerProps) {
	const [categoryFilter, setCategoryFilter] = useState<LogCategory | 'all'>('all');
	const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all');
	const [keyword, setKeyword] = useState('');

	const { data, isLoading, isFetching } = useRuntimeLogs({ enabled: open });

	// Esc 关闭
	useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [open, onClose]);

	// 客户端过滤
	const filtered = useMemo(() => {
		const items = data?.items ?? [];
		return items.filter((item) => {
			if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
			if (levelFilter !== 'all' && item.level !== levelFilter) return false;
			if (keyword) {
				const text = `${item.message} ${JSON.stringify(item.meta ?? {})}`;
				if (!text.toLowerCase().includes(keyword.toLowerCase())) return false;
			}
			return true;
		});
	}, [data, categoryFilter, levelFilter, keyword]);

	return (
		<AnimatePresence>
			{open && (
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
									<Activity />
								</div>
								<div>
									<h2 className={styles.title}>运行时调试日志</h2>
									<p className={styles.subtitle}>
										{filtered.length} 条 · {isFetching ? '刷新中…' : '已同步'} ·{' '}
										<code className={styles.shortcutHint}>Cmd/Ctrl+Shift+L</code>
									</p>
								</div>
							</div>
							<button type="button" className={styles.closeBtn} onClick={onClose}>
								<X />
							</button>
						</header>

						{/* ========== 过滤栏 ========== */}
						<div className={styles.filterBar}>
							<div className={styles.filterRow}>
								<Filter className={styles.filterIcon} />
								<div className={styles.chipRow}>
									{CATEGORY_OPTIONS.map((opt) => (
										<button
											key={opt.key}
											type="button"
											className={`${styles.chip} ${
												categoryFilter === opt.key ? styles.chipActive : ''
											}`}
											onClick={() => setCategoryFilter(opt.key)}
										>
											{opt.label}
										</button>
									))}
								</div>
							</div>
							<div className={styles.filterRow}>
								<select
									className={styles.select}
									value={levelFilter}
									onChange={(e) => setLevelFilter(e.target.value as LogLevel | 'all')}
								>
									{LEVEL_OPTIONS.map((opt) => (
										<option key={opt.key} value={opt.key}>
											{opt.label}
										</option>
									))}
								</select>
								<div className={styles.searchRow}>
									<Search className={styles.searchIcon} />
									<input
										className={styles.searchInput}
										placeholder="搜索消息或 meta"
										value={keyword}
										onChange={(e) => setKeyword(e.target.value)}
									/>
								</div>
							</div>
						</div>

						{/* ========== 日志列表 ========== */}
						<div className={styles.logList}>
							{isLoading && (
								<div className={styles.loadingRow}>
									<Loader2 className={styles.spinner} />
									<span>加载中…</span>
								</div>
							)}
							{!isLoading && filtered.length === 0 && (
								<div className={styles.emptyRow}>
									<span>无匹配日志（{data?.items.length ?? 0} 条总量）</span>
								</div>
							)}
							{filtered.map((item) => (
								<LogRow key={item.id} item={item} />
							))}
						</div>
					</motion.aside>
				</>
			)}
		</AnimatePresence>
	);
}

function LogRow({ item }: { item: RuntimeLogEntry }) {
	const metaStr = formatMeta(item.meta);
	const levelClassMap: Record<LogLevel, string> = {
		error: styles.levelError,
		warn: styles.levelWarn,
		info: styles.levelInfo,
		debug: styles.levelDebug,
	};
	const levelBadgeMap: Record<LogLevel, string> = {
		error: styles.levelBadgeError,
		warn: styles.levelBadgeWarn,
		info: styles.levelBadgeInfo,
		debug: styles.levelBadgeDebug,
	};
	const catClassMap: Record<LogCategory, string> = {
		system: styles.catSystem,
		score: styles.catScore,
		llm: styles.catLlm,
		report: styles.catReport,
	};
	return (
		<div className={`${styles.logRow} ${levelClassMap[item.level] ?? ''}`}>
			<div className={styles.logHeader}>
				<span className={styles.logTime}>{formatTime(item.ts)}</span>
				<span className={`${styles.logLevel} ${levelBadgeMap[item.level] ?? ''}`}>
					{item.level.toUpperCase()}
				</span>
				<span className={`${styles.logCategory} ${catClassMap[item.category] ?? ''}`}>
					{item.category}
				</span>
				{item.dimensionKey && <span className={styles.logDim}>[{item.dimensionKey}]</span>}
			</div>
			<div className={styles.logMessage}>{item.message}</div>
			{metaStr && <div className={styles.logMeta}>{metaStr}</div>}
		</div>
	);
}
