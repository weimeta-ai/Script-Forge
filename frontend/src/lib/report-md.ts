// 报告 markdown 渲染工具（从 p00/app/app/report/[id]/page.tsx 抽出）
// -----------------------------------------------------------------------------
// 职责：
//   - normalizeReportMarkdown  去掉 LLM 生成的报告大标题与 quote（与页头/页脚重复）
//   - stripDisclaimerHtml      去掉 LLM 自行生成的免责声明（页脚已有）
//   - addAnchors               给 h1-h4 注入 id，并抽取 TOC（h1-h3，过滤通用标题）
//   - slugify                  中文友好的 slug（保留汉字）
// =============================================================================
// 与 p00 实现：逐字一致

export type TocItem = { id: string; level: number; text: string };

export function normalizeReportMarkdown(md: string): string {
	return md
		.replace(/^#\s*[《〈<]?短剧商业潜力评估报告[》〉>]?\s*\n+/gim, '')
		.replace(/^>\s*AI智能诊断[^\n]*\n+/gim, '')
		// 罗马数字章节标记自动补 ## 前缀
		// 兼容管理员写 "I. xxx"（无 ##）的格式，让 marked 渲染为 <h2> 并进入右侧 TOC
		// 覆盖 I-X 常见章节范围；行首匹配，不误伤正文里的 "I. xxx" 行内引用
		.replace(/^(I{1,3}|IV|V|VI{0,3}|IX|X)\.\s+(.+)$/gm, '## $1. $2')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

export function stripDisclaimerHtml(html: string): string {
	return html.replace(
		/<p>\s*<em>\s*本报告由\s*AI[^<]*?(仅供参考|结合专业|生成)[^<]*?<\/em>\s*<\/p>/gi,
		'',
	);
}

export function addAnchors(html: string): { html: string; toc: TocItem[] } {
	const toc: TocItem[] = [];
	let counter = 0;

	const newHtml = html.replace(/<(h[1-4])>(.*?)<\/\1>/g, (_, tag, inner) => {
		const textMatch = inner.match(/^([^<]*?)(<|$)/);
		const text = (textMatch ? textMatch[1] : inner)
			.replace(/<[^>]+>/g, '')
			.trim();
		const level = parseInt(tag[1], 10);
		if (!text) return `<${tag}>${inner}</${tag}>`;

		counter++;
		const id = `h-${counter}-${slugify(text)}`;
		if (
			level <= 3 &&
			!isGenericReportHeading(text) &&
			!toc.some((item) => item.text === text && item.level === level)
		) {
			toc.push({ id, level, text });
		}

		return `<${tag} id="${id}" data-anchor>${inner}</${tag}>`;
	});

	return { html: newHtml, toc };
}

export function slugify(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^一-龥a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 40);
}

function isGenericReportHeading(text: string): boolean {
	return /短剧商业潜力评估报告/.test(text);
}

// 评级颜色映射（与 p00 gradeColor 一致）
export function gradeColor(grade?: string | null): string {
	if (!grade) return '#B8443C';
	if (grade.startsWith('S')) return '#B8443C';
	if (grade.startsWith('A')) return '#B8443C';
	if (grade.startsWith('B')) return '#7F6B5B';
	if (grade.startsWith('C')) return '#B8443C';
	if (grade.startsWith('D')) return '#B8443C';
	return '#B8443C';
}
