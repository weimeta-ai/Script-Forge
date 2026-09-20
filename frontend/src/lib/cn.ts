import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// 标准类名合并工具：clsx 处理条件，tailwind-merge 解决 Tailwind 类冲突
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
