// Prompt 话术客户端校验（与服务端 prompt-config.service.ts 的 validatePromptContent 同口径）
// report_system 不做结构限制：报告结构由 NODE_SKELETON 骨架强制重建兜底，
// 元数据抽取由 report-extract.ts 中英文多策略容错兜底，任意话术均可保存
import type { PromptType } from '../types/prompt-config';

// 返回 null 表示通过，否则返回错误文案
export function validatePromptContent(
	type: PromptType,
	content: string
): string | null {
	if (!content.trim()) {
		return '内容不能为空';
	}
	if (type === 'cover_template' && !content.includes('{{title}}')) {
		return '封面模板必须包含 {{title}} 占位符';
	}
	return null;
}
