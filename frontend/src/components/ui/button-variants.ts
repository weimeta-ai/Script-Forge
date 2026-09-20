import { cva, type VariantProps } from 'class-variance-authority';

// 独立文件存放 cva 变体定义，避免 Button.tsx 同时导出组件与非组件触发 react-refresh 规则
export const buttonVariants = cva(
	[
		'inline-flex items-center justify-center gap-2 whitespace-nowrap',
		'font-medium select-none',
		'rounded-md border',
		'text-sm leading-none',
		'transition-[background-color,border-color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.2,0,0,1)]',
		'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
		'disabled:pointer-events-none disabled:opacity-50',
	].join(' '),
	{
		variants: {
			variant: {
				// 主按钮：暗橙背景 + 顶部白色内高光 + 橙色光晕投影
				primary:
					'bg-primary text-primary-fg border-transparent shadow-[0_1px_0_0_rgb(255_255_255_/_20%)_inset,0_1px_2px_0_rgb(0_0_0_/_30%),0_4px_12px_-4px_rgb(234_88_12_/_50%)] hover:bg-primary-hover hover:shadow-[0_1px_0_0_rgb(255_255_255_/_25%)_inset,0_1px_2px_0_rgb(0_0_0_/_30%),0_6px_16px_-4px_rgb(234_88_12_/_60%)]',
				// 次按钮：表面 2 + 边框 + hover 微亮
				secondary:
					'bg-surface-2 text-text border-border shadow-[0_1px_0_0_rgb(255_255_255_/_4%)_inset] hover:bg-surface hover:border-border-strong',
				// 描边按钮：透明背景 + 边框 + hover 强边框
				outline:
					'bg-transparent text-text border-border hover:bg-surface-2 hover:border-border-strong hover:text-secondary',
				// 文本按钮：无边框、纯文字
				ghost:
					'bg-transparent text-text-muted border-transparent hover:text-text hover:bg-surface-2',
				// 危险按钮：红色（复用主按钮质感结构）
				danger:
					'bg-danger text-white border-transparent shadow-[0_1px_0_0_rgb(255_255_255_/_20%)_inset,0_1px_2px_0_rgb(0_0_0_/_30%)] hover:bg-danger/90',
			},
			size: {
				sm: 'h-8 px-3 text-xs',
				md: 'h-9 px-4',
				lg: 'h-11 px-6 text-base',
				icon: 'h-9 w-9 p-0',
			},
		},
		defaultVariants: { variant: 'primary', size: 'md' },
	},
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;
