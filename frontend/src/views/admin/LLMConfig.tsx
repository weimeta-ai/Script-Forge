// LLM 配置页（admin only，运维调试用）
// -----------------------------------------------------------------------------
// 结构：
//   顶部导航 → Hero → 配置表单（含测试连接按钮）→ env 兜底信息
// 数据：
//   useLlmConfig()        读当前配置
//   useUpdateLlmConfig()  保存
//   useTestLlmConnection() 测试连接
// 设计原则：
//   - API Key 永远以脱敏形式展示（sk-1****cdef）
//   - 用户改了 Key 输入框才会提交新值；未改则保留 DB 已存的（避免清空）
//   - 测试连接可独立于保存（用户改了值先测试再保存）
//   - 表单状态隔离：用 key 触发子组件重挂载，避免 effect 内 setState（react-hooks 规则）
// -----------------------------------------------------------------------------

import {
	AlertCircle,
	ArrowLeft,
	CheckCircle2,
	Cpu,
	Eye,
	EyeOff,
	Loader2,
	Plug,
	Save,
	Settings2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
	useLlmConfig,
	useTestLlmConnection,
	useUpdateLlmConfig,
} from '../../api/llm-config';
import { AppShell, type BarItem } from '../../components/shell';
import { slideUp, staggerContainer } from '../../lib/animations';
import { RequestError } from '../../lib/request';
import type {
	AnalyzeMode,
	LlmApiFormat,
	LlmConfigResponse,
} from '../../types/llm-config';
import styles from './LLMConfig.module.css';

export default function LLMConfig() {
	const navigate = useNavigate();
	const { data, isLoading, isError, error, refetch } = useLlmConfig();

	const topItems: BarItem[] = [
		{ icon: Cpu, label: '管理', value: 'LLM 配置' },
	];

	return (
		<AppShell>
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
					<span className={styles.breadcrumb}>LLM 运行时配置</span>
				</div>
				<span className={styles.tag}>管理 · LLM 配置</span>
			</div>

			<motion.div
				variants={staggerContainer}
				initial="hidden"
				animate="show"
				className={styles.hero}
			>
				<motion.div variants={slideUp} className={styles.heroHeader}>
					<span className={styles.heroTag}>// 运行时 · 设置</span>
					<h1 className={styles.heroTitle}>
						LLM <span className={styles.heroGradient}>运行时配置</span>
					</h1>
					<p className={styles.heroSubtitle}>
						动态切换 newapi 网关或模型，无需重启后端。新配置对后续分析/封面任务生效（运行中的任务继续使用旧配置）。
					</p>
				</motion.div>
			</motion.div>

			{/* 表单区 */}
			{isLoading ? (
				<section className={styles.configSection}>
					<div className={styles.loadingRow}>
						<Loader2 className={styles.spinner} />
						<span>加载配置中…</span>
					</div>
				</section>
			) : isError || !data ? (
				<section className={styles.configSection}>
					<div className={styles.errorBox}>
						<AlertCircle className={styles.errorIcon} />
						<span>
							加载失败：
							{(error as RequestError | undefined)?.message ?? '未知错误'}
						</span>
						<button
							type="button"
							className={styles.testBtn}
							onClick={() => refetch()}
						>
							<span>重试</span>
						</button>
					</div>
				</section>
			) : (
				<LlmConfigForm
					key={data.current?.updatedAt ?? 'init'}
					data={data}
				/>
			)}

		</AppShell>
	);
}

// 内部表单组件：用 useState lazy initializer 接收 initial 值
// 父组件通过 key 变化触发重挂载 → state 重新初始化（避免 effect 内 setState）
function LlmConfigForm({ data }: { data: LlmConfigResponse }) {
	const cur = data.current;
	const updateMutation = useUpdateLlmConfig();
	const testMutation = useTestLlmConnection();

	// 用 lazy initializer：组件挂载时一次性读取 data，后续不再 effect 同步
	const [name, setName] = useState(cur?.name ?? 'default');
	const [apiFormat, setApiFormat] = useState<LlmApiFormat>(
		cur?.apiFormat ?? 'openai',
	);
	const [baseUrl, setBaseUrl] = useState(cur?.baseUrl ?? data.fallback.baseUrl ?? '');
	const [model, setModel] = useState(cur?.model ?? data.fallback.model ?? '');
	const [timeoutMs, setTimeoutMs] = useState(
		cur?.timeoutMs ?? data.fallback.timeoutMs ?? 90000,
	);
	const [defaultAnalyzeMode, setDefaultAnalyzeMode] = useState<AnalyzeMode>(
		cur?.defaultAnalyzeMode ?? 'standard',
	);
	const [apiKey, setApiKey] = useState(''); // 用户改 key 才填，否则留空表示保留旧值
	const [showApiKey, setShowApiKey] = useState(false);
	const [testResult, setTestResult] = useState<string | null>(null);

	const maskedKey = cur?.apiKeyMasked ?? '（未配置）';

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setTestResult(null);
		updateMutation.mutate({
			name,
			apiKey,
			model,
			baseUrl,
			apiFormat,
			timeoutMs,
			defaultAnalyzeMode,
		});
	}

	async function handleTest() {
		setTestResult(null);
		try {
			const result = await testMutation.mutateAsync({
				// 仅传用户已修改的字段，其余让后端用 DB/env 兜底
				apiKey: apiKey || undefined,
				model: model || undefined,
				baseUrl: baseUrl || undefined,
				apiFormat,
			});
			setTestResult(`连接成功，延时 ${result.latencyMs}ms，模型回显 ${result.modelEcho}`);
		} catch (e) {
			const err = e as RequestError;
			setTestResult(`连接失败：${err.message}`);
		}
	}

	const isSaving = updateMutation.isPending;
	const isTesting = testMutation.isPending;

	return (
		<section className={styles.configSection}>
			<div className={styles.sectionHeader}>
				<div className={styles.sectionIcon}>
					<Settings2 />
				</div>
				<div>
					<h2 className={styles.sectionTitle}>当前配置</h2>
					<p className={styles.sectionHint}>
						保存即写入数据库（UPSERT），全局生效。当前 Key：{' '}
						<code className={styles.codeInline}>{maskedKey}</code>
					</p>
				</div>
			</div>

			<form className={styles.form} onSubmit={handleSubmit}>
				{/* 配置名称 */}
				<label className={styles.field}>
					<span className={styles.label}>配置名称</span>
					<input
						className={styles.input}
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="如 newapi-test"
						maxLength={64}
					/>
				</label>

				{/* 服务地址 */}
				<label className={styles.field}>
					<span className={styles.label}>服务地址</span>
					<input
						className={styles.input}
						value={baseUrl}
						onChange={(e) => setBaseUrl(e.target.value)}
						placeholder={
							apiFormat === 'anthropic'
								? 'https://api.anthropic.com'
								: 'https://your-newapi/v1'
						}
						maxLength={512}
					/>
					<span className={styles.hint}>
						{apiFormat === 'anthropic'
							? 'Anthropic 原生接口地址，不带 /v1，如 https://api.anthropic.com'
							: 'OpenAI 兼容接口地址，newapi 网关通常以 /v1 结尾'}
					</span>
				</label>

				{/* API 格式（openai / anthropic 可选） */}
				<label className={styles.field}>
					<span className={styles.label}>API 格式</span>
					<select
						className={styles.input}
						value={apiFormat}
						onChange={(e) => setApiFormat(e.target.value as LlmApiFormat)}
					>
						<option value="openai">OpenAI 兼容（/v1/chat/completions）</option>
						<option value="anthropic">Anthropic 原生（/v1/messages）</option>
					</select>
					<span className={styles.hint}>
						{apiFormat === 'anthropic'
							? 'Anthropic 原生协议，服务地址不带 /v1（如 https://api.anthropic.com）'
							: 'OpenAI 兼容协议，绝大多数网关支持（newapi / DeepSeek 等）'}
					</span>
				</label>

				{/* API Key */}
				<div className={styles.field}>
					<span className={styles.label}>API 密钥</span>
					<div className={styles.apiKeyRow}>
						<input
							className={styles.input}
							type={showApiKey ? 'text' : 'password'}
							value={apiKey}
							onChange={(e) => setApiKey(e.target.value)}
							placeholder={`留空保留当前值（${maskedKey}）`}
							maxLength={512}
							autoComplete="off"
						/>
						<button
							type="button"
							className={styles.eyeBtn}
							onClick={() => setShowApiKey((v) => !v)}
							title={showApiKey ? '隐藏' : '显示'}
						>
							{showApiKey ? <EyeOff /> : <Eye />}
						</button>
					</div>
					<span className={styles.hint}>改了 Key 才需要填写；留空表示沿用已保存的值</span>
				</div>

				{/* 默认模型 */}
				<label className={styles.field}>
					<span className={styles.label}>默认模型</span>
					<input
						className={styles.input}
						value={model}
						onChange={(e) => setModel(e.target.value)}
						placeholder={
							apiFormat === 'anthropic'
								? '如 claude-sonnet-4-5-20250929'
								: '如 gpt-4 / deepseek-chat'
						}
						maxLength={128}
					/>
				</label>

				{/* 超时（毫秒） */}
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
					<span className={styles.hint}>范围 5000-300000，默认 90000（90 秒）</span>
				</label>

				{/* 默认分析模式 */}
				<label className={styles.field}>
					<span className={styles.label}>默认分析模式</span>
					<select
						className={styles.input}
						value={defaultAnalyzeMode}
						onChange={(e) =>
							setDefaultAnalyzeMode(e.target.value as AnalyzeMode)
						}
					>
						<option value="standard">标准（8 节点串行）</option>
						<option value="fast">快速（8 节点并行）</option>
						<option value="ultra">极速（单次合成）</option>
					</select>
					<span className={styles.hint}>
						用户在前端未显式选择时使用此默认值
					</span>
				</label>

				{/* 错误/成功提示 */}
				{updateMutation.isError && (
					<div className={styles.errorBox}>
						<AlertCircle className={styles.errorIcon} />
						<span>保存失败：{(updateMutation.error as RequestError).message}</span>
					</div>
				)}
				{updateMutation.isSuccess && (
					<div className={styles.successBox}>
						<CheckCircle2 className={styles.successIcon} />
						<span>保存成功，新任务将使用此配置</span>
					</div>
				)}

				{/* 测试结果 */}
				{testResult && (
					<div
						className={
							testResult.startsWith('连接成功') ? styles.successBox : styles.errorBox
						}
					>
						{testResult.startsWith('连接成功') ? (
							<CheckCircle2 className={styles.successIcon} />
						) : (
							<AlertCircle className={styles.errorIcon} />
						)}
						<span>{testResult}</span>
					</div>
				)}

				{/* 操作按钮 */}
				<div className={styles.formActions}>
					<button
						type="button"
						className={styles.testBtn}
						onClick={handleTest}
						disabled={isTesting || isSaving}
					>
						{isTesting ? <Loader2 className={styles.spinner} /> : <Plug />}
						<span>{isTesting ? '测试中…' : '测试连接'}</span>
					</button>
					<button type="submit" className={styles.submitBtn} disabled={isSaving || isTesting}>
						{isSaving ? <Loader2 className={styles.spinner} /> : <Save />}
						<span>{isSaving ? '保存中…' : '保存配置'}</span>
					</button>
				</div>
			</form>
		</section>
	);
}
