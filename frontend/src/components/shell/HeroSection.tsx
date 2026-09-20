// HeroSection — 统一 Hero 区块（花里胡哨版）
// -----------------------------------------------------------------------------
// 渲染：
//   1. 顶部 mono 标签（// XXXX）
//   2. 56-72px 渐变标题 + 60px text-shadow glow
//   3. 副文案（14-16px muted）
//   4. 可选：左右渐隐横线包夹 mono 系统名（systemLine）
//   5. 可选：CTA actions（按钮组）
//   6. 入场：600ms spring（slideUp）
// -----------------------------------------------------------------------------

import { type ReactNode } from 'react';
import { motion } from 'motion/react';
import { slideUp, staggerContainer } from '../../lib/animations';
import styles from './HeroSection.module.css';

interface Props {
	/** 顶部 mono 标签（如 // LLM · RUNTIME） */
	tag?: string;
	/** 主标题（自动渲染渐变） */
	title: ReactNode;
	/** 副文案 */
	subtitle?: ReactNode;
	/** 系统标识横线（如 // GLM 5.2），可选 */
	systemLine?: string;
	/** 右上角 CTA 按钮组 */
	actions?: ReactNode;
	/** 标题字号档位：lg=72px / md=56px / sm=44px */
	size?: 'lg' | 'md' | 'sm';
}

export function HeroSection({ tag, title, subtitle, systemLine, actions, size = 'lg' }: Props) {
	const titleClass = size === 'lg' ? styles.titleLg : size === 'md' ? styles.titleMd : styles.titleSm;

	return (
		<motion.section
			variants={staggerContainer}
			initial="hidden"
			animate="show"
			className={styles.hero}
		>
			<div className={styles.heroMain}>
				<motion.div variants={slideUp} className={styles.heroLeft}>
					{tag && <span className={styles.tag}>{tag}</span>}
					<h1 className={`${styles.title} ${titleClass}`}>
						<span className={styles.titleGradient}>{title}</span>
					</h1>
					{subtitle && <p className={styles.subtitle}>{subtitle}</p>}
					{systemLine && (
						<div className={styles.systemLine}>
							<span className={styles.line} />
							<span className={styles.systemName}>{systemLine}</span>
							<span className={styles.line} />
						</div>
					)}
				</motion.div>

				{actions && (
					<motion.div variants={slideUp} className={styles.actions}>
						{actions}
					</motion.div>
				)}
			</div>
		</motion.section>
	);
}
