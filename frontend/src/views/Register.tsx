// 注册页（p00 暖白审片台风 — AuthLayout + AuthFormCard 架构）
// -----------------------------------------------------------------------------
// 与登录页共享 AuthLayout（外层壳 + 左栏轮播 + 品牌信息）
// 校验：用户名 3-64 位字母数字下划线；密码 ≥ 6 位；两次密码一致
// =============================================================================

import { ArrowRight, Eye, EyeOff, Loader2, Lock, User } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useRegister } from '../api/auth';
import { AuthFormCard } from '../components/auth/AuthFormCard';
import { AuthLayout } from '../components/auth/AuthLayout';
import { RequestError } from '../lib/request';
import { useAuthStore } from '../store/auth';

// 关闭注册守卫：VITE_REGISTRATION_ENABLED 为 false 时跳转登录页
// 默认关闭：仅 admin 可在后台创建账号
const REGISTRATION_ENABLED =
	(import.meta.env.VITE_REGISTRATION_ENABLED ?? 'false').toLowerCase() === 'true';

export default function Register() {
	if (!REGISTRATION_ENABLED) {
		return <Navigate to="/login" replace />;
	}
	const navigate = useNavigate();
	const registerMutation = useRegister();
	const setAuth = useAuthStore((s) => s.setAuth);

	const [username, setUsername] = useState('');
	const [displayName, setDisplayName] = useState('');
	const [password, setPassword] = useState('');
	const [confirmPwd, setConfirmPwd] = useState('');
	const [showPwd, setShowPwd] = useState(false);
	const [localError, setLocalError] = useState<string | null>(null);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setLocalError(null);

		if (password !== confirmPwd) {
			setLocalError('两次输入的密码不一致');
			return;
		}
		if (!/^[a-zA-Z0-9_]+$/.test(username)) {
			setLocalError('用户名只能含字母、数字、下划线');
			return;
		}

		try {
			const data = await registerMutation.mutateAsync({
				username,
				password,
				displayName: displayName.trim() || undefined,
			});
			// 注册即登录：直接写入 store 跳到上传页
			setAuth(data);
			navigate('/upload', { replace: true });
		} catch {
			// 错误渲染在下方
		}
	}

	const errorMessage =
		localError ??
		(registerMutation.error instanceof RequestError
			? registerMutation.error.message
			: registerMutation.error?.message);

	return (
		<AuthLayout>
			<AuthFormCard
				eyebrow="新用户注册"
				title="创建账号"
				subtitle="注册后即可进入审片工作台。"
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
								placeholder="3-64 位字母/数字/下划线"
								autoComplete="username"
								minLength={3}
								maxLength={64}
								required
								disabled={registerMutation.isPending}
							/>
						</div>
					</div>

					{/* 昵称（可选） */}
					<div>
						<label
							className="mb-1.5 block font-sans text-[11px] uppercase"
							style={{ color: 'var(--color-text-subtle)', letterSpacing: '0.18em' }}
						>
							昵称（可选）
						</label>
						<div className="relative">
							<input
								type="text"
								className="input-cinema"
								style={{ paddingLeft: '14px' }}
								value={displayName}
								onChange={(e) => setDisplayName(e.target.value)}
								placeholder="将显示在侧边栏顶部"
								maxLength={64}
								disabled={registerMutation.isPending}
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
								placeholder="至少 6 位"
								autoComplete="new-password"
								minLength={6}
								maxLength={64}
								required
								disabled={registerMutation.isPending}
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

					{/* 确认密码 */}
					<div>
						<label
							className="mb-1.5 block font-sans text-[11px] uppercase"
							style={{ color: 'var(--color-text-subtle)', letterSpacing: '0.18em' }}
						>
							确认密码
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
								style={{ paddingLeft: '38px' }}
								value={confirmPwd}
								onChange={(e) => setConfirmPwd(e.target.value)}
								placeholder="再次输入密码"
								autoComplete="new-password"
								minLength={6}
								maxLength={64}
								required
								disabled={registerMutation.isPending}
							/>
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
						disabled={registerMutation.isPending}
						className="btn-cinema-primary w-full"
						style={{ height: '48px', marginTop: '4px' }}
					>
						{registerMutation.isPending ? (
							<>
								<Loader2 size={16} className="animate-spin" />
								正在创建...
							</>
						) : (
							<>
								创建账号
								<ArrowRight size={16} />
							</>
						)}
					</button>

					{/* 去登录 */}
					<div
						className="pt-1 text-center font-sans text-sm"
						style={{ color: 'var(--color-text-muted)' }}
					>
						已有账号？{' '}
						<a
							href="/login"
							onClick={(e) => {
								e.preventDefault();
								navigate('/login');
							}}
							style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}
						>
							去登录
						</a>
					</div>
				</form>
			</AuthFormCard>
		</AuthLayout>
	);
}
