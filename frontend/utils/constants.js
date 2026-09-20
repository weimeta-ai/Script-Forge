/**
 * 全局常量配置
 * 统一管理项目中的常量，避免魔法数字和硬编码
 */


// ==================== 颜色主题 ====================
export const COLORS = {
	// 品牌色 - 与 config.js theme 保持一致
	PRIMARY: '#3B82F6',
	SUCCESS: '#10B981',
	WARNING: '#F59E0B',
	ERROR: '#EF4444',
	INFO: '#06B6D4',

	// 功能色
	LINK: '#5B8FF9',
	PRICE: '#F5222D',
	DISABLED: '#D9D9D9',

	// 状态色
	ACTIVE: '#52C41A',
	INACTIVE: '#D9D9D9',
	PENDING: '#FAAD14',
	PROCESSING: '#1890FF',

	// 业务补充色
	PURPLE: '#722ed1',
	MUTED: '#8c8c8c',
	HINT: '#999',
	GREEN_BRIGHT: '#52c41a',
	ORANGE_BRIGHT: '#fa8c16',
	RED_BRIGHT: '#ff4d4f',
	RED_PRICE: '#f5222d',
	BLUE_ANT: '#1890ff',
	TEXT_SECONDARY: '#595959',
	BG_PLACEHOLDER: '#f5f5f5',
	BORDER_DASHED: '#d9d9d9',
};

// ==================== 卡片样式常量 ====================
export const CARD_STYLES = {
	FONT_SIZE: {
		PRIMARY: 16,
		EMPHASIS: 17,
		LARGE: 24,
		SECONDARY: '13px',
	},
	FONT_WEIGHT: {
		NORMAL: 400,
		MEDIUM: 500,
		SEMIBOLD: 600,
		BOLD: 700,
	},
	SPACING: {
		XS: 2,
		SM: 4,
		MD: 8,
		LG: 12,
	},
};

// ==================== 卡片预组合样式 ====================
export const CARD_TEXT_STYLES = {
	// 单号
	postingNumber: { fontFamily: 'monospace', fontSize: 16, fontWeight: 600, color: '#1890ff' },
	// SKU / 产品ID 等次要文本
	secondaryText: { fontSize: 16, color: '#595959' },
	// Offer ID
	offerId: { fontSize: 16, color: '#722ed1' },
	// 国内单号
	domesticOrderNo: { fontSize: 16, color: '#52c41a' },
	// 静默文本（店铺、物流名等）
	mutedText: { fontSize: 16, color: '#8c8c8c' },
	// 提示文本（specs 等）
	hintText: { fontSize: 16, color: '#999' },
	// 价格 - 总计
	priceTotal: { fontSize: 17, color: '#f5222d', fontWeight: 700 },
	// 价格 - 采购
	priceProcurement: { fontSize: 17, color: '#fa8c16', fontWeight: 600 },
	// 金额数值
	amount: { fontSize: 16, fontWeight: 600 },
	// 逾期时间
	overdueTime: { fontSize: 16, fontWeight: 700, color: '#ff4d4f' },
	// 正常剩余时间
	remainingTime: { fontSize: 16, color: '#8c8c8c' },
	// 紧急剩余时间（蓝色）
	urgentTime: { fontSize: 16, fontWeight: 700, color: '#1890ff' },
	// 商品名称
	productName: { fontSize: 16, fontWeight: 500, maxWidth: 300, cursor: 'pointer' },
	// 操作人名称
	operatorName: { fontSize: 16, fontWeight: 500 },
	// 主文本（无特殊颜色）
	primaryText: { fontSize: 16 },
	// 强调文本
	emphasisText: { fontSize: 17, fontWeight: 500 },
	// 截止强调
	deadlineEmphasis: { fontSize: 17, fontWeight: 600, color: '#fa8c16' },
	// 截止逾期
	deadlineOverdue: { fontSize: 17, fontWeight: 600, color: '#ff4d4f' },
	// Tag 清除 margin
	tagNoMargin: { margin: 0 },
	// Tag 可点击
	tagClickable: { cursor: 'pointer', margin: 0 },
	// Tag 小尺寸
	tagSmall: { margin: 0, lineHeight: '18px' },
	// 来源明细 SKU 码
	skuCode: { fontSize: 16, color: '#1890ff', fontFamily: 'monospace' },
	// 弹窗订单号
	modalOrderNo: { fontSize: 17, color: '#999' },
	// 图片占位
	imagePlaceholder: {
		width: '120px', height: '120px', borderRadius: 6, background: '#f5f5f5',
		display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
		border: '1px dashed #d9d9d9',
	},
	// 元信息网格
	metaGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', alignItems: 'center' },
	// 时间网格
	timeGrid: { marginTop: 4, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px', alignItems: 'center', whiteSpace: 'nowrap' },
	// 来源明细容器
	sourcesContainer: { marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 },

};

// ==================== 分页配置 ====================
export const PAGINATION = {
	DEFAULT_PAGE_SIZE: 20,
	PAGE_SIZE_OPTIONS: ['10', '20', '50', '100'],
	SHOW_SIZE_CHANGER: true,
	SHOW_QUICK_JUMPER: true,
	SHOW_TOTAL: (total) => `总计 ${total} 条`
};

// ==================== 表格配置 ====================
export const TABLE = {
	DEFAULT_SCROLL_X: 1400,
	DENSITY_OPTIONS: ['default', 'middle', 'small']
};
