// 全局 Toast 通知状态（zustand）
// -----------------------------------------------------------------------------
// 设计：
// - 不持久化（toast 是瞬时反馈，刷新即清空）
// - toasts 数组 + push/remove 两个操作
// - 提供 selector：useToasts 方便组件订阅
// - 非 hook 入口（getState）供 catch 块直接调用，无需 React 上下文
// -----------------------------------------------------------------------------

import { create } from 'zustand';

export type ToastType = 'error' | 'success' | 'info';

export interface ToastItem {
	id: string;
	type: ToastType;
	message: string;
	// 自动关闭时长（毫秒），0 表示不自动关闭
	duration: number;
}

interface ToastState {
	toasts: ToastItem[];
	push: (t: Omit<ToastItem, 'id'>) => string;
	remove: (id: string) => void;
}

// 简单自增 id（不引入 nanoid 等依赖）
let seq = 0;
function genId(): string {
	seq += 1;
	return `toast-${Date.now()}-${seq}`;
}

export const useToastStore = create<ToastState>((set) => ({
	toasts: [],
	// 添加一条 toast，返回 id（方便调用方手动 remove）
	push: (t) => {
		const id = genId();
		set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
		return id;
	},
	remove: (id) =>
		set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

// -----------------------------------------------------------------------------
// 便捷 API（非 hook 入口）—— 供组件 catch 块、request 拦截器等调用
// -----------------------------------------------------------------------------
// 用法：
//   import { toast } from '../store/toast';
//   try { await mutation.mutateAsync(...) }
//   catch (e) { toast.error(e); }

const DEFAULT_DURATION: Record<ToastType, number> = {
	error: 6000, // 错误停留更久，让用户能看清
	success: 3000,
	info: 3000,
};

// 从任意错误里提取人类可读信息
// - RequestError（本项目业务错误）：直接用 message
// - Error：用 message
// - 其它（字符串/未知）：兜底文案
function extractMessage(err: unknown, fallback: string): string {
	if (err instanceof Error && err.message) return err.message;
	if (typeof err === 'string' && err) return err;
	return fallback;
}

export const toast = {
	error(err: unknown, fallback = '操作失败，请稍后重试') {
		return useToastStore.getState().push({
			type: 'error',
			message: extractMessage(err, fallback),
			duration: DEFAULT_DURATION.error,
		});
	},
	success(message: string) {
		return useToastStore.getState().push({
			type: 'success',
			message,
			duration: DEFAULT_DURATION.success,
		});
	},
	info(message: string) {
		return useToastStore.getState().push({
			type: 'info',
			message,
			duration: DEFAULT_DURATION.info,
		});
	},
	remove(id: string) {
		useToastStore.getState().remove(id);
	},
};
