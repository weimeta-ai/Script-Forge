// HudCard — 统一 section 卡片（花里胡哨版）
// -----------------------------------------------------------------------------
// 渲染：
//   1. 四角 HUD 描边（CSS 伪元素 ::before/::after）
//   2. 顶光带（.card-hud-top-line 风格）
//   3. 右上角 mono 角标（如 // 01）
//   4. 左上图标 + 标题 + 副标题
//   5. hover translateY(-2px) + primary glow
//   6. tone 决定四角描边色：primary / cyan / amber / violet / emerald
// -----------------------------------------------------------------------------

import { type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import styles from './HudCard.module.css';

export type HudCardTone = 'primary' | 'cyan' | 'amber' | 'violet' | 'emerald';

interface Props {
	/** 右上角 mono 角标（如 01 / 02 / SECTION-A） */
	index?: string;
	/** 左上图标 */
	icon?: LucideIcon;
	/** 标题 */
	title?: ReactNode;
	/** 副标题 */
	hint?: ReactNode;
	/** 右上角额外内容（标签 / 状态 / 操作按钮） */
	extra?: ReactNode;
	/** 配色 */
	tone?: HudCardTone;
	/** 内边距 */
	padding?: 'sm' | 'md' | 'lg' | 'none';
	/** 内容 */
	children?: ReactNode;
	/** 自定义 className（覆盖样式时用） */
	className?: string;
}

export function HudCard({
	index,
	icon: Icon,
	title,
	hint,
	extra,
	tone = 'primary',
	padding = 'md',
	children,
	className,
}: Props) {
	const rootClass = [
		styles.card,
		styles[`tone${tone[0].toUpperCase()}${tone.slice(1)}`],
		styles[`padding${padding[0].toUpperCase()}${padding.slice(1)}`],
		className,
	]
		.filter(Boolean)
		.join(' ');

	return (
		<div className={rootClass}>
			<div className={styles.cornerTL} aria-hidden />
			<div className={styles.cornerTR} aria-hidden />
			<div className={styles.cornerBL} aria-hidden />
			<div className={styles.cornerBR} aria-hidden />
			<div className={styles.topLine} aria-hidden />

			{(index || Icon || title || hint || extra) && (
				<div className={styles.header}>
					<div className={styles.headerLeft}>
						{Icon && (
							<span className={styles.iconWrap}>
								<Icon strokeWidth={2} />
							</span>
						)}
						{(title || hint) && (
							<div className={styles.titleBlock}>
								{title && <h3 className={styles.title}>{title}</h3>}
								{hint && <p className={styles.hint}>{hint}</p>}
							</div>
						)}
					</div>
					{(index || extra) && (
						<div className={styles.headerRight}>
							{extra}
							{index && <span className={styles.index}>{`// ${index}`}</span>}
						</div>
					)}
				</div>
			)}

			{children && <div className={styles.body}>{children}</div>}
		</div>
	);
}
