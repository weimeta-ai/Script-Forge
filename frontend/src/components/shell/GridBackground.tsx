// GridBackground — 轻量网格背景
// -----------------------------------------------------------------------------
// 仅渲染 PageBackground 的网格层（径向 mask 的 40px 网格），
// 用于不走 AppShell 的独立页（如登录/注册），保持全站网格视觉统一。
// 父容器需 position: relative。
// -----------------------------------------------------------------------------

import styles from './PageBackground.module.css';

export function GridBackground() {
	return <div className={styles.grid} aria-hidden />;
}
