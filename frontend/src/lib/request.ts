// 基于 fetch 的通用请求封装
// - 业务层用相对路径走 vite proxy；外部 API 用完整 URL
// - 自动注入 JWT token（从 auth store 读）
// - 401 自动登出并跳登录页
// - 统一 JSON 解析 + 错误抛出（React Query 会 catch 并塞到 error 状态）

import { useAuthStore } from '../store/auth';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

// 业务错误（区别于网络/HTTP 错误）
// - status：HTTP 状态码
// - code：业务错误码（如 'UNAUTHORIZED' 'USER_NOT_FOUND'）
// - message：错误信息（直接展示给用户）
// - details：结构化错误详情（如批量上传时每个失败文件的原因）
export class RequestError extends Error {
	public status: number;
	public code?: string;
	public details?: unknown;

	constructor(status: number, message: string, code?: string, details?: unknown) {
		super(message);
		this.name = 'RequestError';
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

export interface RequestOptions extends RequestInit {
	// 业务层可通过 data 传 JSON body，自动序列化
	data?: unknown;
	// 上传文件时传 FormData，浏览器自动加 multipart/form-data boundary
	formData?: FormData;
	// 是否自动注入 Authorization 头（默认 true）
	// 调登录接口时设为 false（避免把旧 token 带上）
	withAuth?: boolean;
}

export async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
	const { data, formData, headers, withAuth = true, ...rest } = options;

	// 用 Headers 构造器统一处理 HeadersInit 的多种形式（对象 / 数组 / Headers 实例）
	const finalHeaders = new Headers(headers);
	let body = rest.body;

	if (formData) {
		// FormData：不能手动设 Content-Type，浏览器会自动加 multipart boundary
		body = formData;
	} else if (data !== undefined) {
		finalHeaders.set('Content-Type', 'application/json');
		body = JSON.stringify(data);
	}

	// 自动注入 JWT token
	// 注意：这里用 useAuthStore.getState() 而不是 useAuthStore hook
	// 因为 request 是普通函数，不是 React 组件，不能用 hook
	// getState() 是 zustand 提供的"非 React 入口"，随时可调用
	if (withAuth) {
		const token = useAuthStore.getState().token;
		if (token) {
			finalHeaders.set('Authorization', `Bearer ${token}`);
		}
	}

	const response = await fetch(`${BASE_URL}${url}`, {
		...rest,
		headers: finalHeaders,
		body,
	});

	// 401：token 失效或缺失，自动登出 + 跳登录页
	// 这里的副作用是统一的，避免每个业务层都处理 401
	if (response.status === 401 && withAuth) {
		useAuthStore.getState().clearAuth();
		// 不在这里直接跳转，由路由守卫根据 auth 状态决定
		// 触发 window 事件让 router 重新评估
		window.dispatchEvent(new CustomEvent('auth:unauthorized'));
	}

	if (!response.ok) {
		// 尝试解析后端的错误响应（{ code, message, data }）
		let errorMessage = `请求失败: ${response.status}`;
		let errorCode: string | undefined;
		let errorDetails: unknown;
		try {
			const errorBody = await response.json();
			if (errorBody?.message) errorMessage = errorBody.message;
			if (errorBody?.code) errorCode = String(errorBody.code);
			if (errorBody?.data !== null && errorBody?.data !== undefined) {
				errorDetails = errorBody.data;
			}
		} catch {
			// 响应不是 JSON（如 Nginx 502 HTML 页面），用默认 message
		}
		throw new RequestError(response.status, errorMessage, errorCode, errorDetails);
	}

	const json = await response.json();

	// 后端统一响应格式（envelope）：{ code, data, message }
	// - code === 0：成功，业务层只需要 data 字段，自动 unwrap
	// - code !== 0：业务错误（HTTP 200 但业务失败），抛 RequestError
	// - 非标准格式（无 code 字段）：原样返回（兼容第三方 API）
	if (json && typeof json === 'object' && 'code' in json) {
		if (json.code !== 0) {
			throw new RequestError(
				response.status,
				json.message ?? '请求失败',
				String(json.code),
				json.data,
			);
		}
		return json.data as T;
	}

	return json as T;
}
