// 流程状态条的类型 / 常量 / 纯函数（独立于组件，便于单测 + Fast Refresh 友好）
// =============================================================================
// 3 阶段流程：导入 → 分析 → 导出
// =============================================================================

import type { ActiveTaskInfo } from '../api/scripts'

export type Phase = 'import' | 'analyze' | 'export'
export type PhaseState = 'done' | 'running' | 'pending'

export const PHASE_ORDER: Phase[] = ['import', 'analyze']

export const PHASE_LABEL: Record<Phase, string> = {
	import: '导入',
	analyze: '分析',
	export: '导出'
}

export interface ResolveInput {
	hasScript: boolean
	hasAnalyzeScore: boolean
	analyzeTask?: ActiveTaskInfo | null
}

export interface ResolveOutput {
	states: Record<Phase, PhaseState>
	/** 当前阶段：running 最高优先；否则首个非 done；全 done 时为 'export' */
	current: Phase
}

// 阶段判定纯函数
// 优先级：running > 时间顺序首个 pending > 全部 done
export function resolvePhases(input: ResolveInput): ResolveOutput {
	const importState: PhaseState = input.hasScript ? 'done' : 'pending'

	let analyzeState: PhaseState = 'pending'
	if (input.hasAnalyzeScore) {
		analyzeState = 'done'
	} else if (
		input.analyzeTask &&
		(input.analyzeTask.status === 'running' ||
			input.analyzeTask.status === 'pending')
	) {
		analyzeState = 'running'
	}

	// 导出：暂固定 pending，由 Report 页 onExportClick 负责实际触发
	const exportState: PhaseState = 'pending'

	const states: Record<Phase, PhaseState> = {
		import: importState,
		analyze: analyzeState,
		export: exportState
	}

	const current: Phase =
		analyzeState === 'running'
			? 'analyze'
			: PHASE_ORDER.find((p) => states[p] !== 'done') ?? 'export'

	return { states, current }
}

// CTA 文案规则（current 只会是 import/analyze/export 三选一）
export function nextActionLabel(
	current: Phase,
	states: Record<Phase, PhaseState>
): string {
	if (current === 'analyze') {
		return states.analyze === 'running' ? '查看分析进度' : '开始分析'
	}
	if (current === 'export') return '导出 PDF'
	return '查看详情'
}
