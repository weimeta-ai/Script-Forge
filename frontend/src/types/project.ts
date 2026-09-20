// 项目相关类型（与后端 projects 表对齐）
// 5b 仅暴露业务用得到的字段；referenceScriptIds / evaluationProfile 暂不开放编辑

export type ProjectStatus = 'active' | 'archived' | 'deleted';

// 评估配置（5b 用默认值，5e 评分引擎读取）
export interface EvaluationProfile {
	samplingCount: number;
	temperature: number;
	promptVersion: string;
	dimensionsMode: 'independent' | 'unified';
}

// 项目对象（后端 Project 类型）
export interface Project {
	id: string;
	userId: string;
	name: string;
	genre: string;
	description: string | null;
	referenceScriptIds: string[];
	evaluationProfile: EvaluationProfile;
	status: ProjectStatus;
	createdAt: string;
	updatedAt: string;
	// 以下为前端预留字段（后端待加）：
	// coverUrl — 封面图，导出阶段（cover stage）完成时生成并写入
	// scriptCount — 关联剧本数（aggregate）
	// latestScore — 最新 V2 评分（aggregate）
	coverUrl?: string | null;
	scriptCount?: number;
	latestScore?: number | null;
}

// 创建项目请求体（genre 必填，评分流程依赖题材匹配）
export interface CreateProjectInput {
	name: string;
	genre: string;
	description?: string;
}
