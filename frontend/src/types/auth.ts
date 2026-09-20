// 用户与鉴权相关类型定义
// 与后端 schema 对齐（src/db/schema/users.ts 的 User 类型）
// 单独抽出到 types/ 目录，方便 api 层和 store 层共享

export type UserRole = 'admin' | 'user';

// 用户偏好（暗黑模式 / 字号等，前端设置页用）
export interface UserPreferences {
	theme: 'light' | 'dark';
	fontSize: 'small' | 'medium' | 'large';
}

// 用户对象（脱敏后，不含 passwordHash）
export interface User {
	id: string;
	username: string;
	displayName: string;
	role: UserRole;
	preferences: UserPreferences;
	createdAt: string;
	updatedAt: string;
}

// 登录请求体
export interface LoginInput {
	username: string;
	password: string;
}

// 注册请求体
export interface RegisterInput {
	username: string;
	password: string;
	displayName?: string;
}

// 登录/注册响应：返回 user + token
export interface AuthResponse {
	user: User;
	token: string;
}
