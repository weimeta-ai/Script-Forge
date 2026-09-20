// 剧本相关 API（p00 同款简化）
// -----------------------------------------------------------------------------
// 8 个接口（直挂用户，无 projectId）：
//   GET    /scripts                列出我的剧本
//   POST   /scripts                粘贴文本创建
//   POST   /scripts/upload         文件上传（FormData）
//   GET    /scripts/:id            剧本详情
//   DELETE /scripts/:id            软删
//   POST   /scripts/:id/analyze    触发 8 节点分析（202 + taskId）
//   GET    /scripts/:id/status     轮询任务状态 + events[] + overall
//   GET    /scripts/:id/report     取报告 markdown
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../lib/request';
import { useAuthStore } from '../store/auth';

// === 类型定义 ===
export interface ScoreDetails {
	report?: string;
	score?: number;
	grade?: string;
	durationMs?: number;
	title?: string;
}

export interface ScriptListItem {
	id: string;
	title: string;
	genre?: string | null;
	fileName?: string | null;
	// 封面图 URL（用户选定的；无值时前端用 /drama-cover-default.svg 兜底）
	coverUrl?: string | null;
	// 封面候选 URL 数组（一次生成 3 张，用户选定前 coverUrl 为 null）
	coverUrlCandidates?: string[];
	wordCount: number;
	status: string;
	createdAt: string;
	updatedAt: string;
	// 后端 listByUserId JOIN script_versions 返回（无版本时为 null）
	scoreDetails: ScoreDetails | null;
	// 最近一次分析任务（无任务时为 null）
	// History 卡片据此识别 canceled/error 终态，决定是否屏蔽详情入口
	lastTask: {
		id: string;
		status: TaskStatus;
		mode: AnalyzeMode;
	} | null;
}

export interface ScriptDetail extends ScriptListItem {
	sourceContent: string;
}

export interface CreateScriptInput {
	title: string;
	sourceContent: string;
	genre?: string | null;
}

export interface UploadScriptInput {
	title: string;
	file: File;
	genre?: string | null;
}

export type TaskStatus = 'pending' | 'running' | 'done' | 'error' | 'canceling' | 'canceled';

export interface TaskInfo {
	id: string;
	status: TaskStatus;
	mode?: AnalyzeMode;
	startedAt?: string | null;
	finishedAt?: string | null;
	reportId?: string | null;
	errorMessage?: string | null;
	// 失败退款标记：refundCredits 写入，前端 AnalyzingTask 据此展示「已退回 2,000 积分」
	creditsRefunded?: boolean;
	// 后端 getStatus 同时返回（p00 同款：前端 AnalyzingTask 显示「当前文件」）
	fileName?: string | null;
}

export interface TaskEvent {
	type: string;
	nodeId?: string;
	nodeName?: string;
	message?: string;
	percent?: number;
	summary?: string;
	reportId?: string;
	// cover_done 事件携带的封面 URL
	// - coverUrl: 单值旧字段（历史事件兼容）
	// - coverUrls: 多候选 URL 数组（当前主路径，前端逐个渲染供用户挑选）
	coverUrl?: string;
	coverUrls?: string[];
	ts: number;
}

export interface TaskStatusResponse {
	task: TaskInfo;
	events: TaskEvent[];
	overall: number;
}

export interface ScriptReport {
	script: ScriptDetail;
	version: {
		id: string;
		versionNo: number;
		scoreDetails: ScoreDetails | null;
	};
	report: string;
}

// === Query Keys ===
export const scriptKeys = {
	all: ['scripts'] as const,
	list: () => [...scriptKeys.all, 'list'] as const,
	detail: (id: string) => [...scriptKeys.all, 'detail', id] as const,
	status: (scriptId: string, taskId: string) =>
		['scripts', 'status', scriptId, taskId] as const,
	report: (id: string) => [...scriptKeys.all, 'report', id] as const,
};

// === 纯请求函数 ===

export async function fetchScripts(): Promise<ScriptListItem[]> {
	const data = await request<{ items: ScriptListItem[] }>('/scripts');
	return data.items;
}

export async function fetchScript(id: string): Promise<ScriptDetail> {
	return request<ScriptDetail>(`/scripts/${id}`);
}

export async function fetchCreateScript(
	input: CreateScriptInput,
): Promise<ScriptDetail> {
	return request<ScriptDetail>('/scripts', {
		method: 'POST',
		data: input,
	});
}

export async function fetchUploadScript(
	input: UploadScriptInput,
): Promise<ScriptDetail> {
	const formData = new FormData();
	formData.append('file', input.file);
	formData.append('title', input.title);
	if (input.genre) formData.append('genre', input.genre);
	return request<ScriptDetail>('/scripts/upload', {
		method: 'POST',
		formData,
	});
}

export async function fetchDeleteScript(id: string): Promise<void> {
	await request<null>(`/scripts/${id}`, { method: 'DELETE' });
}

// 批量导出 PDF（zip 打包）：POST /scripts/batch-export-pdf → blob
// Why：后端用 fflate 把多个 PDF 打包成一个 zip，前端拿到 blob 触发下载
export async function fetchBatchExportPdf(
	scriptIds: string[],
): Promise<Blob> {
	const token = useAuthStore.getState().token;
	const res = await fetch(
		`${import.meta.env.VITE_API_BASE_URL ?? ''}/scripts/batch-export-pdf`,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			body: JSON.stringify({ scriptIds }),
		},
	);
	if (!res.ok) {
		throw new Error(`批量导出失败: ${res.status}`);
	}
	return res.blob();
}

export type AnalyzeMode = 'standard' | 'fast' | 'ultra';

export interface TriggerAnalysisParams {
	id: string;
	mode?: AnalyzeMode;
}

export async function fetchTriggerAnalysis(
	params: TriggerAnalysisParams,
): Promise<{ taskId: string; status: 'running'; mode: AnalyzeMode }> {
	const { id, mode } = params;
	return request(`/scripts/${id}/analyze`, {
		method: 'POST',
		data: mode ? { mode } : undefined,
	});
}

// 触发封面异步生成（后端串：generateImage count=3 → 循环 uploadImageFromUrl → 写 coverUrlCandidates）
// 前端复用 fetchTaskStatus 轮询 cover_done / cover_error 事件
export async function fetchTriggerCover(
	scriptId: string,
): Promise<{ taskId: string; status: 'pending' | 'running' }> {
	return request(`/scripts/${scriptId}/cover/generate`, { method: 'POST' });
}

// 选定封面（用户从候选中挑一张 → 写入 script.coverUrl）
// coverUrl 实为后端候选数组里的某个签名 URL，前端只需原样回传即可
export async function fetchSelectCover(
	scriptId: string,
	coverUrl: string,
): Promise<{ coverUrl: string }> {
	return request(`/scripts/${scriptId}/cover/select`, {
		method: 'POST',
		data: { coverUrl },
	});
}

export async function fetchTaskStatus(
	scriptId: string,
	taskId: string,
): Promise<TaskStatusResponse> {
	return request<TaskStatusResponse>(
		`/scripts/${scriptId}/status?taskId=${encodeURIComponent(taskId)}`,
	);
}

export async function fetchReport(id: string): Promise<ScriptReport> {
	return request<ScriptReport>(`/scripts/${id}/report`);
}

// 查剧本最近活跃任务（断点续传用）
// analyzeTask/coverTask 皆可能为 null（无活跃任务）
export interface ActiveTaskInfo {
	taskId: string;
	status: string;
	mode: AnalyzeMode;
	progress: number;
	startedAt?: string | null;
}

export interface ActiveTasksResult {
	analyzeTask: ActiveTaskInfo | null;
	coverTask: ActiveTaskInfo | null;
}

export async function fetchActiveTask(
	scriptId: string,
): Promise<ActiveTasksResult | null> {
	return request<ActiveTasksResult | null>(
		`/scripts/${scriptId}/active-task`,
	);
}

// 重试分析：用原 task 的 mode 触发新 task
export async function fetchRetryAnalysis(
	scriptId: string,
	taskId: string,
): Promise<{ taskId: string; status: 'running'; mode: AnalyzeMode }> {
	return request(`/scripts/${scriptId}/analyze/retry`, {
		method: 'POST',
		data: { taskId },
	});
}

// 停止运行中任务（用户主动取消）
export async function fetchStopAnalysis(
	scriptId: string,
	taskId: string,
): Promise<{ stopped: true; taskId: string }> {
	return request(`/scripts/${scriptId}/analyze/stop`, {
		method: 'POST',
		data: { taskId },
	});
}

// === React Query Hooks ===

export function useScripts() {
	return useQuery({
		queryKey: scriptKeys.list(),
		queryFn: fetchScripts,
		staleTime: 30 * 1000,
	});
}

export function useScript(id: string | undefined) {
	return useQuery({
		queryKey: id ? scriptKeys.detail(id) : ['scripts', 'detail'],
		queryFn: () => fetchScript(id!),
		enabled: Boolean(id),
		staleTime: 60 * 1000,
	});
}

export function useCreateScript() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: fetchCreateScript,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: scriptKeys.list() });
		},
	});
}

export function useUploadScript() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: fetchUploadScript,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: scriptKeys.list() });
		},
	});
}

export function useDeleteScript() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: fetchDeleteScript,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: scriptKeys.list() });
		},
	});
}

// 批量导出 PDF（zip）：不进 RQ 缓存，直接返回 blob
export function useBatchExportPdf() {
	return useMutation({
		mutationFn: fetchBatchExportPdf,
	});
}

export function useTriggerAnalysis() {
	return useMutation({
		mutationFn: fetchTriggerAnalysis,
	});
}

// 触发封面生成：成功后让 script detail 失效（worker 写完 coverUrl 后下次拉取拿最新）
export function useTriggerCover() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (scriptId: string) => fetchTriggerCover(scriptId),
		onSuccess: (_data, scriptId) => {
			queryClient.invalidateQueries({ queryKey: scriptKeys.detail(scriptId) });
		},
	});
}

// 选定封面：成功后让 report + detail 失效（报告页 Hero 立即刷新到新选中封面）
export function useSelectCover(scriptId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (coverUrl: string) => fetchSelectCover(scriptId, coverUrl),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: scriptKeys.detail(scriptId) });
			queryClient.invalidateQueries({ queryKey: scriptKeys.report(scriptId) });
		},
	});
}

// 查剧本最近活跃任务（断点续传 + History 卡片进度显示用）
// staleTime 5s：避免 History 页多卡片频繁刷新
// 任务 running 时每 5s 自动 refetch（progress 持续更新）
export function useActiveTask(scriptId: string | undefined) {
	return useQuery({
		queryKey: scriptId
			? ['scripts', scriptId, 'active-task']
			: ['scripts', 'active-task'],
		queryFn: () => fetchActiveTask(scriptId!),
		enabled: Boolean(scriptId),
		staleTime: 5 * 1000,
		refetchInterval: (query) => {
			const data = query.state.data;
			// analyze 或 cover 任一活跃任务在跑时每 5s 轮询（更新 progress）
			const active =
				data && (data.analyzeTask || data.coverTask);
			if (
				active &&
				((data.analyzeTask?.status === 'running' ||
					data.analyzeTask?.status === 'pending') ||
					(data.coverTask?.status === 'running' ||
						data.coverTask?.status === 'pending'))
			) {
				return 5000;
			}
			return false;
		},
		refetchIntervalInBackground: false,
	});
}

// 重试分析：用原 task 的 mode 触发新 task
export function useRetryAnalysis() {
	return useMutation({
		mutationFn: (params: { scriptId: string; taskId: string }) =>
			fetchRetryAnalysis(params.scriptId, params.taskId),
	});
}

// 停止运行中任务
export function useStopAnalysis() {
	return useMutation({
		mutationFn: (params: { scriptId: string; taskId: string }) =>
			fetchStopAnalysis(params.scriptId, params.taskId),
	});
}

// 任务状态轮询（1.8s 间隔，对齐 p00）
// done/error 后自动停止轮询
export function useTaskStatus(
	scriptId: string | undefined,
	taskId: string | undefined,
) {
	return useQuery({
		queryKey:
			scriptId && taskId
				? scriptKeys.status(scriptId, taskId)
				: ['scripts', 'status'],
		queryFn: () => fetchTaskStatus(scriptId!, taskId!),
		enabled: Boolean(scriptId && taskId),
		refetchInterval: (query) => {
			const data = query.state.data;
			if (!data?.task) return 1800;
			const status = data.task.status;
			// 终态：done / error / canceled 停止轮询
			// canceling 是过渡态（瞬态），保持轮询（worker 即将退出）
			if (status === 'done' || status === 'error' || status === 'canceled') {
				return false;
			}
			return 1800;
		},
		refetchIntervalInBackground: false,
	});
}

export function useReport(id: string | undefined) {
	return useQuery({
		queryKey: id ? scriptKeys.report(id) : ['scripts', 'report'],
		queryFn: () => fetchReport(id!),
		enabled: Boolean(id),
		staleTime: 5 * 60 * 1000,
	});
}
