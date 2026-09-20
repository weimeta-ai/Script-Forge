// Toast 通知容器
// -----------------------------------------------------------------------------
// 监听 useToastStore，渲染所有当前通知
// - 自动倒计时关闭（duration > 0 时）
// - 鼠标 hover 时暂停倒计时（用户阅读时不被打断）
// - 右上角 X 按钮手动关闭
// -----------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useToastStore, type ToastItem, type ToastType } from '../store/toast';
import styles from './Toast.module.css';

const ICONS: Record<ToastType, typeof AlertCircle> = {
	error: AlertCircle,
	success: CheckCircle2,
	info: Info,
};

// 单条 Toast —— 独立组件以便各自管理倒计时
function ToastRow({ toast }: { toast: ToastItem }) {
	const remove = useToastStore((s) => s.remove);
	const [paused, setPaused] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (toast.duration <= 0) return;
		if (paused) {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
			return;
		}
		timerRef.current = setTimeout(() => remove(toast.id), toast.duration);
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, [toast.duration, toast.id, paused, remove]);

	const Icon = ICONS[toast.type];

	return (
		<motion.div
			layout
			initial={{ opacity: 0, x: 40, scale: 0.95 }}
			animate={{ opacity: 1, x: 0, scale: 1 }}
			exit={{ opacity: 0, x: 40, scale: 0.95 }}
			transition={{ duration: 0.18 }}
			onMouseEnter={() => setPaused(true)}
			onMouseLeave={() => setPaused(false)}
			className={`${styles.toast} ${styles[toast.type]}`}
			role={toast.type === 'error' ? 'alert' : 'status'}
		>
			<Icon strokeWidth={2} />
			<span className={styles.message}>{toast.message}</span>
			<button
				type="button"
				className={styles.closeBtn}
				onClick={() => remove(toast.id)}
				aria-label="关闭"
			>
				<X strokeWidth={2} />
			</button>
		</motion.div>
	);
}

export function ToastContainer() {
	const toasts = useToastStore((s) => s.toasts);
	return (
		<div className={styles.container}>
			<AnimatePresence initial={false}>
				{toasts.map((t) => (
					<ToastRow key={t.id} toast={t} />
				))}
			</AnimatePresence>
		</div>
	);
}
