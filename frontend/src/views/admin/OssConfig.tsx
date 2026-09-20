// 阿里云 OSS 图床配置页（admin only）— AI 生成图片持久化
// -----------------------------------------------------------------------------
// 结构：Sidebar → Hero → 配置表单（含测试连接按钮）→ URL 转存测试区域
// 字段：name / region / bucket / accessKeyId / accessKeySecret /
//       endpoint / customDomain / pathPrefix / timeoutMs
// 复用：与 ImageConfig 行为一致；样式 import ImageConfig.module.css（避免重复）
// -----------------------------------------------------------------------------

import {
	AlertCircle,
	ArrowLeft,
	CheckCircle2,
	Cloud,
	Eye,
	EyeOff,
	Loader2,
	Plug,
	Save,
	Upload,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
	useOssConfig,
	useTestOssConnection,
	useUpdateOssConfig,
	useUploadByUrl,
} from '../../api/oss-config';
import { AppShell, type BarItem } from '../../components/shell';
import { slideUp, staggerContainer } from '../../lib/animations';
import { RequestError } from '../../lib/request';
import type { OssConfigResponse } from '../../types/oss-config';
import styles from './ImageConfig.module.css';

export default function OssConfig() {
	const navigate = useNavigate();
	const { data, isLoading } = useOssConfig();

	const topItems: BarItem[] = [
		{ icon: Cloud, label: '管理', value: 'OSS 图床' },
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
					<span className={styles.breadcrumb}>OSS 图床配置</span>
				</div>
				<span className={styles.adminTag}>管理 · OSS 配置</span>
			</div>

			<motion.div
				variants={staggerContainer}
				initial="hidden"
				animate="show"
				className={styles.hero}
			>
				<motion.div variants={slideUp} className={styles.heroHeader}>
					<span className={styles.heroTag}>// 运行时 · 存储</span>
					<h1 className={styles.heroTitle}>
						<span className={styles.heroGradient}>阿里云 OSS 图床配置</span>
					</h1>
					<p className={styles.heroSubtitle}>
						配置阿里云 OSS 凭据，用于持久化 AI 生成图片（image-config/generate 返回的临时 URL
						转存为永久 URL）。独立于 MinIO（导出文件存储）。配置优先级：DB &gt; env 兜底。
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
				<OssConfigForm key={data.current?.updatedAt ?? 'init'} data={data} />
			)}
		</AppShell>
	);
}

/* ========== 表单子组件 ========== */
function OssConfigForm({ data }: { data: OssConfigResponse }) {
	const cur = data.current;
	const updateMutation = useUpdateOssConfig();
	const testMutation = useTestOssConnection();
	const uploadMutation = useUploadByUrl();

	const [name, setName] = useState(cur?.name ?? 'default');
	const [region, setRegion] = useState(cur?.region ?? data.fallback.region ?? '');
	const [bucket, setBucket] = useState(cur?.bucket ?? data.fallback.bucket ?? '');
	const [endpoint, setEndpoint] = useState(cur?.endpoint ?? data.fallback.endpoint ?? '');
	const [customDomain, setCustomDomain] = useState(
		cur?.customDomain ?? data.fallback.customDomain ?? '',
	);
	const [pathPrefix, setPathPrefix] = useState(
		cur?.pathPrefix ?? data.fallback.pathPrefix ?? 'drama/images',
	);
	const [timeoutMs, setTimeoutMs] = useState(
		cur?.timeoutMs ?? data.fallback.timeoutMs ?? 60000,
	);
	const [accessKeyId, setAccessKeyId] = useState('');
	const [accessKeySecret, setAccessKeySecret] = useState('');
	const [showAk, setShowAk] = useState(false);
	const [showSk, setShowSk] = useState(false);
	const [testResult, setTestResult] = useState<string | null>(null);

	// URL 转存测试区域
	const [testUrl, setTestUrl] = useState('');
	const [uploadResult, setUploadResult] = useState<string | null>(null);

	const maskedAk = cur?.accessKeyIdMasked ?? '（未配置）';
	const maskedSk = cur?.accessKeySecretMasked ?? '（未配置）';

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setTestResult(null);
		updateMutation.mutate({
			name,
			accessKeyId: accessKeyId || undefined,
			accessKeySecret: accessKeySecret || undefined,
			region,
			bucket,
			endpoint: endpoint || null,
			customDomain: customDomain || null,
			pathPrefix,
			timeoutMs,
		});
	}

	async function handleTest() {
		setTestResult(null);
		try {
			const result = await testMutation.mutateAsync({
				accessKeyId: accessKeyId || undefined,
				accessKeySecret: accessKeySecret || undefined,
				region: region || undefined,
				bucket: bucket || undefined,
				endpoint: endpoint || undefined,
			});
			setTestResult(
				`连接成功，延时 ${result.latencyMs}ms，bucket=${result.bucketEcho}，region=${result.regionEcho}`,
			);
		} catch (e) {
			const err = e as RequestError;
			setTestResult(`连接失败：${err.message}`);
		}
	}

	async function handleUpload() {
		setUploadResult(null);
		try {
			const result = await uploadMutation.mutateAsync({ url: testUrl });
			setUploadResult(
				`转存成功：${result.url}（${result.size} 字节，${result.contentType}）`,
			);
		} catch (e) {
			const err = e as RequestError;
			setUploadResult(`转存失败：${err.message}`);
		}
	}

	const isSaving = updateMutation.isPending;
	const isTesting = testMutation.isPending;
	const isUploading = uploadMutation.isPending;
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
					<Cloud strokeWidth={2} />
				</div>
				<div>
					<h2 className={styles.sectionTitle}>当前配置</h2>
					<p className={styles.sectionHint}>
						保存即写入数据库（UPSERT），全局生效。当前 AK:{' '}
						<code className={styles.codeInline}>{maskedAk}</code> · SK:{' '}
						<code className={styles.codeInline}>{maskedSk}</code>
					</p>
				</div>
			</div>

			<form className={styles.form} onSubmit={handleSubmit}>
				<div className={styles.fieldRow}>
					<label className={styles.field}>
						<span className={styles.fieldLabel}>配置名称</span>
						<input
							className={styles.input}
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="aliyun-prod"
							required
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
							onChange={(e) => setTimeoutMs(Number(e.target.value) || 60000)}
						/>
					</label>
				</div>

				<div className={styles.fieldRow}>
					<label className={styles.field}>
						<span className={styles.fieldLabel}>地域</span>
						<input
							className={styles.input}
							value={region}
							onChange={(e) => setRegion(e.target.value)}
							placeholder="oss-cn-hangzhou"
							pattern="^oss-[a-z]+-[a-z0-9-]+$"
							required
						/>
						<span className={styles.fieldHint}>
							地域 ID，如 oss-cn-hangzhou / oss-cn-shanghai / oss-cn-beijing
						</span>
					</label>

					<label className={styles.field}>
						<span className={styles.fieldLabel}>存储桶</span>
						<input
							className={styles.input}
							value={bucket}
							onChange={(e) => setBucket(e.target.value)}
							placeholder="drama-images"
							pattern="^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$"
							required
						/>
						<span className={styles.fieldHint}>
							小写字母+数字+短横线，不以短横线开头/结尾
						</span>
					</label>
				</div>

				<label className={styles.field}>
					<span className={styles.fieldLabel}>
						访问密钥 ID
						<button
							type="button"
							className={styles.eyeBtn}
							onClick={() => setShowAk((v) => !v)}
							aria-label={showAk ? '隐藏' : '显示'}
						>
							{showAk ? <EyeOff strokeWidth={2} /> : <Eye strokeWidth={2} />}
						</button>
					</span>
					<input
						className={styles.input}
						type={showAk ? 'text' : 'password'}
						value={accessKeyId}
						onChange={(e) => setAccessKeyId(e.target.value)}
						placeholder="留空表示保留已保存的访问密钥 ID"
						autoComplete="off"
					/>
				</label>

				<label className={styles.field}>
					<span className={styles.fieldLabel}>
						访问密钥 Secret
						<button
							type="button"
							className={styles.eyeBtn}
							onClick={() => setShowSk((v) => !v)}
							aria-label={showSk ? '隐藏' : '显示'}
						>
							{showSk ? <EyeOff strokeWidth={2} /> : <Eye strokeWidth={2} />}
						</button>
					</span>
					<input
						className={styles.input}
						type={showSk ? 'text' : 'password'}
						value={accessKeySecret}
						onChange={(e) => setAccessKeySecret(e.target.value)}
						placeholder="留空表示保留已保存的访问密钥 Secret"
						autoComplete="off"
					/>
				</label>

				<div className={styles.fieldRow}>
					<label className={styles.field}>
						<span className={styles.fieldLabel}>Endpoint（可选）</span>
						<input
							className={styles.input}
							value={endpoint}
							onChange={(e) => setEndpoint(e.target.value)}
							placeholder="留空由 region 自动推导"
						/>
						<span className={styles.fieldHint}>
							私有化部署或特殊 endpoint 才需要填，默认 https://{'{region}'}.aliyuncs.com
						</span>
					</label>

					<label className={styles.field}>
						<span className={styles.fieldLabel}>自定义域名（可选）</span>
						<input
							className={styles.input}
							value={customDomain}
							onChange={(e) => setCustomDomain(e.target.value)}
							placeholder="https://cdn.example.com"
						/>
						<span className={styles.fieldHint}>CDN 加速域名，留空走 bucket 公网直链</span>
					</label>
				</div>

				<label className={styles.field}>
					<span className={styles.fieldLabel}>路径前缀</span>
					<input
						className={styles.input}
						value={pathPrefix}
						onChange={(e) => setPathPrefix(e.target.value)}
						placeholder="drama/images"
						pattern="^[a-zA-Z0-9][a-zA-Z0-9/_-]*[a-zA-Z0-9]$"
						required
					/>
					<span className={styles.fieldHint}>
						文件虚拟目录前缀，最终 key 形如 {pathPrefix || 'drama/images'}/2026/06/24/uuid.png
					</span>
				</label>

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

			{/* URL 转存测试区域（核心场景验证） */}
			<div className={styles.sectionHeader} style={{ marginTop: 32 }}>
				<div className={styles.sectionIcon}>
					<Upload strokeWidth={2} />
				</div>
				<div>
					<h2 className={styles.sectionTitle}>URL 转存测试</h2>
					<p className={styles.sectionHint}>
						输入一个图片 URL（http(s):// 或 data:base64），后端拉取并转存到 OSS，返回永久 URL
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
					<span className={styles.fieldLabel}>图片 URL</span>
					<input
						className={styles.input}
						value={testUrl}
						onChange={(e) => setTestUrl(e.target.value)}
						placeholder="https://example.com/image.png"
						required
					/>
				</label>

				{uploadResult && (
					<div
						className={`${styles.alertBlock} ${uploadResult.startsWith('转存成功') ? styles.alertSuccess : styles.alertError}`}
					>
						{uploadResult.startsWith('转存成功') ? (
							<CheckCircle2 strokeWidth={2} />
						) : (
							<AlertCircle strokeWidth={2} />
						)}
						<span>{uploadResult}</span>
					</div>
				)}

				<div className={styles.actions}>
					<button
						type="submit"
						className={styles.testBtn}
						disabled={isUploading || !testUrl}
					>
						{isUploading ? <Loader2 className={styles.spinner} /> : <Upload strokeWidth={2} />}
						{isUploading ? '转存中…' : '转存到 OSS'}
					</button>
				</div>
			</form>
		</motion.section>
	);
}
