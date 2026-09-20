// AppShell — 统一页面外壳
// -----------------------------------------------------------------------------
// 组合：
//   <PageBackground decorLevel watermark />
//   <HudFrame topItems topRight bottomItems bottomRight>
//     <AppSidebar collapsed onToggleCollapse />
//     <main>
//       {children}
//     </main>
//   </HudFrame>
//
// 用法：
//   <AppShell
//     watermark="WORKSPACE"
//     decorLevel="L3"
//     topItems={[{ icon: LayoutDashboard, label: 'WORKSPACE' }]}
//   >
//     {children}
//   </AppShell>
// -----------------------------------------------------------------------------

import { useState, type ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { PageBackground, type DecorLevel } from './PageBackground';
import { HudFrame, type BarItem } from './HudFrame';
import { AppSidebar } from './AppSidebar';
import styles from './AppShell.module.css';

interface Props {
	children: ReactNode;
	watermark?: string;
	decorLevel?: DecorLevel;
	topItems?: BarItem[];
	topRight?: BarItem[];
	bottomItems?: BarItem[];
	bottomRight?: BarItem[];
	/** 是否启用 HUD 顶底状态条（默认全开） */
	showHud?: boolean;
	/** 是否启用背景装饰（orb 浮动 / 粒子上升 / 扫描线）。默认 true 保持兼容；
	 * 设为 false 时关闭所有动画，仅保留静态纸本背景（性能与体验更稳） */
	showBackground?: boolean;
}

const SIDEBAR_STORAGE_KEY = 'sidebar.collapsed';

function readInitialCollapsed(): boolean {
	if (typeof window === 'undefined') return false;
	try {
		return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1';
	} catch {
		return false;
	}
}

export function AppShell({
	children,
	watermark,
	decorLevel = 'L2',
	topItems = [],
	topRight = [],
	bottomItems = [],
	bottomRight = [],
	showHud,
	showBackground = true,
}: Props) {
	const [menuOpen, setMenuOpen] = useState(false);
	const [collapsed, setCollapsed] = useState<boolean>(readInitialCollapsed);

	function toggleCollapse() {
		setCollapsed((v) => {
			const next = !v;
			try {
				window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0');
			} catch {
				// 隐私模式 / 配额满：静默忽略，state 仍生效
			}
			return next;
		});
	}

	// 默认全开 HUD（plan: 全页花里胡哨）；可显式关闭
	const enableHud = showHud ?? true;

	const content = (
		<div className={styles.shell}>
			<AppSidebar
				open={menuOpen}
				onClose={() => setMenuOpen(false)}
				collapsed={collapsed}
				onToggleCollapse={toggleCollapse}
			/>
			{menuOpen && (
				<div
					className={styles.mask}
					role="button"
					tabIndex={0}
					aria-label="关闭菜单"
					onClick={() => setMenuOpen(false)}
					onKeyDown={(e) => {
						if (e.key === 'Escape' || e.key === 'Enter') {
							e.preventDefault();
							setMenuOpen(false);
						}
					}}
				/>
			)}

			<div className={styles.main}>
				<div className={styles.content}>{children}</div>
			</div>
		</div>
	);

	return (
		<>
			{showBackground && (
				<PageBackground decorLevel={decorLevel} watermark={watermark} />
			)}

			<button
				type="button"
				className={styles.menuBtn}
				onClick={() => setMenuOpen(true)}
				aria-label="打开菜单"
			>
				<Menu strokeWidth={2} />
			</button>

			{enableHud ? (
				<HudFrame
					topItems={topItems}
					topRight={topRight}
					bottomItems={bottomItems}
					bottomRight={bottomRight}
				>
					{content}
				</HudFrame>
			) : (
				content
			)}
		</>
	);
}
