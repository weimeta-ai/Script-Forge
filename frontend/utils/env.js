/**
 * 环境工具函数
 * 用于动态获取当前部署环境的地址信息
 */

/**
 * 获取当前页面的基础 URL
 * 自动适配 http/https 协议和当前主机
 * @returns {string} 基础 URL (如: http://localhost:3000 或 https://example.com)
 */
export const getBaseUrl = () => {
	if (typeof window === 'undefined') {
		// 服务端渲染情况
		return '';
	}

	const protocol = window.location.protocol;
	const host = window.location.host;
	return `${protocol}//${host}`;
};

/**
 * 获取 WebSocket 服务器地址
 * 优先级: 环境变量 > 构建配置 > 动态获取
 * @param {number|string} port - 端口号(可选)
 * @returns {string} WebSocket 服务器地址
 */
export const getWsServerUrl = (port) => {
	// 1. 优先使用全局配置(通过 define 注入)
	if (typeof CRAWLER_WS_BASE_URL !== 'undefined' && CRAWLER_WS_BASE_URL) {
		return CRAWLER_WS_BASE_URL;
	}

	// 2. 使用环境变量(构建时)
	if (process.env.REACT_APP_CRAWLER_WS_BASE_URL) {
		return process.env.REACT_APP_CRAWLER_WS_BASE_URL;
	}

	// 3. 动态获取当前地址
	const baseUrl = getBaseUrl();

	// 判断是否为本地开发环境（localhost 或 127.0.0.1）
	if (typeof window !== 'undefined') {
		const host = window.location.hostname;
		const isLocalDev = host === 'localhost' || host === '127.0.0.1';

		// 本地开发环境：使用内网服务器地址
		if (isLocalDev) {
			return 'http://192.168.11.98:8380';
		}
	}

	// 如果指定了端口,替换当前端口
	if (port) {
		const url = new URL(baseUrl);
		url.port = port.toString();
		return url.toString();
	}

	// 否则返回当前地址(适用于前后端同域部署)
	return baseUrl;
};

/**
 * 获取 API 基础地址
 * @returns {string} API 服务器地址
 */
export const getApiBaseUrl = () => {
	// 1. 优先使用环境变量
	if (process.env.REACT_APP_API_BASE_URL) {
		return process.env.REACT_APP_API_BASE_URL;
	}

	// 2. 动态获取当前地址
	return getBaseUrl();
};

/**
 * 判断当前环境
 * @returns {string} 'development' | 'production'
 */
export const getEnvironment = () => {
	return process.env.NODE_ENV || 'development';
};

/**
 * 判断是否为开发环境
 * @returns {boolean}
 */
export const isDevelopment = () => {
	return getEnvironment() === 'development';
};

/**
 * 判断是否为生产环境
 * @returns {boolean}
 */
export const isProduction = () => {
	return getEnvironment() === 'production';
};
