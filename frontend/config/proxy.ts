import { ProxyOptions } from 'vite'

// vite dev proxy 配置
// -----------------------------------------------------------------------------
// 前端代码统一通过 VITE_API_BASE_URL=/api 调用接口（如 /api/auth/login）
// vite 把所有 /api/* 请求转发到后端（保留 /api 前缀）
// 后端 Hono 在 /api 下挂载所有业务路由（详见 backend/src/app.ts）
//
// 生产环境不需要这个：后端 Hono 直接 serve 前端 dist + 处理 /api/* API
const proxyConfig: Record<string, ProxyOptions> = {
	'/api': {
		// 后端真实地址（端口 5174，避开 macOS AirPlay 占用的 5000 和前端 vite 的 3000）
		target: 'http://localhost:5174',
		changeOrigin: true,
		// 不 rewrite：保留 /api 前缀（后端路由设计为 /api/auth/login 等）
	},
}

export default proxyConfig
