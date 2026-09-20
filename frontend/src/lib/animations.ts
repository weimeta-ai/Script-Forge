import type { Transition, Variants } from 'motion/react';

// snappy 缓动：避免 elastic / bounce 的 AI 感动画
export const easeSnappy: Transition['ease'] = [0.2, 0, 0, 1];

export const fadeIn: Variants = {
	hidden: { opacity: 0 },
	show: { opacity: 1, transition: { duration: 0.2, ease: easeSnappy } },
};

export const slideUp: Variants = {
	hidden: { opacity: 0, y: 8 },
	show: { opacity: 1, y: 0, transition: { duration: 0.2, ease: easeSnappy } },
};

export const staggerContainer: Variants = {
	hidden: { opacity: 0 },
	show: {
		opacity: 1,
		transition: { staggerChildren: 0.04 },
	},
};
