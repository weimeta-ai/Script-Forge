// 用户详情页（admin only）
// -----------------------------------------------------------------------------
// 结构：
//   顶部工具条（返回列表）→ Hero（用户名 + 状态/角色）→
//   统计卡（Token / 调用 / 报告 / 余额）→
//   基本信息（编辑 displayName/role/status/重置密码）→
//   积分（余额卡 + 调整 + 流水）→
//   配置区（LLM + 图片）→
//   调用流水表格
//
// 设计：
//   - 基本信息 + 积分 + 配置 + 流水 四块独立加载，互不阻塞
//   - 余额变更统一走 /admin/users/:id/credits/adjust，每笔都写流水
//   - LLM / 图片 配置表单参照 LLMConfig/ImageConfig 风格（apiKey 留空保留旧值）
//   - 复制模板：一键从全局 llm_settings/image_settings 复制
// -----------------------------------------------------------------------------

import {
	AlertCircle,
	ArrowLeft,
	BarChart3,
	Coins,
	Copy,
	Eye,
	EyeOff,
	Loader2,
	Plug,
	Plus,
	Save,
	Trash2,
	UserCog,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
	useAdminUserDetail,
	useUpdateUser,
} from '../../api/admin-users';
// 注意：下方 LLM / 图片配置区子组件也用到 useAdminUserDetail，
// 直接复用顶部 import 即可
import {
	useCopyTemplate,
	useTestUserImageConfig,
	useTestUserLlmConfig,
	useUpdateUserImageConfig,
	useUpdateUserLlmConfig,
} from '../../api/admin-user-config';
import { useUserUsageLogs } from '../../api/admin-usage';
import { useUserCreditTransactions } from '../../api/credit';
import { AppShell, type BarItem } from '../../components/shell';
import { slideUp, staggerContainer } from '../../lib/animations';
import { RequestError } from '../../lib/request';
import type {
	UpdateImageConfigInput,
} from '../../types/image-config';
import type {
	UpdateLlmConfigInput,
} from '../../types/llm-config';
import type {
	UsageLog,
	UsageLogType,
	UserRole,
	UserStatus,
} from '../../types/admin-user';
import type {
	CreditTransaction,
	CreditTxType,
} from '../../types/credit';
import { CreditAdjustDrawer } from './CreditAdjustDrawer';
import { UserPromptConfigSection } from './UserPromptConfigSection';
import { fmtCredits, fmtDelta, txDisplay } from '../../lib/credit-tx-display';
import styles from './UserDetail.module.css';

export default function UserDetail() {
	const { id = '' } = useParams<{ id: string }>();
	const navigate = useNavigate();

	const { data, isLoading, error } = useAdminUserDetail(id);

	const topItems: BarItem[] = [{ label: '管理', value: '用户详情' }];

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
						<span>返回用户列表</span>
					</button>
					<div className={styles.divider} />
					<span className={styles.breadcrumb}>用户详情</span>
				</div>
				<span className={styles.tag}>管理 · 用户详情</span>
			</div>

			{isLoading ? (
				<div className={styles.loadingRow}>
					<Loader2 className={styles.spinner} />
					<span>加载用户信息…</span>
				</div>
			) : error ? (
				<div className={styles.errorBox}>
					<AlertCircle className={styles.errorIcon} />
					<span>加载失败：{(error as RequestError).message}</span>
				</div>
			) : data ? (
				<motion.div
					variants={staggerContainer}
					initial="hidden"
					animate="show"
					className={styles.content}
				>
					{/* Hero */}
					<motion.div variants={slideUp} className={styles.hero}>
						<div className={styles.heroLeft}>
							<span className={styles.avatar}>
								{data.username[0]?.toUpperCase() ?? 'U'}
							</span>
							<div>
								<span className={styles.heroTag}>// 用户 · {data.id.slice(0, 8)}</span>
								<h1 className={styles.heroTitle}>
									{data.displayName || data.username}
								</h1>
								<p className={styles.heroSubtitle}>@{data.username}</p>
							</div>
						</div>
						<div className={styles.heroBadges}>
							<span
								className={`${styles.badge} ${
									data.role === 'admin' ? styles.badgeAdmin : styles.badgeUser
								}`}
							>
								{data.role === 'admin' ? '管理员' : '用户'}
							</span>
							<span
								className={`${styles.badge} ${
									data.status === 'active' ? styles.badgeActive : styles.badgeDisabled
								}`}
							>
								{data.status === 'active' ? '启用' : '禁用'}
							</span>
						</div>
					</motion.div>

					{/* 统计卡 */}
					<motion.div variants={slideUp} className={styles.statsGrid}>
						<StatCard label="累计 Token" value={fmtNum(data.usage.totalTokens)} />
						<StatCard label="调用次数" value={fmtNum(data.usage.totalCalls)} />
						<StatCard
							label="最近活跃"
							value={
								data.usage.lastActiveAt ? fmtDate(data.usage.lastActiveAt) : '—'
							}
						/>
						<StatCard label="积分余额" value={fmtNum(data.creditBalance)} />
					</motion.div>

					{/* 基本信息 */}
					<motion.div variants={slideUp}>
						<BasicInfoSection user={data} />
					</motion.div>

					{/* 积分 */}
					<motion.div variants={slideUp}>
						<CreditSection userId={data.id} />
					</motion.div>

					{/* LLM 配置 */}
					<motion.div variants={slideUp}>
						{/* key 触发重挂载：复制模板 / 保存后表单 state 跟随最新 cfg 刷新 */}
						<LlmConfigSection
							key={`llm-${data.llmConfig?.updatedAt ?? 'init'}`}
							userId={data.id}
						/>
					</motion.div>

					{/* 图片配置 */}
					<motion.div variants={slideUp}>
						<ImageConfigSection
							key={`image-${data.imageConfig?.updatedAt ?? 'init'}`}
							userId={data.id}
						/>
					</motion.div>

					{/* 话术配置（按用户覆盖全局，未配置自动 fallback 全局） */}
					<motion.div variants={slideUp}>
						<UserPromptConfigSection userId={data.id} />
					</motion.div>

					{/* 调用流水 */}
					<motion.div variants={slideUp}>
						<UsageLogsSection userId={data.id} />
					</motion.div>
				</motion.div>
			) : null}
		</AppShell>
	);
}

// =============================================================================
// 统计卡
// =============================================================================
function StatCard({ label, value }: { label: string; value: string }) {
	return (
		<div className={styles.statCard}>
			<span className={styles.statLabel}>{label}</span>
			<span className={styles.statValue}>{value}</span>
		</div>
	);
}

// =============================================================================
// 基本信息编辑
// =============================================================================
function BasicInfoSection({
	user,
}: {
	user: {
		id: string;
		displayName: string;
		role: UserRole;
		status: UserStatus;
	};
}) {
	const [displayName, setDisplayName] = useState(user.displayName);
	const [role, setRole] = useState<UserRole>(user.role);
	const [status, setStatus] = useState<UserStatus>(user.status);
	const [password, setPassword] = useState('');

	const updateMutation = useUpdateUser(user.id);

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		updateMutation.mutate({
			displayName,
			role,
			status,
			password: password || undefined,
		});
	}

	return (
		<section className={styles.section}>
			<div className={styles.sectionHeader}>
				<div className={styles.sectionIcon}>
					<UserCog />
				</div>
				<div>
					<h2 className={styles.sectionTitle}>基本信息</h2>
					<p className={styles.sectionHint}>
						修改后立即生效；重置密码留空表示不修改。
					</p>
				</div>
			</div>

			<form className={styles.form} onSubmit={handleSubmit}>
				<label className={styles.field}>
					<span className={styles.label}>显示名</span>
					<input
						className={styles.input}
						value={displayName}
						onChange={(e) => setDisplayName(e.target.value)}
					/>
				</label>

				<div className={styles.fieldRow}>
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

					<label className={styles.field}>
						<span className={styles.label}>状态</span>
						<select
							className={styles.input}
							value={status}
							onChange={(e) => setStatus(e.target.value as UserStatus)}
						>
							<option value="active">启用</option>
							<option value="disabled">禁用</option>
						</select>
					</label>
				</div>

				<div className={styles.fieldRow}>
					<label className={styles.field}>
						<span className={styles.label}>重置密码（可选）</span>
						<input
							className={styles.input}
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							placeholder="留空不修改"
							autoComplete="new-password"
						/>
					</label>
				</div>

				{updateMutation.isError && (
					<div className={styles.errorBox}>
						<AlertCircle className={styles.errorIcon} />
						<span>保存失败：{(updateMutation.error as RequestError).message}</span>
					</div>
				)}
				{updateMutation.isSuccess && (
					<div className={styles.successBox}>✓ 已保存</div>
				)}

				<div className={styles.formActions}>
					<button
						type="submit"
						className={styles.primaryBtn}
						disabled={updateMutation.isPending}
					>
						{updateMutation.isPending ? (
							<Loader2 className={styles.spinner} />
						) : (
							<Save />
						)}
						<span>{updateMutation.isPending ? '保存中…' : '保存基本信息'}</span>
					</button>
				</div>
			</form>
		</section>
	);
}

// =============================================================================
// 积分模块（余额卡 + 调整 + 流水）
// =============================================================================
function CreditSection({ userId }: { userId: string }) {
	const [adjustOpen, setAdjustOpen] = useState(false);
	const [type, setType] = useState<CreditTxType | ''>('');
	const { data: userData } = useAdminUserDetail(userId);
	const { data, isLoading, error } = useUserCreditTransactions(userId, {
		type: type || undefined,
		pageSize: 20,
	});

	const balance = userData?.creditBalance ?? 0;
	const locked = userData?.creditLocked ?? 0;
	const available = balance - locked;

	return (
		<section className={styles.section}>
			<div className={styles.sectionHeader}>
				<div className={styles.sectionIcon}>
					<Coins />
				</div>
				<div>
					<h2 className={styles.sectionTitle}>积分</h2>
					<p className={styles.sectionHint}>
						余额变更统一走调配接口，每笔均写流水（含操作人）。可用 = 余额 - 锁定。
					</p>
				</div>
				<button
					type="button"
					className={styles.primaryBtn}
					onClick={() => setAdjustOpen(true)}
				>
					<Plus />
					<span>积分调配</span>
				</button>
			</div>

			<div className={styles.balanceGrid}>
				<div className={styles.balanceCard}>
					<span className={styles.balanceLabel}>余额</span>
					<span className={styles.balanceValue}>{fmtNum(balance)}</span>
				</div>
				<div className={styles.balanceCard}>
					<span className={styles.balanceLabel}>锁定</span>
					<span className={`${styles.balanceValue} ${styles.balanceValueLocked}`}>
						{fmtNum(locked)}
					</span>
				</div>
				<div className={styles.balanceCard}>
					<span className={styles.balanceLabel}>可用</span>
					<span className={`${styles.balanceValue} ${styles.balanceValueAvailable}`}>
						{fmtNum(available)}
					</span>
				</div>
			</div>

			<div className={styles.sectionHeader}>
				<h3 className={styles.sectionTitle} style={{ fontSize: 'var(--text-base)' }}>
					流水记录
				</h3>
				<select
					className={styles.filterSelect}
					value={type}
					onChange={(e) => setType(e.target.value as CreditTxType | '')}
				>
					<option value="">全部类型</option>
					<option value="recharge">后台充值</option>
					<option value="consume">剧本分析</option>
					<option value="refund">异常退款</option>
					<option value="deduct">人工扣减</option>
					<option value="compensate">人工补偿</option>
				</select>
			</div>

			{error && (
				<div className={styles.errorBox}>
					<AlertCircle className={styles.errorIcon} />
					<span>加载失败：{(error as RequestError).message}</span>
				</div>
			)}

			{isLoading ? (
				<div className={styles.loadingRow}>
					<Loader2 className={styles.spinner} />
					<span>加载流水…</span>
				</div>
			) : data && data.items.length > 0 ? (
				<table className={styles.table}>
					<thead>
						<tr>
							<th>时间</th>
							<th>类型</th>
							<th className={styles.numCol}>变化量</th>
							<th className={styles.numCol}>变化后余额</th>
							<th>关联任务</th>
							<th>备注</th>
							<th>操作人</th>
						</tr>
					</thead>
					<tbody>
						{data.items.map((tx: CreditTransaction) => {
							const display = txDisplay(tx.type);
							return (
								<tr key={tx.id}>
									<td className={styles.muted}>{fmtDateTime(tx.createdAt)}</td>
									<td>
										<span
											className={`${styles.badge} ${
												display.positive ? styles.badgeActive : styles.badgeDisabled
											}`}
										>
											{display.label}
										</span>
									</td>
									<td className={styles.numCol}>
										<span
											className={
												display.positive ? styles.deltaPositive : styles.deltaNegative
											}
										>
											{fmtDelta(tx.delta)}
										</span>
									</td>
									<td className={styles.numCol}>{fmtCredits(tx.balanceAfter)}</td>
									<td className={styles.muted}>
										{tx.refTaskId ? (
											<span className={styles.shortLink}>{tx.refTaskId.slice(0, 8)}</span>
										) : (
											'-'
										)}
									</td>
									<td className={styles.muted}>{tx.remark ?? '-'}</td>
									<td className={styles.muted}>
										{tx.operatedBy ? (
											<span className={styles.shortLink}>{tx.operatedBy.slice(0, 8)}</span>
										) : (
											'系统'
										)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			) : (
				<div className={styles.emptyRow}>暂无积分流水</div>
			)}

			<CreditAdjustDrawer
				userId={adjustOpen ? userId : null}
				open={adjustOpen}
				onClose={() => setAdjustOpen(false)}
			/>
		</section>
	);
}


// =============================================================================
// LLM 配置区
// =============================================================================
function LlmConfigSection({ userId }: { userId: string }) {
	const updateMutation = useUpdateUserLlmConfig(userId);
	const testMutation = useTestUserLlmConfig(userId);
	const copyMutation = useCopyTemplate(userId);

	// 直接用 detail data 中的 llmConfig 作为初值（避免再发一次请求）
	// 通过 useAdminUserDetail 复用详情页缓存的 llmConfig
	const { data } = useAdminUserDetail(userId);
	const cfg = data?.llmConfig;

	const [name, setName] = useState(cfg?.name ?? 'default');
	const [baseUrl, setBaseUrl] = useState(cfg?.baseUrl ?? '');
	const [model, setModel] = useState(cfg?.model ?? '');
	const [timeoutMs, setTimeoutMs] = useState(cfg?.timeoutMs ?? 90000);
	const [defaultAnalyzeMode, setDefaultAnalyzeMode] = useState<
		'standard' | 'fast' | 'ultra'
	>(cfg?.defaultAnalyzeMode ?? 'standard');
	const [apiKey, setApiKey] = useState('');
	const [showKey, setShowKey] = useState(false);
	const [testResult, setTestResult] = useState<string | null>(null);

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setTestResult(null);
		const input: UpdateLlmConfigInput = {
			name,
			apiKey: apiKey || undefined,
			model,
			baseUrl,
			timeoutMs,
			defaultAnalyzeMode,
		};
		updateMutation.mutate(input);
	}

	async function handleTest() {
		setTestResult(null);
		try {
			const r = await testMutation.mutateAsync({
				apiKey: apiKey || undefined,
				model: model || undefined,
				baseUrl: baseUrl || undefined,
			});
			setTestResult(`连接成功，延时 ${r.latencyMs}ms，模型回显 ${r.modelEcho}`);
		} catch (e) {
			setTestResult(`连接失败：${(e as RequestError).message}`);
		}
	}

	async function handleCopy() {
		setTestResult(null);
		try {
			await copyMutation.mutateAsync({ llm: true, image: false });
			setTestResult('✓ 已从全局模板复制 LLM 配置');
		} catch (e) {
			setTestResult(`复制失败：${(e as RequestError).message}`);
		}
	}

	return (
		<section className={styles.section}>
			<div className={styles.sectionHeader}>
				<div className={styles.sectionIcon}>
					<BarChart3 />
				</div>
				<div>
					<h2 className={styles.sectionTitle}>LLM 配置</h2>
					<p className={styles.sectionHint}>
						该用户提交分析 / 封面生成任务时使用。当前 Key：{' '}
						<code className={styles.codeInline}>
							{cfg?.apiKeyMasked ?? '（未配置）'}
						</code>
					</p>
				</div>
			</div>

			<form className={styles.form} onSubmit={handleSubmit}>
				<div className={styles.fieldRow}>
					<label className={styles.field}>
						<span className={styles.label}>配置名称</span>
						<input
							className={styles.input}
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
					</label>
					<label className={styles.field}>
						<span className={styles.label}>默认模型</span>
						<input
							className={styles.input}
							value={model}
							onChange={(e) => setModel(e.target.value)}
							placeholder="如 claude-sonnet-4-5-20250929"
						/>
					</label>
				</div>

				<label className={styles.field}>
					<span className={styles.label}>服务地址</span>
					<input
						className={styles.input}
						value={baseUrl}
						onChange={(e) => setBaseUrl(e.target.value)}
						placeholder="https://your-newapi/v1"
					/>
				</label>

				<div className={styles.fieldRow}>
					<label className={styles.field}>
						<span className={styles.label}>API 密钥</span>
						<div className={styles.apiKeyRow}>
							<input
								className={styles.input}
								type={showKey ? 'text' : 'password'}
								value={apiKey}
								onChange={(e) => setApiKey(e.target.value)}
								placeholder={`留空保留当前值（${cfg?.apiKeyMasked ?? '未配置'}）`}
								autoComplete="off"
							/>
							<button
								type="button"
								className={styles.eyeBtn}
								onClick={() => setShowKey((v) => !v)}
							>
								{showKey ? <EyeOff /> : <Eye />}
							</button>
						</div>
					</label>
					<label className={styles.field}>
						<span className={styles.label}>超时（毫秒）</span>
						<input
							className={styles.input}
							type="number"
							value={timeoutMs}
							onChange={(e) => setTimeoutMs(Number(e.target.value) || 90000)}
							min={5000}
							max={300000}
							step={1000}
						/>
					</label>
				</div>

				<label className={styles.field}>
					<span className={styles.label}>默认分析模式</span>
					<select
						className={styles.input}
						value={defaultAnalyzeMode}
						onChange={(e) =>
							setDefaultAnalyzeMode(e.target.value as 'standard' | 'fast' | 'ultra')
						}
					>
						<option value="standard">标准（8 节点串行）</option>
						<option value="fast">快速（8 节点并行）</option>
						<option value="ultra">极速（单次合成）</option>
					</select>
				</label>

				{updateMutation.isError && (
					<div className={styles.errorBox}>
						<AlertCircle className={styles.errorIcon} />
						<span>保存失败：{(updateMutation.error as RequestError).message}</span>
					</div>
				)}
				{updateMutation.isSuccess && (
					<div className={styles.successBox}>✓ LLM 配置已保存</div>
				)}
				{testResult && (
					<div
						className={
							testResult.startsWith('连接成功') || testResult.startsWith('✓')
								? styles.successBox
								: styles.errorBox
						}
					>
						{testResult}
					</div>
				)}

				<div className={styles.formActions}>
					<button
						type="button"
						className={styles.ghostBtn}
						onClick={handleCopy}
						disabled={copyMutation.isPending}
					>
						{copyMutation.isPending ? (
							<Loader2 className={styles.spinner} />
						) : (
							<Copy />
						)}
						<span>从全局模板复制</span>
					</button>
					<button
						type="button"
						className={styles.ghostBtn}
						onClick={handleTest}
						disabled={testMutation.isPending}
					>
						{testMutation.isPending ? (
							<Loader2 className={styles.spinner} />
						) : (
							<Plug />
						)}
						<span>测试连接</span>
					</button>
					<button
						type="submit"
						className={styles.primaryBtn}
						disabled={updateMutation.isPending}
					>
						{updateMutation.isPending ? (
							<Loader2 className={styles.spinner} />
						) : (
							<Save />
						)}
						<span>保存 LLM 配置</span>
					</button>
				</div>
			</form>
		</section>
	);
}

// =============================================================================
// 图片配置区
// =============================================================================
function ImageConfigSection({ userId }: { userId: string }) {
	const updateMutation = useUpdateUserImageConfig(userId);
	const testMutation = useTestUserImageConfig(userId);
	const copyMutation = useCopyTemplate(userId);

	const { data } = useAdminUserDetail(userId);
	const cfg = data?.imageConfig;

	const [name, setName] = useState(cfg?.name ?? 'default');
	const [baseUrl, setBaseUrl] = useState(cfg?.baseUrl ?? '');
	const [model, setModel] = useState(cfg?.model ?? '');
	const [timeoutMs, setTimeoutMs] = useState(cfg?.timeoutMs ?? 120000);
	const [defaultSize, setDefaultSize] = useState(cfg?.defaultSize ?? '1024x1024');
	const [defaultCount, setDefaultCount] = useState(cfg?.defaultCount ?? 1);
	const [apiKey, setApiKey] = useState('');
	const [showKey, setShowKey] = useState(false);
	const [testResult, setTestResult] = useState<string | null>(null);

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setTestResult(null);
		const input: UpdateImageConfigInput = {
			name,
			apiKey: apiKey || undefined,
			model,
			baseUrl,
			timeoutMs,
			defaultSize,
			defaultCount,
		};
		updateMutation.mutate(input);
	}

	async function handleTest() {
		setTestResult(null);
		try {
			const r = await testMutation.mutateAsync({
				apiKey: apiKey || undefined,
				model: model || undefined,
				baseUrl: baseUrl || undefined,
			});
			setTestResult(`连接成功，延时 ${r.latencyMs}ms`);
		} catch (e) {
			setTestResult(`连接失败：${(e as RequestError).message}`);
		}
	}

	async function handleCopy() {
		setTestResult(null);
		try {
			await copyMutation.mutateAsync({ llm: false, image: true });
			setTestResult('✓ 已从全局模板复制图片配置');
		} catch (e) {
			setTestResult(`复制失败：${(e as RequestError).message}`);
		}
	}

	return (
		<section className={styles.section}>
			<div className={styles.sectionHeader}>
				<div className={styles.sectionIcon}>
					<Trash2 />
				</div>
				<div>
					<h2 className={styles.sectionTitle}>图片模型配置</h2>
					<p className={styles.sectionHint}>
						该用户封面生成时使用。当前 Key：{' '}
						<code className={styles.codeInline}>
							{cfg?.apiKeyMasked ?? '（未配置）'}
						</code>
					</p>
				</div>
			</div>

			<form className={styles.form} onSubmit={handleSubmit}>
				<div className={styles.fieldRow}>
					<label className={styles.field}>
						<span className={styles.label}>配置名称</span>
						<input
							className={styles.input}
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
					</label>
					<label className={styles.field}>
						<span className={styles.label}>默认模型</span>
						<input
							className={styles.input}
							value={model}
							onChange={(e) => setModel(e.target.value)}
							placeholder="如 dall-e-3 / flux-pro"
						/>
					</label>
				</div>

				<label className={styles.field}>
					<span className={styles.label}>服务地址</span>
					<input
						className={styles.input}
						value={baseUrl}
						onChange={(e) => setBaseUrl(e.target.value)}
						placeholder="https://your-newapi/v1"
					/>
				</label>

				<div className={styles.fieldRow}>
					<label className={styles.field}>
						<span className={styles.label}>API 密钥</span>
						<div className={styles.apiKeyRow}>
							<input
								className={styles.input}
								type={showKey ? 'text' : 'password'}
								value={apiKey}
								onChange={(e) => setApiKey(e.target.value)}
								placeholder={`留空保留当前值（${cfg?.apiKeyMasked ?? '未配置'}）`}
								autoComplete="off"
							/>
							<button
								type="button"
								className={styles.eyeBtn}
								onClick={() => setShowKey((v) => !v)}
							>
								{showKey ? <EyeOff /> : <Eye />}
							</button>
						</div>
					</label>
					<label className={styles.field}>
						<span className={styles.label}>超时（毫秒）</span>
						<input
							className={styles.input}
							type="number"
							value={timeoutMs}
							onChange={(e) => setTimeoutMs(Number(e.target.value) || 120000)}
							min={5000}
							max={300000}
							step={1000}
						/>
					</label>
				</div>

				<div className={styles.fieldRow}>
					<label className={styles.field}>
						<span className={styles.label}>默认尺寸</span>
						<select
							className={styles.input}
							value={defaultSize}
							onChange={(e) => setDefaultSize(e.target.value)}
						>
							<option value="1024x1024">1024 × 1024（方形）</option>
							<option value="1792x1024">1792 × 1024（横屏）</option>
							<option value="1024x1792">1024 × 1792（竖屏）</option>
						</select>
					</label>
					<label className={styles.field}>
						<span className={styles.label}>默认数量</span>
						<input
							className={styles.input}
							type="number"
							value={defaultCount}
							onChange={(e) => setDefaultCount(Number(e.target.value) || 1)}
							min={1}
							max={4}
						/>
					</label>
				</div>

				{updateMutation.isError && (
					<div className={styles.errorBox}>
						<AlertCircle className={styles.errorIcon} />
						<span>保存失败：{(updateMutation.error as RequestError).message}</span>
					</div>
				)}
				{updateMutation.isSuccess && (
					<div className={styles.successBox}>✓ 图片配置已保存</div>
				)}
				{testResult && (
					<div
						className={
							testResult.startsWith('连接成功') || testResult.startsWith('✓')
								? styles.successBox
								: styles.errorBox
						}
					>
						{testResult}
					</div>
				)}

				<div className={styles.formActions}>
					<button
						type="button"
						className={styles.ghostBtn}
						onClick={handleCopy}
						disabled={copyMutation.isPending}
					>
						{copyMutation.isPending ? (
							<Loader2 className={styles.spinner} />
						) : (
							<Copy />
						)}
						<span>从全局模板复制</span>
					</button>
					<button
						type="button"
						className={styles.ghostBtn}
						onClick={handleTest}
						disabled={testMutation.isPending}
					>
						{testMutation.isPending ? (
							<Loader2 className={styles.spinner} />
						) : (
							<Plug />
						)}
						<span>测试连接</span>
					</button>
					<button
						type="submit"
						className={styles.primaryBtn}
						disabled={updateMutation.isPending}
					>
						{updateMutation.isPending ? (
							<Loader2 className={styles.spinner} />
						) : (
							<Save />
						)}
						<span>保存图片配置</span>
					</button>
				</div>
			</form>
		</section>
	);
}

// =============================================================================
// 调用流水
// =============================================================================
function UsageLogsSection({ userId }: { userId: string }) {
	const [type, setType] = useState<UsageLogType | ''>('');
	const { data, isLoading, error } = useUserUsageLogs(userId, {
		type: type || undefined,
		pageSize: 20,
	});

	return (
		<section className={styles.section}>
			<div className={styles.sectionHeader}>
				<div className={styles.sectionIcon}>
					<BarChart3 />
				</div>
				<div>
					<h2 className={styles.sectionTitle}>调用流水</h2>
					<p className={styles.sectionHint}>最近 20 条 LLM / 图片调用记录</p>
				</div>
				<select
					className={styles.filterSelect}
					value={type}
					onChange={(e) => setType(e.target.value as UsageLogType | '')}
				>
					<option value="">全部类型</option>
					<option value="llm">LLM</option>
					<option value="image">图片</option>
				</select>
			</div>

			{error && (
				<div className={styles.errorBox}>
					<AlertCircle className={styles.errorIcon} />
					<span>加载失败：{(error as RequestError).message}</span>
				</div>
			)}

			{isLoading ? (
				<div className={styles.loadingRow}>
					<Loader2 className={styles.spinner} />
					<span>加载流水…</span>
				</div>
			) : data && data.items.length > 0 ? (
				<table className={styles.table}>
					<thead>
						<tr>
							<th>时间</th>
							<th>类型</th>
							<th>阶段</th>
							<th>模型</th>
							<th className={styles.numCol}>Token</th>
							<th className={styles.numCol}>耗时</th>
							<th>状态</th>
							<th>错误码</th>
						</tr>
					</thead>
					<tbody>
						{data.items.map((log: UsageLog) => (
							<tr key={log.id}>
								<td className={styles.muted}>{fmtDateTime(log.createdAt)}</td>
								<td>
									<span
										className={`${styles.badge} ${
											log.type === 'llm' ? styles.badgeLlm : styles.badgeImage
										}`}
									>
										{log.type === 'llm' ? 'LLM' : '图片'}
									</span>
								</td>
								<td className={styles.muted}>{log.phase}</td>
								<td className={styles.muted}>{log.model ?? '—'}</td>
								<td className={styles.numCol}>
									{log.totalTokens ?? log.imageCount ?? '—'}
								</td>
								<td className={styles.numCol}>
									{log.latencyMs ? `${(log.latencyMs / 1000).toFixed(1)}s` : '—'}
								</td>
								<td>
									<span
										className={`${styles.badge} ${
											log.success ? styles.badgeActive : styles.badgeDisabled
										}`}
									>
										{log.success ? '成功' : '失败'}
									</span>
								</td>
								<td className={styles.muted}>{log.errorCode ?? '—'}</td>
							</tr>
						))}
					</tbody>
				</table>
			) : (
				<div className={styles.emptyRow}>暂无调用记录</div>
			)}
		</section>
	);
}

// =============================================================================
// 工具函数
// =============================================================================
function fmtNum(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
	return String(n);
}

function fmtDate(iso: string): string {
	const d = new Date(iso);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
		d.getDate(),
	).padStart(2, '0')}`;
}

function fmtDateTime(iso: string): string {
	const d = new Date(iso);
	return `${fmtDate(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(
		d.getMinutes(),
	).padStart(2, '0')}`;
}
