// 知识库样本类型（5c 阶段，与后端 knowledge_samples 表对齐）
// -----------------------------------------------------------------------------
// 注意：overallScore 是 Drizzle decimal 类型，JSON 序列化为 string
//      （前端展示用 Number() 转换，提交用 number）

export type KnowledgeGrade = 'A' | 'B' | 'C' | 'D';

// 知识库样本对象（后端 KnowledgeSample）
export interface KnowledgeSample {
	id: string;
	title: string;
	genre: string;
	grade: KnowledgeGrade;
	overallScore: string | null; // decimal 序列化为 string
	sixDimensions: Record<string, number> | null;
	summary: string;
	highlights: string[];
	sourceType: string;
	isActive: boolean;
	createdAt: string;
	updatedAt: string;
}

// 单条样本的输入（用于批量导入数组项）
export interface KnowledgeSampleInput {
	title: string;
	genre: string;
	grade: KnowledgeGrade;
	overallScore?: number;
	sixDimensions?: Record<string, number>;
	summary: string;
	highlights?: string[];
}

// 批量导入请求体
export interface BatchImportInput {
	samples: KnowledgeSampleInput[];
}

// 批量导入响应
export interface BatchImportResult {
	inserted: number;
}

// 列表查询参数
export interface ListKnowledgeQuery {
	genre?: string;
	grade?: KnowledgeGrade;
	page: number;
	pageSize: number;
}

// 列表响应（后端 { items, total } 结构）
export interface KnowledgeListResponse {
	items: KnowledgeSample[];
	total: number;
}

// 检索查询参数（5e 用）
export interface SearchKnowledgeQuery {
	genre: string;
	grade?: KnowledgeGrade;
	limit: number;
}
