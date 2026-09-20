// 运行时日志类型（与后端 lib/runtime-logger.ts 对齐）

export type LogCategory =
	| 'system'
	| 'score'
	| 'llm'
	| 'report';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface RuntimeLogEntry {
	id: string;
	ts: number; // ms timestamp
	level: LogLevel;
	category: LogCategory;
	message: string;
	scriptId?: string;
	projectId?: string;
	jobId?: string;
	dimensionKey?: string;
	meta?: Record<string, unknown>;
}

export interface RuntimeLogsResponse {
	items: RuntimeLogEntry[];
}
