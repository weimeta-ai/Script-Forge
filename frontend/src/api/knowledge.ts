// 知识库样本 API（5c 阶段）
// -----------------------------------------------------------------------------
// 设计：纯请求函数 + React Query hooks 双层（仿 projects.ts）
// 4 个接口：
//   GET    /knowledge/samples         admin 列表
//   POST   /knowledge/samples/batch   admin 批量导入
//   DELETE /knowledge/samples/:id     admin 软删
//   GET    /knowledge/samples/search  user 检索（5e 评分引擎用）
// -----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../lib/request';
import type {
	BatchImportInput,
	BatchImportResult,
	KnowledgeListResponse,
	KnowledgeSample,
	ListKnowledgeQuery,
	SearchKnowledgeQuery,
} from '../types/knowledge';

// === Query Keys ===
export const knowledgeKeys = {
	all: ['knowledge'] as const,
	list: (query: ListKnowledgeQuery) => ['knowledge', 'list', query] as const,
	search: (query: SearchKnowledgeQuery) => ['knowledge', 'search', query] as const,
};

// === 纯请求函数 ===

export async function fetchKnowledgeSamples(
	query: ListKnowledgeQuery,
): Promise<KnowledgeListResponse> {
	const qs = new URLSearchParams();
	qs.set('page', String(query.page));
	qs.set('pageSize', String(query.pageSize));
	if (query.genre) qs.set('genre', query.genre);
	if (query.grade) qs.set('grade', query.grade);
	return request<KnowledgeListResponse>(`/knowledge/samples?${qs.toString()}`);
}

export async function fetchBatchImport(input: BatchImportInput): Promise<BatchImportResult> {
	return request<BatchImportResult>('/knowledge/samples/batch', {
		method: 'POST',
		data: input,
	});
}

export async function fetchDeleteKnowledgeSample(id: string): Promise<void> {
	await request<null>(`/knowledge/samples/${id}`, { method: 'DELETE' });
}

export async function fetchSearchKnowledgeSamples(
	query: SearchKnowledgeQuery,
): Promise<KnowledgeSample[]> {
	const qs = new URLSearchParams();
	qs.set('genre', query.genre);
	qs.set('limit', String(query.limit));
	if (query.grade) qs.set('grade', query.grade);
	return request<KnowledgeSample[]>(`/knowledge/samples/search?${qs.toString()}`);
}

// === React Query Hooks ===

// admin: 列表查询（支持 genre/grade 过滤 + 分页）
export function useKnowledgeSamples(query: ListKnowledgeQuery) {
	return useQuery({
		queryKey: knowledgeKeys.list(query),
		queryFn: () => fetchKnowledgeSamples(query),
		staleTime: 30 * 1000,
	});
}

// admin: 批量导入
// 成功后失效列表缓存
export function useBatchImport() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: fetchBatchImport,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
		},
	});
}

// admin: 软删
// 成功后失效列表缓存
export function useDeleteKnowledgeSample() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: fetchDeleteKnowledgeSample,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
		},
	});
}
