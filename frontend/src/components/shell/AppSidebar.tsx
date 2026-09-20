// AppSidebar — 统一应用的左侧导航
// -----------------------------------------------------------------------------
// 基于 useLocation 自动 active 高亮
// 根据用户角色（admin/user）动态展示管理菜单
// 顶部品牌区 + 主导航 + 折叠按钮 + 用户/登出
// 桌面端：可折叠成 64px 图标条（state 持久化到 localStorage）
// 移动端：抽屉模式（open prop 控制）
// -----------------------------------------------------------------------------

import {
	Cloud,
	Coins,
	GalleryVerticalEnd,
	History,
	Image as ImageIcon,
	LogOut,
	PanelLeftClose,
	PanelLeftOpen,
	ScrollText,
	Settings2,
	Upload,
	Users
} from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMyBalance } from '../../api/credit'
import { fmtCredits } from '../../lib/credit-tx-display'
import { useAuthStore } from '../../store/auth'
import styles from './AppSidebar.module.css'

interface Props {
	open?: boolean
	collapsed?: boolean
	onClose?: () => void
	onToggleCollapse?: () => void
}

export function AppSidebar({
	open,
	collapsed = false,
	onClose,
	onToggleCollapse
}: Props) {
	const location = useLocation()
	const navigate = useNavigate()
	const user = useAuthStore((s) => s.user)
	const clearAuth = useAuthStore((s) => s.clearAuth)
	const { data: balanceData } = useMyBalance()
	const balance = balanceData?.balance ?? 0

	const isAdmin = user?.role === 'admin'

	function isActive(path: string, exact = false) {
		return exact
			? location.pathname === path
			: location.pathname.startsWith(path)
	}

	function handleLogout() {
		clearAuth()
		navigate('/login', { replace: true })
	}

	return (
		<aside
			className={[
				styles.sidebar,
				open ? styles.sidebarOpen : '',
				collapsed ? styles.sidebarCollapsed : ''
			].join(' ')}
			data-collapsed={collapsed}
		>
			{/* 品牌 */}
			<div className={styles.header}>
				<div
					className={styles.brandMark}
					title={collapsed ? '唯元智创AI爆款猎人' : undefined}
				>
					W
				</div>
				{!collapsed && (
					<div className={styles.brandText}>
						<span className={styles.brandName}>唯元剧创</span>
						<span className={styles.brandSub}>短剧预测</span>
					</div>
				)}
			</div>

			<nav className={styles.nav} aria-label="主导航">
				{!collapsed && (
					<div className={styles.sectionLabel}>主导航</div>
				)}

				<Link
					to="/upload"
					onClick={onClose}
					className={`${styles.link} ${
						isActive('/upload', true) ? styles.linkActive : ''
					}`}
					title={collapsed ? '导入剧本' : undefined}
				>
					<Upload strokeWidth={2} />
					{!collapsed && <span>导入剧本</span>}
				</Link>

				<Link
					to="/history"
					onClick={onClose}
					className={`${styles.link} ${
						isActive('/history', true) ? styles.linkActive : ''
					}`}
					title={collapsed ? '历史分析' : undefined}
				>
					<History strokeWidth={2} />
					{!collapsed && <span>历史分析</span>}
				</Link>

				{isAdmin && (
					<>
						{!collapsed && (
							<div className={styles.sectionLabel}>管理</div>
						)}

						{/* <Link
							to="/admin/knowledge"
							onClick={onClose}
							className={`${styles.link} ${isActive('/admin/knowledge') ? styles.linkActive : ''}`}
							title={collapsed ? '知识库' : undefined}
						>
							<Database strokeWidth={2} />
							{!collapsed && <span>知识库</span>}
						</Link> */}

						<Link
							to="/admin/llm-config"
							onClick={onClose}
							className={`${styles.link} ${
								isActive('/admin/llm-config')
									? styles.linkActive
									: ''
							}`}
							title={collapsed ? 'LLM 配置' : undefined}
						>
							<Settings2 strokeWidth={2} />
							{!collapsed && <span>LLM 配置</span>}
						</Link>

						<Link
							to="/admin/image-config"
							onClick={onClose}
							className={`${styles.link} ${
								isActive('/admin/image-config')
									? styles.linkActive
									: ''
							}`}
							title={collapsed ? '图片模型' : undefined}
						>
							<ImageIcon strokeWidth={2} />
							{!collapsed && <span>图片模型</span>}
						</Link>

						<Link
							to="/admin/oss-config"
							onClick={onClose}
							className={`${styles.link} ${
								isActive('/admin/oss-config')
									? styles.linkActive
									: ''
							}`}
							title={collapsed ? 'OSS 图床' : undefined}
						>
							<Cloud strokeWidth={2} />
							{!collapsed && <span>OSS 图床</span>}
						</Link>

						<Link
							to="/admin/login-banners"
							onClick={onClose}
							className={`${styles.link} ${
								isActive('/admin/login-banners')
									? styles.linkActive
									: ''
							}`}
							title={collapsed ? '登录轮播' : undefined}
						>
							<GalleryVerticalEnd strokeWidth={2} />
							{!collapsed && <span>登录轮播</span>}
						</Link>

						<Link
							to="/admin/prompt-config"
							onClick={onClose}
							className={`${styles.link} ${
								isActive('/admin/prompt-config')
									? styles.linkActive
									: ''
							}`}
							title={collapsed ? '话术配置' : undefined}
						>
							<ScrollText strokeWidth={2} />
							{!collapsed && <span>话术配置</span>}
						</Link>

						<Link
							to="/admin/users"
							onClick={onClose}
							className={`${styles.link} ${
								isActive('/admin/users')
									? styles.linkActive
									: ''
							}`}
							title={collapsed ? '用户管理' : undefined}
						>
							<Users strokeWidth={2} />
							{!collapsed && <span>用户管理</span>}
						</Link>

						<Link
							to="/admin/credit-rules"
							onClick={onClose}
							className={`${styles.link} ${
								isActive('/admin/credit-rules')
									? styles.linkActive
									: ''
							}`}
							title={collapsed ? '积分规则' : undefined}
						>
							<Coins strokeWidth={2} />
							{!collapsed && <span>积分规则</span>}
						</Link>
					</>
				)}
			</nav>

			{/* 用户/登出 */}
			<div className={styles.footer}>
				<div
					className={styles.creditBox}
					title={
						collapsed
							? `积分余额 ${fmtCredits(balance)}`
							: undefined
					}
				>
					<Coins className={styles.creditIcon} strokeWidth={2} />
					{!collapsed && (
						<>
							<span className={styles.creditLabel}>积分余额</span>
							<span className={styles.creditValue}>
								{fmtCredits(balance)}
							</span>
						</>
					)}
				</div>
				<button
					type="button"
					onClick={handleLogout}
					className={styles.userBtn}
					title={
						collapsed
							? `${user?.displayName ?? user?.username} · ${
									isAdmin ? '管理员' : '用户'
							  } · 登出`
							: undefined
					}
				>
					<span className={styles.avatar}>
						{user?.username?.[0]?.toUpperCase() ?? 'U'}
					</span>
					{!collapsed && (
						<span className={styles.userInfo}>
							<span className={styles.userName}>
								{user?.displayName ?? user?.username}
							</span>
							<span className={styles.userRole}>
								{isAdmin ? '管理员' : '用户'}
							</span>
						</span>
					)}
					{!collapsed && (
						<LogOut className={styles.logoutIcon} strokeWidth={2} />
					)}
				</button>

				{/* 折叠按钮（仅桌面端） */}
				{onToggleCollapse && (
					<button
						type="button"
						onClick={onToggleCollapse}
						className={styles.collapseBtn}
						title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
						aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
					>
						{collapsed ? (
							<PanelLeftOpen strokeWidth={2} />
						) : (
							<PanelLeftClose strokeWidth={2} />
						)}
						{!collapsed && <span>折叠侧栏</span>}
					</button>
				)}
			</div>
		</aside>
	)
}
