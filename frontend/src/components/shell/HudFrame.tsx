// HudFrame — HUD 顶底状态条 + 内容包裹
// -----------------------------------------------------------------------------
// 仅在 L3 / L4 级别页面启用（Welcome / Reports / ProjectDetail / ScriptDetail）
// admin 页面不使用本组件，避免工具页过度装饰
// -----------------------------------------------------------------------------

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import styles from './HudFrame.module.css';

interface BarItem {
	icon?: LucideIcon;
	label: string;
	value?: string;
	pulse?: boolean;
}

interface Props {
	topItems?: BarItem[];
	topRight?: BarItem[];
	bottomItems?: BarItem[];
	bottomRight?: BarItem[];
	children: ReactNode;
}

export function HudFrame({ topItems = [], topRight = [], bottomItems = [], bottomRight = [], children }: Props) {
	return (
		<div className={styles.frame}>
			{(topItems.length > 0 || topRight.length > 0) && (
				<header className={styles.barTop}>
					<BarItems items={topItems} />
					<BarItems items={topRight} />
				</header>
			)}

			<div className={styles.body}>{children}</div>

			{(bottomItems.length > 0 || bottomRight.length > 0) && (
				<footer className={styles.barBottom}>
					<BarItems items={bottomItems} />
					<BarItems items={bottomRight} />
				</footer>
			)}
		</div>
	);
}

function BarItems({ items }: { items: BarItem[] }) {
	if (items.length === 0) return null;
	return (
		<div className={styles.barSide}>
			{items.map((item, idx) => (
				<span key={idx} className={styles.barItem}>
					{item.icon && <item.icon strokeWidth={2} />}
					{item.pulse && <span className={styles.dotPulse} />}
					<span>
						{item.label}
						{item.value && <span className={styles.barSep}> · {item.value}</span>}
					</span>
				</span>
			))}
		</div>
	);
}
