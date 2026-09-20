import { motion, type HTMLMotionProps } from 'motion/react';
import { forwardRef, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { buttonVariants, type ButtonVariantProps } from './button-variants';

export interface ButtonProps
	extends Omit<HTMLMotionProps<'button'>, 'children'>,
		ButtonVariantProps {
	loading?: boolean;
	children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, loading, children, disabled, ...props }, ref) => {
		return (
			<motion.button
				ref={ref}
				className={cn(buttonVariants({ variant, size }), className)}
				// 微上浮 -2px（不用 scale，避免 AI 感）
				whileHover={{ y: -2 }}
				whileTap={{ y: 0 }}
				transition={{ duration: 0.15, ease: [0.2, 0, 0, 1] }}
				disabled={disabled || loading}
				{...props}
			>
				{loading && (
					<svg
						className="h-4 w-4 animate-spin"
						viewBox="0 0 24 24"
						fill="none"
						aria-hidden="true"
					>
						<circle
							cx="12"
							cy="12"
							r="10"
							stroke="currentColor"
							strokeWidth="3"
							opacity="0.25"
						/>
						<path
							d="M12 2a10 10 0 0 1 10 10"
							stroke="currentColor"
							strokeWidth="3"
							strokeLinecap="round"
						/>
					</svg>
				)}
				{children}
			</motion.button>
		);
	},
);
Button.displayName = 'Button';
