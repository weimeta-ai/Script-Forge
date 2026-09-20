// 报告 markdown 渲染器（p00 同款：marked + DOMPurify + addAnchors）
// -----------------------------------------------------------------------------
// 切换说明：
//   - 旧版：react-markdown + remark-gfm + rehype-slug（CJK 加粗 bug 未修复）
//   - 新版：marked + DOMPurify + cjkStrongExtension（与 p00 完全对齐）
//   - TOC 已上提到 Report 页右侧栏，本组件只负责渲染 html
// =============================================================================

import { useEffect, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { marked, configureMarked } from '../lib/marked-config';
import {
	normalizeReportMarkdown,
	stripDisclaimerHtml,
	addAnchors,
} from '../lib/report-md';

interface Props {
	content: string;
}

export function MarkdownReport({ content }: Props) {
	// 配置 marked（cjkStrongExtension 等扩展，幂等）
	useEffect(() => {
		configureMarked();
	}, []);

	// 同步渲染（marked + DOMPurify 都是同步 API）
	const cleanHtml = useMemo(() => {
		if (!content.trim()) return '';
		const normalized = normalizeReportMarkdown(content);
		const rendered = marked.parse(normalized, { async: false }) as string;
		const noDisclaimer = stripDisclaimerHtml(rendered);
		const sanitized = DOMPurify.sanitize(noDisclaimer, {
			ADD_ATTR: ['target', 'id'],
		});
		const { html } = addAnchors(sanitized);
		return html;
	}, [content]);

	if (!cleanHtml) return null;

	return (
		<div
			className="report-body"
			dangerouslySetInnerHTML={{ __html: cleanHtml }}
		/>
	);
}
