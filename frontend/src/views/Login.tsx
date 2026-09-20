// 登录页（p00 暖白审片台风 — AuthLayout + AuthFormCard 架构）
// -----------------------------------------------------------------------------
// 与注册页共享：
//   - AuthLayout（外层壳 + 左栏轮播 + 品牌信息条）
//   - AuthFormCard（右栏容器 + Logo + 标题槽位）
// 本文件仅保留：表单状态 + 字段渲染 + 提交逻辑
// =============================================================================

import { ArrowRight, Eye, EyeOff, Loader2, Lock, User } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLogin } from '../api/auth';
import { AuthFormCard } from '../components/auth/AuthFormCard';
import { AuthLayout } from '../components/auth/AuthLayout';
import { RequestError } from '../lib/request';

export default function Login() {
	const navigate = useNavigate();
	const loginMutation = useLogin();

	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const [showPwd, setShowPwd] = useState(false);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		try {
			await loginMutation.mutateAsync({ username, password });
			navigate('/upload', { replace: true });
		} catch {
			// 错误已在 mutation.error 里，下方 UI 渲染
		}
	}

	const errorMessage =
		loginMutation.error instanceof RequestError
			? loginMutation.error.message
			: loginMutation.error?.message;

	return (
		<AuthLayout>
			<AuthFormCard
				eyebrow="唯元智创"
				title="欢迎回来"
				subtitle="今天我们做点什么？"
			>
				<form onSubmit={handleSubmit} className="space-y-5">
					{/* 账号 */}
					<div>
						<label
							className="mb-1.5 block font-sans text-[11px] uppercase"
							style={{ color: 'var(--color-text-subtle)', letterSpacing: '0.18em' }}
						>
							账号
						</label>
						<div className="relative">
							<User
								size={16}
								className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
								style={{ color: 'var(--color-text-subtle)' }}
							/>
							<input
								type="text"
								className="input-cinema"
								style={{ paddingLeft: '38px' }}
								value={username}
								onChange={(e) => setUsername(e.target.value)}
								placeholder="请输入账号"
								autoComplete="username"
								required
								disabled={loginMutation.isPending}
							/>
						</div>
					</div>

					{/* 密码 */}
					<div>
						<label
							className="mb-1.5 block font-sans text-[11px] uppercase"
							style={{ color: 'var(--color-text-subtle)', letterSpacing: '0.18em' }}
						>
							密码
						</label>
						<div className="relative">
							<Lock
								size={16}
								className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
								style={{ color: 'var(--color-text-subtle)' }}
							/>
							<input
								type={showPwd ? 'text' : 'password'}
								className="input-cinema"
								style={{ paddingLeft: '38px', paddingRight: '42px' }}
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder="请输入密码"
								autoComplete="current-password"
								required
								disabled={loginMutation.isPending}
							/>
							<button
								type="button"
								onClick={() => setShowPwd(!showPwd)}
								className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-md px-1.5 py-1.5 transition-colors hover:bg-[rgba(184,68,60,0.08)]"
								style={{ color: 'var(--color-text-subtle)' }}
								aria-label={showPwd ? '隐藏密码' : '显示密码'}
							>
								{showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
							</button>
						</div>
					</div>

					{/* 错误提示 */}
					{errorMessage && (
						<div
							className="rounded-[10px] px-3 py-2 font-sans text-sm"
							style={{
								color: 'var(--color-primary)',
								background: 'rgba(184,68,60,0.08)',
								border: '1px solid rgba(184,68,60,0.18)',
								borderLeft: '3px solid var(--color-primary)',
							}}
						>
							{errorMessage}
						</div>
					)}

					{/* 提交按钮 */}
					<button
						type="submit"
						disabled={loginMutation.isPending}
						className="btn-cinema-primary w-full"
						style={{ height: '48px', marginTop: '4px' }}
					>
						{loginMutation.isPending ? (
							<>
								<Loader2 size={16} className="animate-spin" />
								正在进入...
							</>
						) : (
							<>
								进入工作台
								<ArrowRight size={16} />
							</>
						)}
					</button>

					{/* 立即注册 */}
					{/* 	<div
						className="pt-1 text-center font-sans text-sm"
						style={{ color: 'var(--color-text-muted)' }}
					>
						还没有账号？{' '}
						<a
							href="/register"
							onClick={(e) => {
								e.preventDefault();
								navigate('/register');
							}}
							style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}
						>
							立即注册
						</a>
					</div> */}
				</form>
			</AuthFormCard>
		</AuthLayout>
	);
}
