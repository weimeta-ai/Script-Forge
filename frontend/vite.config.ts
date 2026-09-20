import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
// 代理配置位于项目根目录的 config 目录下
import proxyConfig from './config/proxy';

export default defineConfig({
	plugins: [react(), tailwindcss()],
	server: {
		port: 3000,
		open: true,
		proxy: proxyConfig, // 挂载代理
	},
});
