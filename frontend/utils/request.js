import { clearAuthority, getToken, setAuthority, setToken } from '@/utils/authority';
import { notification } from 'antd';
import { fetch } from 'dva';
import { history } from 'umi';

const codeMessage = {
	200: '服务器成功返回请求的数据。',
	201: '新建或修改数据成功。',
	202: '一个请求已经进入后台排队（异步任务）。',
	204: '删除数据成功。',
	400: '发出的请求有错误，服务器没有进行新建或修改数据的操作。',
	401: '用户没有权限（令牌、用户名、密码错误）。',
	403: '用户得到授权，但是访问是被禁止的。',
	404: '发出的请求针对的是不存在的记录，服务器没有进行操作。',
	406: '请求的格式不可得。',
	410: '请求的资源被永久删除，且不会再得到的。',
	422: '当创建一个对象时，发生一个验证错误。',
	500: '服务器发生错误，请检查服务器。',
	502: '网关错误。',
	503: '服务不可用，服务器暂时过载或维护。',
	504: '网关超时。'
};

const loginOut = () => {
	clearAuthority();
	if (window.location.pathname !== '/user/login') {
		window.location.href = '/user/login';
	}
};

const checkStatus = (response) => {
	if (response.status >= 200 && response.status < 300) {
		return response;
	}
	const errortext = codeMessage[response.status] || response.statusText;

	const error = new Error(errortext);
	error.name = String(response.status);
	error.response = response;

	throw error;
};

/**
 * Requests a URL, returning a promise.
 *
 * @param  {string} url       The URL we want to request
 * @param  {object} [option] The options we want to pass to "fetch"
 * @return {object}           An object containing either "data" or "err"
 */
/**
 * 将对象转换为 URL 查询字符串
 * @param {object} obj - 要转换的对象
 * @returns {string} - 查询字符串（不包含 ?）
 */
function objectToQueryString(obj) {
	if (!obj) return '';
	return Object.keys(obj)
		.map(key => {
			const value = obj[key];
			if (value === undefined || value === null) return '';
			return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
		})
		.filter(Boolean)
		.join('&');
}

export default function request(url, option) {
	const { responseType, ...restOption } = option || {};
	const options = {
		...restOption
	};
	const defaultOptions = {
		credentials: 'include'
	};
	const newOptions = { ...defaultOptions, ...options };

	// 处理 GET 请求的 params 参数，将参数序列化到 URL
	if (newOptions.params) {
		const queryString = objectToQueryString(newOptions.params);
		if (queryString) {
			const separator = url.includes('?') ? '&' : '?';
			url = `${url}${separator}${queryString}`;
		}
		delete newOptions.params;
	}

	if (
		newOptions.method === 'POST' ||
		newOptions.method === 'PUT' ||
		newOptions.method === 'DELETE' ||
		newOptions.method === 'PATCH'
	) {
		if (!(newOptions.body instanceof FormData)) {
			newOptions.headers = {
				Accept: 'application/json',
				'Content-Type': 'application/json; charset=utf-8',
				...newOptions.headers
			};
			const token = getToken();
			if (token) {
				newOptions.headers['Authorization'] = `Bearer ${token}`;
			}
			newOptions.body = JSON.stringify(newOptions.body);
		} else {
			// newOptions.body is FormData
			const token = getToken();
			newOptions.headers = {
				Accept: 'application/json',
				...newOptions.headers
			};
			if (token) {
				newOptions.headers['Authorization'] = `Bearer ${token}`;
			}
		}
	} else {
		const token = getToken();
		if (token) {
			newOptions.headers = {
				...newOptions.headers,
				Authorization: `Bearer ${token}`,
				'Cache-Control': 'no-cache',
			};
		}
	}

	return fetch(url, newOptions)
		.then(checkStatus)
		.then((response) => {
			// Blob 响应（PDF 下载等）
			if (responseType === 'blob') {
				return response.blob();
			}
			// DELETE and 204 do not return data by default
			// using .json will report an error.
			if (response.status === 204) {
				return response.text();
			}
			return response.json();
		})
		.then((data) => {
			// Blob 响应直接返回，不检查业务码
			if (data instanceof Blob) {
				return data;
			}
			// 检查业务状态码（HTTP 200 但 code !== 0 表示业务错误）
			if (typeof data === 'object' && data !== null && data.code !== undefined && data.code !== 0) {
				const error = new Error(data.message || '业务错误');
				error.code = data.code;
				throw error;
			}
			return data;
		})
		.catch(async (e) => {
			// Blob 类型直接抛出（不需要额外处理）
			if (e instanceof Blob) {
				throw e;
			}

			// e 是 Error 对象，e.name 是 HTTP 状态码字符串
			const status = parseInt(e.name, 10) || 0;

			// 401: 未授权，清除登录状态并跳转
			if (status === 401) {
				loginOut();
				return;
			}

			// 403: 禁止访问
			if (status === 403) {
				notification.error({
					message: '没有权限',
					description: '您没有权限执行此操作，请联系管理员',
					duration: 4
				});
				throw e;
			}

			// 400: 请求参数错误，提取后端错误消息
			if (status === 400) {
				if (e.response) {
					try {
						const body = await e.response.clone().json();
						const serverMsg = body?.message || body?.error;
						if (serverMsg) {
							e.message = serverMsg;
						}
					} catch (_) {}
				}
				notification.error({
					message: '请求参数错误',
					description: e.message || '请检查输入是否正确',
					duration: 4
				});
				throw e;
			}

			// 404: 资源未找到（不显示通知，由业务层处理）
			if (status === 404) {
				throw e;
			}

			// 500+: 提取后端错误信息并提示用户
			if (status >= 500 && e.response) {
				try {
					const body = await e.response.clone().json();
					const serverMsg = body?.error || body?.message;
					if (serverMsg) {
						e.message = serverMsg;
					}
				} catch (_) {
					// response body 无法解析，使用原始错误信息
				}
				notification.error({
					message: '服务器错误',
					description: e.message || '服务器发生错误，请稍后重试',
					duration: 4
				});
				throw e;
			}

			// 业务错误码抛出的错误（code !== 0），展示后端消息
			if (e.code && !status) {
				notification.error({
					message: '操作失败',
					description: e.message,
					duration: 4
				});
				throw e;
			}

			// 网络错误或其他异常（如 fetch 失败、超时等）
			if (!status && e.message) {
				notification.error({
					message: '网络错误',
					description: '请检查网络连接后重试',
					duration: 4
				});
				throw e;
			}

			// 其他未处理的错误，统一抛出由业务层处理
			throw e;
		});
}
