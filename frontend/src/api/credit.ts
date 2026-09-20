// 积分模块 API（admin + 用户端）
// -----------------------------------------------------------------------------
// admin 端：
//   POST /admin/users/:id/credits/adjust        调整积分（充值/扣减）
//   GET  /admin/users/:id/credits/transactions  用户流水
//   GET  /admin/credit-rules                    规则列表
//   POST /admin/credit-rules                    创建规则
//   PATCH /admin/credit-rules/:id               更新规则
//   DELETE /admin/credit-rules/:id              删除规则
//
// 用户端：
//   GET  /credits/balance                       查自身余额
//   GET  /credits/transactions                  查自身流水
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../lib/request';
import { adminUserKeys } from './admin-users';
import type {
	AdjustCreditsInput,
	AdjustCreditsResult,
	CreateRuleInput,
	CreditBalance,
	CreditRule,
	ListCreditRulesResponse,
	ListTransactionsQuery,
	ListTransactionsResponse,
	UpdateRuleInput,
} from '../types/credit';

// -----------------------------------------------------------------------------
// Query Key 工厂
// -----------------------------------------------------------------------------
export const creditKeys = {
	all: ['credit'] as const,
	balance: () => ['credit', 'balance'] as const,
	transactions: (q: ListTransactionsQuery) => ['credit', 'transactions', q] as const,
};

export const adminCreditKeys = {
	rules: () => ['admin', 'credit-rules'] as const,
	userTransactions: (userId: string, q: ListTransactionsQuery) =>
		['admin', 'users', userId, 'credits', q] as const,
};

// -----------------------------------------------------------------------------
// 纯请求函数
// -----------------------------------------------------------------------------

// admin 调整积分
export async function adjustUserCredits(
	userId: string,
	input: AdjustCreditsInput,
): Promise<AdjustCreditsResult> {
	return request<AdjustCreditsResult>(`/admin/users/${userId}/credits/adjust`, {
		method: 'POST',
		data: input,
	});
}

// admin 查用户流水
export async function listUserCreditTransactions(
	userId: string,
	query: ListTransactionsQuery = {},
): Promise<ListTransactionsResponse> {
	const params = new URLSearchParams();
	if (query.type) params.set('type', query.type);
	if (query.refTaskId) params.set('refTaskId', query.refTaskId);
	if (query.page) params.set('page', String(query.page));
	if (query.pageSize) params.set('pageSize', String(query.pageSize));
	const qs = params.toString();
	return request<ListTransactionsResponse>(
		`/admin/users/${userId}/credits/transactions${qs ? `?${qs}` : ''}`,
	);
}

// admin 规则列表
export async function listCreditRules(): Promise<ListCreditRulesResponse> {
	return request<ListCreditRulesResponse>(`/admin/credit-rules`);
}

export async function createCreditRule(input: CreateRuleInput): Promise<CreditRule> {
	return request<CreditRule>(`/admin/credit-rules`, { method: 'POST', data: input });
}

export async function updateCreditRule(id: string, input: UpdateRuleInput): Promise<CreditRule> {
	return request<CreditRule>(`/admin/credit-rules/${id}`, { method: 'PATCH', data: input });
}

export async function deleteCreditRule(id: string): Promise<void> {
	await request<void>(`/admin/credit-rules/${id}`, { method: 'DELETE' });
}

// 用户端：查自身余额
export async function getMyBalance(): Promise<CreditBalance> {
	return request<CreditBalance>(`/credits/balance`);
}

// 用户端：查自身流水
export async function listMyTransactions(
	query: ListTransactionsQuery = {},
): Promise<ListTransactionsResponse> {
	const params = new URLSearchParams();
	if (query.type) params.set('type', query.type);
	if (query.refTaskId) params.set('refTaskId', query.refTaskId);
	if (query.page) params.set('page', String(query.page));
	if (query.pageSize) params.set('pageSize', String(query.pageSize));
	const qs = params.toString();
	return request<ListTransactionsResponse>(`/credits/transactions${qs ? `?${qs}` : ''}`);
}

// -----------------------------------------------------------------------------
// React Query Hooks
// -----------------------------------------------------------------------------

// admin 调整积分
export function useAdjustUserCredits(userId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: AdjustCreditsInput) => adjustUserCredits(userId, input),
		onSuccess: () => {
			// 失效：用户详情（含 creditBalance）、用户列表、该用户流水
			queryClient.invalidateQueries({ queryKey: adminUserKeys.detail(userId) });
			queryClient.invalidateQueries({ queryKey: adminUserKeys.all });
			queryClient.invalidateQueries({
				queryKey: ['admin', 'users', userId, 'credits'],
			});
		},
	});
}

// admin 查用户流水
export function useUserCreditTransactions(userId: string, query: ListTransactionsQuery) {
	return useQuery({
		queryKey: adminCreditKeys.userTransactions(userId, query),
		queryFn: () => listUserCreditTransactions(userId, query),
		enabled: !!userId,
		staleTime: 10 * 1000,
	});
}

// admin 规则列表
export function useCreditRules() {
	return useQuery({
		queryKey: adminCreditKeys.rules(),
		queryFn: listCreditRules,
		staleTime: 60 * 1000,
	});
}

export function useCreateCreditRule() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: createCreditRule,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: adminCreditKeys.rules() });
		},
	});
}

export function useUpdateCreditRule(id: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: UpdateRuleInput) => updateCreditRule(id, input),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: adminCreditKeys.rules() });
		},
	});
}

export function useDeleteCreditRule() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: deleteCreditRule,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: adminCreditKeys.rules() });
		},
	});
}

// 用户端：自身余额
export function useMyBalance() {
	return useQuery({
		queryKey: creditKeys.balance(),
		queryFn: getMyBalance,
		staleTime: 10 * 1000,
	});
}

// 用户端：自身流水
export function useMyTransactions(query: ListTransactionsQuery) {
	return useQuery({
		queryKey: creditKeys.transactions(query),
		queryFn: () => listMyTransactions(query),
		staleTime: 10 * 1000,
	});
}
