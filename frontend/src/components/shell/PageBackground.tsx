// PageBackground — 页面装饰背景（性能优化版）
// -----------------------------------------------------------------------------
// 装饰级别 decorLevel：
//   L1：径向渐变 + 40px 网格
//   L2/L3/L4：+ 静态光球（3 个）+ 水印 + 噪点
//
// 性能优化：已移除粒子动画、光球浮动动画、鼠标跟随光斑、噪点 mix-blend-mode
// 视觉影响极小，但 GPU 合成层大幅减少，全站滚动/输入流畅度显著提升
// -----------------------------------------------------------------------------

import { useMemo } from 'react';
import styles from './PageBackground.module.css';

export type DecorLevel = 'L1' | 'L2' | 'L3' | 'L4';

interface Props {
	decorLevel?: DecorLevel;
	watermark?: string;
}

export function PageBackground({ decorLevel = 'L2', watermark }: Props) {
	const showOrbs = decorLevel === 'L2' || decorLevel === 'L3' || decorLevel === 'L4';
	const showWatermark = !!watermark && (decorLevel === 'L2' || decorLevel === 'L3' || decorLevel === 'L4');

	// 仅水印字体大小依赖 decorLevel，用 useMemo 避免每次渲染重建 className 字符串
	const wmClass = useMemo(
		() =>
			decorLevel === 'L4'
				? `${styles.watermark} ${styles.watermarkLg}`
				: decorLevel === 'L3'
					? `${styles.watermark} ${styles.watermarkMd}`
					: `${styles.watermark} ${styles.watermarkSm}`,
		[decorLevel],
	);

	return (
		<div className={styles.bg} aria-hidden="true">
			<div className={styles.grid} />

			{showOrbs && (
				<>
					<div className={`${styles.orb} ${styles.orb1}`} />
					<div className={`${styles.orb} ${styles.orb2}`} />
					<div className={`${styles.orb} ${styles.orb3}`} />
				</>
			)}

			{showWatermark && <div className={wmClass}>{watermark}</div>}

			<div className={styles.noise} />
		</div>
	);
}
