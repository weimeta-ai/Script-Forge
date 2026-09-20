// 登录页轮播图类型定义
// 与后端 services/login-banner.service.ts 的 PublicBanner / AdminBanner 对齐

// 公开接口（登录页用）：仅返回展示必需字段
export interface LoginBanner {
	id: string;
	title: string | null;
	imageUrl: string;
}

// Admin 接口（后台管理用）：包含完整字段
export interface AdminLoginBanner extends LoginBanner {
	ossKey: string;
	sortOrder: number;
	isActive: boolean;
	uploadedBy: string;
	createdAt: string;
	updatedAt: string;
}

// PATCH /login-banners/:id 入参（所有字段可选）
export interface UpdateBannerInput {
	title?: string | null;
	sortOrder?: number;
	isActive?: boolean;
}
