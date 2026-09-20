// 用户管理列表页（admin only）
// -----------------------------------------------------------------------------
// 结构：
//   顶部工具条（返回 + 标题）→ Hero → 筛选 + 创建按钮 → 用户表格
// 数据：
//   useAdminUsersList(query) — 列表 + 统计聚合
//   useCreateUser()         — 创建对话框提交
// 设计：
//   - 筛选 keyword + role + status，URL 参数同步（暂未实现，先内部 state）
//   - 创建用户对话框：用户名/密码/角色 + 可选「复制模板配置」
// -----------------------------------------------------------------------------

import { AlertCircle, ArrowLeft, Coins, Loader2, Plus, Search, UserPlus, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAdminUsersList, useCreateUser } from '../../api/admin-users';
import { AppShell, type BarItem } from '../../components/shell';
import { slideUp, staggerContainer } from '../../lib/animations';
import { fmtCredits } from '../../lib/credit-tx-display';
import { RequestError } from '../../lib/request';
import type { UserListItem, UserRole, UserStatus } from '../../types/admin-user';
import styles from './Users.module.css';
import { CreditAdjustDrawer } from './CreditAdjustDrawer';

export default function Users() {
	const navigate = useNavigate();

	// 筛选 state
	const [keyword, setKeyword] = useState('');
	const [role, setRole] = useState<UserRole | ''>('');
	const [status, setStatus] = useState<UserStatus | ''>('');

	// 积分调配抽屉 state（保留列表和筛选状态，抽屉仅是覆盖层）
	const [adjustUserId, setAdjustUserId] = useState<string | null>(null);

	const { data, isLoading, error } = useAdminUsersList({
		keyword: keyword || undefined,
		role: role || undefined,
		status: status || undefined,
		pageSize: 50,
	});

	const topItems: BarItem[] = [{ label: '管理', value: '用户管理' }];

	return (
		<AppShell>
			{/* 页内工具条 */}
			<div className={styles.toolbar}>
				<div className={styles.toolbarLeft}>
					<button
						type="button"
						className={styles.backBtn}
						onClick={() => navigate('/upload')}
					>
						<ArrowLeft strokeWidth={2} />
						<span>返回工作区</span>
					</button>
					<div className={styles.divider} />
					<span className={styles.breadcrumb}>用户管理</span>
				</div>
				<span className={styles.tag}>管理 · 用户</span>
			</div>

			<motion.div
				variants={staggerContainer}
				initial="hidden"
				animate="show"
				className={styles.hero}
			>
				<motion.div variants={slideUp} className={styles.heroHeader}>
					<span className={styles.heroTag}>// 管理 · 用户</span>
					<h1 className={styles.heroTitle}>
						用户<span className={styles.heroGradient}>管理</span>
					</h1>
					<p className={styles.heroSubtitle}>
						管理用户账号、配置每用户独立的 LLM / 图片模型，实时查看 Token 消耗、调用次数与报告数。
					</p>
				</motion.div>
			</motion.div>

			{/* 筛选 + 创建按钮 */}
			<section className={styles.section}>
				<div className={styles.filterRow}>
					<div className={styles.searchWrap}>
						<Search className={styles.searchIcon} />
						<input
							className={styles.searchInput}
							placeholder="搜索用户名或显示名"
							value={keyword}
							onChange={(e) => setKeyword(e.target.value)}
						/>
						{keyword && (
							<button
								type="button"
								className={styles.clearBtn}
								onClick={() => setKeyword('')}
								aria-label="清空"
							>
								<X />
							</button>
						)}
					</div>

					<select
						className={styles.select}
						value={role}
						onChange={(e) => setRole(e.target.value as UserRole | '')}
					>
						<option value="">全部角色</option>
						<option value="admin">管理员</option>
						<option value="user">普通用户</option>
					</select>

					<select
						className={styles.select}
						value={status}
						onChange={(e) => setStatus(e.target.value as UserStatus | '')}
					>
						<option value="">全部状态</option>
						<option value="active">启用</option>
						<option value="disabled">禁用</option>
					</select>

					<div className={styles.filterSpacer} />

					<CreateUserButton />
				</div>

				{/* 错误 */}
				{error && (
					<div className={styles.errorBox}>
						<AlertCircle className={styles.errorIcon} />
						<span>加载失败：{(error as RequestError).message}</span>
					</div>
				)}

				{/* 表格 */}
				{isLoading ? (
					<div className={styles.loadingRow}>
						<Loader2 className={styles.spinner} />
						<span>加载用户列表…</span>
					</div>
				) : (
					<UserTable
						items={data?.items ?? []}
						total={data?.total ?? 0}
						onAdjust={(id) => setAdjustUserId(id)}
					/>
				)}
			</section>

			{/* 积分调配抽屉（保留列表和筛选 state，关闭后列表仍是最新筛选结果） */}
			<CreditAdjustDrawer
				userId={adjustUserId}
				open={!!adjustUserId}
				onClose={() => setAdjustUserId(null)}
			/>
		</AppShell>
	);
}

// =============================================================================
// 用户表格
// =============================================================================
function UserTable({
	items,
	total,
	onAdjust,
}: {
	items: UserListItem[];
	total: number;
	onAdjust: (userId: string) => void;
}) {
	if (items.length === 0) {
		return (
			<div className={styles.emptyRow}>
				<UserPlus strokeWidth={1.5} />
				<span>暂无用户，点击右上角「创建用户」开始</span>
			</div>
		);
	}

	return (
		<>
			<div className={styles.tableMeta}>共 {total} 个用户</div>
			<table className={styles.table}>
				<thead>
					<tr>
						<th>用户</th>
						<th>角色</th>
						<th>状态</th>
						<th className={styles.numCol}>积分余额</th>
						<th className={styles.numCol}>Token 累计</th>
						<th className={styles.numCol}>调用次数</th>
						<th className={styles.numCol}>报告数</th>
						<th>最近活跃</th>
						<th>操作</th>
					</tr>
				</thead>
				<tbody>
					{items.map((u) => {
						const lowBalance = u.creditBalance < 2000;
						return (
							<tr key={u.id}>
								<td>
									<Link to={`/admin/users/${u.id}`} className={styles.userCell}>
										<span className={styles.avatar}>
											{u.username[0]?.toUpperCase() ?? 'U'}
										</span>
										<span>
											<span className={styles.userName}>{u.displayName || u.username}</span>
											<span className={styles.userSub}>@{u.username}</span>
										</span>
									</Link>
								</td>
								<td>
									<span
										className={`${styles.badge} ${
											u.role === 'admin' ? styles.badgeAdmin : styles.badgeUser
										}`}
									>
										{u.role === 'admin' ? '管理员' : '用户'}
									</span>
								</td>
								<td>
									<span
										className={`${styles.badge} ${
											u.status === 'active' ? styles.badgeActive : styles.badgeDisabled
										}`}
									>
										{u.status === 'active' ? '启用' : '禁用'}
									</span>
								</td>
								<td className={styles.numCol}>
									<div className={styles.balanceCell}>
										<span className={lowBalance ? styles.balanceLow : ''}>
											{fmtCredits(u.creditBalance)}
										</span>
										{lowBalance && (
											<span className={styles.balanceWarnTag}>余额不足</span>
										)}
									</div>
								</td>
								<td className={styles.numCol}>{formatNumber(u.totalTokens)}</td>
								<td className={styles.numCol}>{formatNumber(u.totalCalls)}</td>
								<td className={styles.numCol}>{formatNumber(u.reportCount)}</td>
								<td className={styles.muted}>
									{u.lastActiveAt ? formatDate(u.lastActiveAt) : '-'}
								</td>
								<td>
									<button
										type="button"
										className={styles.adjustBtn}
										onClick={() => onAdjust(u.id)}
										title="积分调配"
									>
										<Coins strokeWidth={2} />
										<span>积分调配</span>
									</button>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</>
	);
}
function CreateUserButton() {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button
				type="button"
				className={styles.primaryBtn}
				onClick={() => setOpen(true)}
			>
				<Plus strokeWidth={2} />
				<span>创建用户</span>
			</button>
			{open && <CreateUserDialog onClose={() => setOpen(false)} />}
		</>
	);
}

function CreateUserDialog({ onClose }: { onClose: () => void }) {
	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const [displayName, setDisplayName] = useState('');
	const [role, setRole] = useState<UserRole>('user');
	const [copyTemplate, setCopyTemplate] = useState(true);
	const [errMsg, setErrMsg] = useState<string | null>(null);

	const createMutation = useCreateUser();

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setErrMsg(null);
		try {
			await createMutation.mutateAsync({
				username,
				password,
				displayName: displayName || undefined,
				role,
				copyTemplateConfig: copyTemplate,
			});
			onClose();
		} catch (e) {
			setErrMsg((e as RequestError).message);
		}
	}

	return (
		<div className={styles.modalBackdrop} onClick={onClose}>
			<div
				className={styles.modal}
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
			>
				<div className={styles.modalHeader}>
					<h2>创建用户</h2>
					<button type="button" className={styles.modalClose} onClick={onClose}>
						<X />
					</button>
				</div>

				<form className={styles.modalForm} onSubmit={handleSubmit}>
					<label className={styles.field}>
						<span className={styles.label}>用户名 *</span>
						<input
							className={styles.input}
							value={username}
							onChange={(e) => setUsername(e.target.value)}
							placeholder="登录用户名"
							required
							autoComplete="off"
						/>
					</label>

					<label className={styles.field}>
						<span className={styles.label}>密码 *</span>
						<input
							className={styles.input}
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							placeholder="至少 8 位，含字母和数字"
							required
							autoComplete="new-password"
						/>
					</label>

					<label className={styles.field}>
						<span className={styles.label}>显示名（可选）</span>
						<input
							className={styles.input}
							value={displayName}
							onChange={(e) => setDisplayName(e.target.value)}
							placeholder="留空则用用户名"
							autoComplete="off"
						/>
					</label>

					<label className={styles.field}>
						<span className={styles.label}>角色</span>
						<select
							className={styles.input}
							value={role}
							onChange={(e) => setRole(e.target.value as UserRole)}
						>
							<option value="user">普通用户</option>
							<option value="admin">管理员</option>
						</select>
					</label>

					<label className={styles.checkbox}>
						<input
							type="checkbox"
							checked={copyTemplate}
							onChange={(e) => setCopyTemplate(e.target.checked)}
						/>
						<span>复制全局 LLM / 图片模板到该用户（推荐）</span>
					</label>

					{errMsg && (
						<div className={styles.errorBox}>
							<AlertCircle className={styles.errorIcon} />
							<span>{errMsg}</span>
						</div>
					)}

					<div className={styles.modalActions}>
						<button type="button" className={styles.cancelBtn} onClick={onClose}>
							取消
						</button>
						<button
							type="submit"
							className={styles.submitBtn}
							disabled={createMutation.isPending}
						>
							{createMutation.isPending ? (
								<Loader2 className={styles.spinner} />
							) : (
								<Plus />
							)}
							<span>{createMutation.isPending ? '创建中…' : '创建'}</span>
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}

// =============================================================================
// 工具函数
// =============================================================================
function formatNumber(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
	return String(n);
}

function formatDate(iso: string): string {
	const d = new Date(iso);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	const hh = String(d.getHours()).padStart(2, '0');
	const mm = String(d.getMinutes()).padStart(2, '0');
	return `${y}-${m}-${day} ${hh}:${mm}`;
}
