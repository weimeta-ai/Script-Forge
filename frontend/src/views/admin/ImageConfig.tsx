// 图片模型配置页（admin only）— 用于封面生成
// -----------------------------------------------------------------------------
// 结构：Sidebar → Hero → 配置表单（含测试连接按钮）→ env 兜底信息
// 字段：name / baseUrl / model / apiKey / timeoutMs / defaultSize / defaultCount
// 复用：与 LLMConfig 行为一致；样式 import LLMConfig.module.css（避免重复）
// -----------------------------------------------------------------------------

import {
	AlertCircle,
	ArrowLeft,
	CheckCircle2,
	Eye,
	EyeOff,
	Image as ImageIcon,
	Loader2,
	Plug,
	Save
} from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
	useImageConfig,
	useTestImageConnection,
	useUpdateImageConfig,
} from '../../api/image-config';
import { AppShell, type BarItem } from '../../components/shell';
import { slideUp, staggerContainer } from '../../lib/animations';
import { RequestError } from '../../lib/request';
import type { ImageConfigResponse } from '../../types/image-config';
import styles from './ImageConfig.module.css';

const SIZE_OPTIONS = ['1024x1024', '1024x1792', '1792x1024', '768x768'];

export default function ImageConfig() {
	const navigate = useNavigate();
	const { data, isLoading } = useImageConfig();

	const topItems: BarItem[] = [
		{ icon: ImageIcon, label: '管理', value: '图片模型' },
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
					<span className={styles.breadcrumb}>图片模型配置</span>
				</div>
				<span className={styles.adminTag}>管理 · 图片配置</span>
			</div>

			<motion.div
				variants={staggerContainer}
				initial="hidden"
				animate="show"
				className={styles.hero}
			>
				<motion.div variants={slideUp} className={styles.heroHeader}>
					<span className={styles.heroTag}>// 运行时 · 图片</span>
					<h1 className={styles.heroTitle}>
						<span className={styles.heroGradient}>图片模型配置</span>
					</h1>
					<p className={styles.heroSubtitle}>
						配置封面生成使用的图片模型。独立于 LLM 配置 — 用于报告导出前的封面自动生成。
						支持 OpenAI Images API 兼容接口（DALL·E / Stable Diffusion WebUI 等）。
					</p>
				</motion.div>
			</motion.div>

			{isLoading || !data ? (
				<section className={styles.configSection}>
					<div className={styles.loadingRow}>
						<Loader2 className={styles.spinner} />
						<span>加载配置中…</span>
					</div>
				</section>
			) : (
				<ImageConfigForm key={data.current?.updatedAt ?? 'init'} data={data} />
			)}


		</AppShell>
	);
}

/* ========== 表单子组件 ========== */
function ImageConfigForm({ data }: { data: ImageConfigResponse }) {
	const cur = data.current;
	const updateMutation = useUpdateImageConfig();
	const testMutation = useTestImageConnection();

	const [name, setName] = useState(cur?.name ?? 'default');
	const [baseUrl, setBaseUrl] = useState(cur?.baseUrl ?? data.fallback.baseUrl ?? '');
	const [model, setModel] = useState(cur?.model ?? data.fallback.model ?? '');
	const [timeoutMs, setTimeoutMs] = useState(cur?.timeoutMs ?? data.fallback.timeoutMs ?? 120000);
	const [defaultSize, setDefaultSize] = useState(cur?.defaultSize ?? '1024x1024');
	const [defaultCount, setDefaultCount] = useState(cur?.defaultCount ?? 1);
	const [apiKey, setApiKey] = useState('');
	const [showApiKey, setShowApiKey] = useState(false);
	const [testResult, setTestResult] = useState<string | null>(null);

	const maskedKey = cur?.apiKeyMasked ?? '（未配置）';

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setTestResult(null);
		updateMutation.mutate({
			name,
			apiKey: apiKey || undefined,
			model,
			baseUrl,
			timeoutMs,
			defaultSize,
			defaultCount,
		});
	}

	async function handleTest() {
		setTestResult(null);
		try {
			const result = await testMutation.mutateAsync({
				apiKey: apiKey || undefined,
				model: model || undefined,
				baseUrl: baseUrl || undefined,
			});
			setTestResult(`连接成功，延时 ${result.latencyMs}ms，模型回显 ${result.modelEcho}`);
		} catch (e) {
			const err = e as RequestError;
			setTestResult(`连接失败：${err.message}`);
		}
	}

	const isSaving = updateMutation.isPending;
	const isTesting = testMutation.isPending;
	const saveError = updateMutation.error;
	const saveSuccess = updateMutation.isSuccess;

	return (
		<motion.section
			variants={slideUp}
			initial="hidden"
			animate="show"
			className={styles.configSection}
		>
			<div className={styles.sectionHeader}>
				<div className={styles.sectionIcon}>
					<ImageIcon strokeWidth={2} />
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
				<label className={styles.field}>
					<span className={styles.fieldLabel}>配置名称</span>
					<input
						className={styles.input}
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="default"
						required
					/>
				</label>

				<label className={styles.field}>
					<span className={styles.fieldLabel}>基础地址</span>
					<input
						className={styles.input}
						value={baseUrl}
						onChange={(e) => setBaseUrl(e.target.value)}
						placeholder="https://api.openai.com/v1"
						required
					/>
				</label>

				<label className={styles.field}>
					<span className={styles.fieldLabel}>模型</span>
					<input
						className={styles.input}
						value={model}
						onChange={(e) => setModel(e.target.value)}
						placeholder="dall-e-3"
						required
					/>
					<span className={styles.fieldHint}>
						OpenAI 兼容接口的图片模型名，如 dall-e-3 / sd-xl / flux-pro
					</span>
				</label>

				<label className={styles.field}>
					<span className={styles.fieldLabel}>
						API 密钥
						<button
							type="button"
							className={styles.eyeBtn}
							onClick={() => setShowApiKey((v) => !v)}
							aria-label={showApiKey ? '隐藏' : '显示'}
						>
							{showApiKey ? <EyeOff strokeWidth={2} /> : <Eye strokeWidth={2} />}
						</button>
					</span>
					<input
						className={styles.input}
						type={showApiKey ? 'text' : 'password'}
						value={apiKey}
						onChange={(e) => setApiKey(e.target.value)}
						placeholder="留空表示保留已保存的 Key"
						autoComplete="off"
					/>
				</label>

				<div className={styles.fieldRow}>
					<label className={styles.field}>
						<span className={styles.fieldLabel}>默认尺寸</span>
						<select
							className={styles.input}
							value={defaultSize}
							onChange={(e) => setDefaultSize(e.target.value)}
						>
							{SIZE_OPTIONS.map((s) => (
								<option key={s} value={s}>
									{s}
								</option>
							))}
						</select>
					</label>

					<label className={styles.field}>
						<span className={styles.fieldLabel}>默认张数</span>
						<input
							className={styles.input}
							type="number"
							min={1}
							max={4}
							value={defaultCount}
							onChange={(e) => setDefaultCount(Number(e.target.value) || 1)}
						/>
					</label>

					<label className={styles.field}>
						<span className={styles.fieldLabel}>超时（ms）</span>
						<input
							className={styles.input}
							type="number"
							min={5000}
							step={1000}
							value={timeoutMs}
							onChange={(e) => setTimeoutMs(Number(e.target.value) || 120000)}
						/>
					</label>
				</div>

				{saveError && (
					<div className={styles.alertError}>
						<AlertCircle strokeWidth={2} />
						<span>{(saveError as RequestError).message}</span>
					</div>
				)}

				{saveSuccess && !saveError && (
					<div className={styles.alertSuccess}>
						<CheckCircle2 strokeWidth={2} />
						<span>配置已保存</span>
					</div>
				)}

				{testResult && (
					<div
						className={`${styles.alertBlock} ${testResult.startsWith('连接成功') ? styles.alertSuccess : styles.alertError}`}
					>
						{testResult.startsWith('连接成功') ? (
							<CheckCircle2 strokeWidth={2} />
						) : (
							<AlertCircle strokeWidth={2} />
						)}
						<span>{testResult}</span>
					</div>
				)}

				<div className={styles.actions}>
					<button
						type="button"
						className={styles.testBtn}
						onClick={handleTest}
						disabled={isTesting}
					>
						{isTesting ? <Loader2 className={styles.spinner} /> : <Plug strokeWidth={2} />}
						{isTesting ? '测试中…' : '测试连接'}
					</button>
					<button type="submit" className={styles.saveBtn} disabled={isSaving}>
						{isSaving ? <Loader2 className={styles.spinner} /> : <Save strokeWidth={2} />}
						{isSaving ? '保存中…' : '保存配置'}
					</button>
				</div>
			</form>
		</motion.section>
	);
}
