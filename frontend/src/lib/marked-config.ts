// marked 配置 - 修复 marked v13+ 中 **中文：**xxx 紧邻不被识别为加粗的 bug
// -----------------------------------------------------------------------------
// 从 p00/lib/marked-config.ts 移植，逐字一致
// 关键修复：cjkStrongExtension 自定义 token，让 **可打磨点：** 这类含 CJK 标点的加粗生效
// =============================================================================
import { marked, type MarkedExtension, type Tokens } from 'marked';

// CJK 标点符号集 - 这些字符可以作为加粗文本的边界
const CJK_PUNCTUATION = '：；，、。！？：（）()【】《》〈〉「」『』';

const cjkStrongExtension = {
	name: 'cjkStrong',
	level: 'inline',
	start(src: string) {
		const idx = src.search(
			new RegExp(`\\*\\*[^*\\n]*[${CJK_PUNCTUATION}][^*\\n]*\\*\\*`),
		);
		return idx === -1 ? undefined : idx;
	},
	tokenizer(src: string) {
		const re = new RegExp(
			`^(\\*\\*[^*\\n]*[${CJK_PUNCTUATION}][^*\\n]*\\*\\*)`,
		);
		const m = src.match(re);
		if (m) {
			const raw = m[1];
			const inner = raw.slice(2, -2);
			return {
				type: 'strong',
				raw,
				text: inner,
				tokens: [
					{
						type: 'text',
						raw: inner,
						text: inner,
					} as Tokens.Text,
				],
			} as unknown as Tokens.Strong;
		}
		return undefined;
	},
} as unknown as MarkedExtension;

// 单次注册（避免 hot reload 时重复）
let registered = false;
export function configureMarked() {
	if (registered) return;
	marked.use({
		extensions: [cjkStrongExtension],
		gfm: true,
		breaks: false,
	});
	registered = true;
}

export { marked };
